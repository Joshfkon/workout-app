import {
  rangeStartLocalDay,
  pendingCompletionsFromOutbox,
  pendingSetsFromOutbox,
  mergeLocalPendingWorkouts,
  countWorkingSets,
  type RawWorkoutSession,
  type RawSetLog,
} from '../volumeTrendsData';
import type { OutboxEntry } from '@/lib/offline/setOutbox';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function outboxEntry(partial: Partial<OutboxEntry> & Pick<OutboxEntry, 'id' | 'table' | 'row'>): OutboxEntry {
  return { enqueuedAt: 1, attempts: 0, ...partial };
}

function makeSet(id: string, overrides: Partial<RawSetLog> = {}): RawSetLog {
  return { id, weight_kg: 100, reps: 8, is_warmup: false, logged_at: null, ...overrides };
}

function makeSession(
  id: string,
  completedAt: string | null,
  blocks: Array<{ id: string; muscle?: string; sets: RawSetLog[] }>
): RawWorkoutSession {
  return {
    id,
    started_at: completedAt,
    completed_at: completedAt,
    duration_seconds: 3600,
    session_rpe: 8,
    exercise_blocks: blocks.map((b) => ({
      id: b.id,
      exercises: { id: `ex-${b.id}`, name: `Exercise ${b.id}`, primary_muscle: b.muscle ?? 'chest' },
      set_logs: b.sets,
    })),
  };
}

/** An 18-working-set workout (plus warmups), split across two blocks. */
function eighteenSetFixture(id: string, completedAt: string | null): RawWorkoutSession {
  const sets = (blockId: string, count: number) =>
    Array.from({ length: count }, (_, i) => makeSet(`${blockId}-s${i}`));
  return makeSession(id, completedAt, [
    { id: `${id}-b1`, muscle: 'chest', sets: [makeSet(`${id}-b1-w`, { is_warmup: true }), ...sets(`${id}-b1`, 10)] },
    { id: `${id}-b2`, muscle: 'back', sets: [makeSet(`${id}-b2-w`, { is_warmup: true }), ...sets(`${id}-b2`, 8)] },
  ]);
}

// ---------------------------------------------------------------------------
// rangeStartLocalDay — local calendar days, not rolling UTC windows
// ---------------------------------------------------------------------------

describe('rangeStartLocalDay', () => {
  it('returns local midnight (N-1) days ago so the range covers N whole local days', () => {
    const now = new Date(2026, 6, 13, 20, 0); // July 13, 8 PM local
    expect(rangeStartLocalDay('7d', now)).toEqual(new Date(2026, 6, 7, 0, 0, 0, 0));
    expect(rangeStartLocalDay('30d', now)).toEqual(new Date(2026, 5, 14, 0, 0, 0, 0));
  });

  it('returns null for the all-time range', () => {
    expect(rangeStartLocalDay('all')).toBeNull();
  });

  it('bounds the range on whole local days: oldest day fully in, day before fully out', () => {
    const now = new Date(2026, 6, 13, 20, 0);
    const rangeStart = rangeStartLocalDay('7d', now)!;
    // Any time on the oldest local day (July 7) is in range…
    expect(new Date(2026, 6, 7, 0, 0).getTime()).toBeGreaterThanOrEqual(rangeStart.getTime());
    expect(new Date(2026, 6, 7, 9, 0).getTime()).toBeGreaterThanOrEqual(rangeStart.getTime());
    // …and nothing from July 6 leaks in (the rolling `now - 7*24h` window
    // included July 6 evenings, so "7d" didn't mean 7 calendar days).
    expect(new Date(2026, 6, 6, 23, 59).getTime()).toBeLessThan(rangeStart.getTime());
  });

  it('includes an evening workout logged after UTC midnight in today’s local day', () => {
    // 8 PM ET is already past UTC midnight of the next day; local-day math
    // must still bucket it as "today" (this bug class has shipped twice).
    const now = new Date(2026, 6, 13, 23, 30);
    const eveningWorkout = new Date(2026, 6, 13, 20, 0);
    const todayStart = rangeStartLocalDay('7d', now)!;
    expect(eveningWorkout.getTime()).toBeGreaterThanOrEqual(todayStart.getTime());
    const included = mergeLocalPendingWorkouts({
      serverSessions: [eighteenSetFixture('w-eve', eveningWorkout.toISOString())],
      pendingSessions: [],
      pendingCompletions: new Map(),
      pendingSetsByBlock: new Map(),
      rangeStart: todayStart,
    });
    expect(included).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Outbox extraction
// ---------------------------------------------------------------------------

describe('pendingCompletionsFromOutbox', () => {
  it('extracts queued finish patches keyed by session id', () => {
    const patch = { state: 'completed', completed_at: '2026-07-13T23:00:00.000Z', session_rpe: 8 };
    const entries: OutboxEntry[] = [
      outboxEntry({ id: 'finish:sess-1', table: 'workout_sessions', op: 'update', matchId: 'sess-1', row: patch }),
      // Claim patch (no state change) must not count as a completion.
      outboxEntry({ id: 'claim:sess-1', table: 'workout_sessions', op: 'update', matchId: 'sess-1x', row: { mesocycle_id: 'm1' } }),
      // Unrelated tables ignored.
      outboxEntry({ id: 'set-1', table: 'set_logs', row: { id: 'set-1', exercise_block_id: 'b1', weight_kg: 100, reps: 5 } }),
      outboxEntry({ id: 'feedback:sess-1:chest', table: 'session_muscle_feedback', op: 'insert', row: { session_id: 'sess-1' } }),
    ];
    const map = pendingCompletionsFromOutbox(entries);
    expect(Array.from(map.keys())).toEqual(['sess-1']);
    expect(map.get('sess-1')).toEqual(patch);
  });
});

describe('pendingSetsFromOutbox', () => {
  it('groups queued set inserts by exercise block and skips malformed rows', () => {
    const entries: OutboxEntry[] = [
      outboxEntry({ id: 's1', table: 'set_logs', row: { id: 's1', exercise_block_id: 'b1', weight_kg: 100, reps: 8, is_warmup: false } }),
      outboxEntry({ id: 's2', table: 'set_logs', row: { id: 's2', exercise_block_id: 'b1', weight_kg: 60, reps: 12, is_warmup: true, logged_at: '2026-07-13T22:00:00Z' } }),
      outboxEntry({ id: 's3', table: 'set_logs', row: { id: 's3', exercise_block_id: 'b2', weight_kg: 80, reps: 10 } }),
      // Missing block id / non-numeric weight → skipped.
      outboxEntry({ id: 'bad1', table: 'set_logs', row: { id: 'bad1', weight_kg: 100, reps: 8 } }),
      outboxEntry({ id: 'bad2', table: 'set_logs', row: { id: 'bad2', exercise_block_id: 'b2', weight_kg: 'heavy', reps: 8 } }),
      // Updates are not new sets.
      outboxEntry({ id: 'finish:x', table: 'workout_sessions', op: 'update', matchId: 'x', row: { state: 'completed' } }),
    ];
    const map = pendingSetsFromOutbox(entries);
    expect(map.get('b1')).toHaveLength(2);
    expect(map.get('b1')![1]).toEqual({ id: 's2', weight_kg: 60, reps: 12, is_warmup: true, logged_at: '2026-07-13T22:00:00Z' });
    expect(map.get('b2')).toHaveLength(1);
    expect(map.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// mergeLocalPendingWorkouts
// ---------------------------------------------------------------------------

describe('mergeLocalPendingWorkouts', () => {
  const completedAt = '2026-07-13T23:30:00.000Z';

  it('surfaces an unsynced locally-finished workout (server still in_progress)', () => {
    // Server sees the session but not as completed; its completion patch and
    // two of its sets are still in the outbox.
    const pendingSession = makeSession('sess-1', null, [
      { id: 'b1', muscle: 'chest', sets: [makeSet('s1'), makeSet('s2')] },
      { id: 'b2', muscle: 'back', sets: [] }, // sets for this block are all still queued
    ]);
    pendingSession.session_rpe = null;
    pendingSession.duration_seconds = null;

    const merged = mergeLocalPendingWorkouts({
      serverSessions: [],
      pendingSessions: [pendingSession],
      pendingCompletions: new Map([
        ['sess-1', { state: 'completed', completed_at: completedAt, session_rpe: 7, duration_seconds: 3200 }],
      ]),
      pendingSetsByBlock: new Map([['b2', [makeSet('s3'), makeSet('s4')]]]),
      rangeStart: new Date(2026, 5, 14),
    });

    expect(merged).toHaveLength(1);
    const session = merged[0];
    expect(session.completed_at).toBe(completedAt);
    expect(session.session_rpe).toBe(7);
    expect(session.duration_seconds).toBe(3200);
    expect(session.exercise_blocks).toHaveLength(2);
    expect(session.exercise_blocks![1].set_logs!.map((s) => s.id)).toEqual(['s3', 's4']);
    expect(countWorkingSets(merged)).toBe(4);
  });

  it('does not duplicate a session that synced between the outbox snapshot and the query', () => {
    const server = makeSession('sess-1', completedAt, [{ id: 'b1', sets: [makeSet('s1')] }]);
    const pending = makeSession('sess-1', null, [{ id: 'b1', sets: [] }]);
    const merged = mergeLocalPendingWorkouts({
      serverSessions: [server],
      pendingSessions: [pending],
      pendingCompletions: new Map([['sess-1', { state: 'completed', completed_at: completedAt }]]),
      pendingSetsByBlock: new Map(),
      rangeStart: null,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].exercise_blocks![0].set_logs).toHaveLength(1);
  });

  it('does not duplicate a queued set that already landed server-side', () => {
    const server = makeSession('sess-1', completedAt, [{ id: 'b1', sets: [makeSet('s1'), makeSet('s2')] }]);
    const merged = mergeLocalPendingWorkouts({
      serverSessions: [server],
      pendingSessions: [],
      pendingCompletions: new Map(),
      pendingSetsByBlock: new Map([['b1', [makeSet('s2'), makeSet('s3')]]]),
      rangeStart: null,
    });
    expect(merged[0].exercise_blocks![0].set_logs!.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('excludes pending sessions with no completion patch and sessions outside the range', () => {
    const inProgress = makeSession('sess-live', null, [{ id: 'b1', sets: [makeSet('s1')] }]);
    const old = makeSession('sess-old', '2026-01-01T12:00:00.000Z', [{ id: 'b2', sets: [makeSet('s2')] }]);
    const merged = mergeLocalPendingWorkouts({
      serverSessions: [old],
      pendingSessions: [inProgress],
      pendingCompletions: new Map(),
      pendingSetsByBlock: new Map(),
      rangeStart: new Date(2026, 5, 14),
    });
    expect(merged).toHaveLength(0);
  });

  it('drops sessions and blocks with zero set logs (inner-join parity)', () => {
    const empty = makeSession('sess-empty', completedAt, [{ id: 'b1', sets: [] }]);
    const mixed = makeSession('sess-mixed', completedAt, [
      { id: 'b2', sets: [] },
      { id: 'b3', sets: [makeSet('s1')] },
    ]);
    const merged = mergeLocalPendingWorkouts({
      serverSessions: [empty, mixed],
      pendingSessions: [],
      pendingCompletions: new Map(),
      pendingSetsByBlock: new Map(),
      rangeStart: null,
    });
    expect(merged.map((s) => s.id)).toEqual(['sess-mixed']);
    expect(merged[0].exercise_blocks!.map((b) => b.id)).toEqual(['b3']);
  });

  it('sorts newest-first by completed_at', () => {
    const a = makeSession('a', '2026-07-10T10:00:00.000Z', [{ id: 'ba', sets: [makeSet('sa')] }]);
    const b = makeSession('b', '2026-07-12T10:00:00.000Z', [{ id: 'bb', sets: [makeSet('sb')] }]);
    const merged = mergeLocalPendingWorkouts({
      serverSessions: [a, b],
      pendingSessions: [],
      pendingCompletions: new Map(),
      pendingSetsByBlock: new Map(),
      rangeStart: null,
    });
    expect(merged.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('yields identical counts for the same workout pre-sync and post-sync (surface parity)', () => {
    // The 18-set fixture, once as a fully-synced server row and once as a
    // locally-pending finish — the tab must aggregate the same numbers either
    // way, which is what keeps it consistent with the Home volume card and
    // history on the same data.
    const synced = mergeLocalPendingWorkouts({
      serverSessions: [eighteenSetFixture('w1', completedAt)],
      pendingSessions: [],
      pendingCompletions: new Map(),
      pendingSetsByBlock: new Map(),
      rangeStart: new Date(2026, 5, 14),
    });

    const local = eighteenSetFixture('w1', null);
    // Strip one block's sets into the outbox to simulate mid-flush state.
    const queuedSets = local.exercise_blocks![1].set_logs!;
    local.exercise_blocks![1].set_logs = [];
    const preSync = mergeLocalPendingWorkouts({
      serverSessions: [],
      pendingSessions: [local],
      pendingCompletions: new Map([['w1', { state: 'completed', completed_at: completedAt }]]),
      pendingSetsByBlock: new Map([[local.exercise_blocks![1].id, queuedSets]]),
      rangeStart: new Date(2026, 5, 14),
    });

    expect(countWorkingSets(preSync)).toBe(18);
    expect(countWorkingSets(preSync)).toBe(countWorkingSets(synced));
    expect(preSync).toHaveLength(synced.length);
  });
});
