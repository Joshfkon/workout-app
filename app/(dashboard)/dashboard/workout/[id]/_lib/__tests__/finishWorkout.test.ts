/**
 * Tests for the optimistic finish-workout flow (finish-tap hang fix).
 *
 * The contract under test:
 *   - the UI response (navigate / claim prompt) happens immediately, never
 *     gated on any network call;
 *   - the completion is durably queued BEFORE the UI response, so a
 *     crash/kill cannot lose the finished workout;
 *   - post-processing that reads the completed row (meso week advance /
 *     deload check) runs only after the completion is confirmed synced;
 *   - network failures leave the queued writes in the outbox for the
 *     existing flush paths to retry.
 */

import {
  submitFinishOptimistic,
  confirmClaimOptimistic,
  sessionFinishEntryId,
  sessionClaimEntryId,
  type FinishFlowDeps,
  type FinishSummaryData,
} from '../finishWorkout';
import { drainPostFinishWork } from '../finishWorkout';
import { hasQueuedEntry } from '@/lib/offline/setOutbox';
import {
  __setDriverForTests,
  createMemoryStore,
  enqueueRowUpsert,
  flushSetOutbox,
  listOutbox,
  outboxCount,
  type OutboxEntry,
} from '@/lib/offline/setOutbox';
import {
  __setPostFinishStoreForTests,
  enqueuePostFinishWork,
  getPostFinishWork,
  listPostFinishWork,
  type PostFinishWork,
} from '@/lib/offline/postFinishQueue';
import type { WorkoutSession } from '@/types/schema';

jest.mock('@/lib/actions/workout-calories', () => ({
  calculateAndSaveWorkoutCalories: jest.fn().mockResolvedValue(undefined),
}));

import { calculateAndSaveWorkoutCalories } from '@/lib/actions/workout-calories';

function memoryDriver() {
  const map = new Map<string, OutboxEntry>();
  return {
    put: async (entry: OutboxEntry) => { map.set(entry.id, { ...entry }); },
    getAll: async () => Array.from(map.values()),
    delete: async (id: string) => { map.delete(id); },
    get: async (id: string) => map.get(id),
  };
}

/**
 * Supabase stub with manually releasable WRITES, so tests can assert what
 * happened BEFORE the network settles.
 *
 * Reads are not gated: `settlePostFinish` reads `workout_sessions.state` to
 * tell "the flush wrote it" from "the flush gave up on it", and gating that
 * would only add ceremony to every test. `sessionState` controls what it sees.
 */
function makeGatedSupabase(
  sessionState: string | null = 'completed',
  sessionMesocycleId: string | null = 'meso-1'
) {
  const pending: Array<{
    table: string;
    op: 'upsert' | 'update';
    row: Record<string, unknown>;
    resolve: (error?: { message: string } | null) => void;
  }> = [];
  const state = { value: sessionState };
  const gate = (table: string, op: 'upsert' | 'update', row: Record<string, unknown>) =>
    new Promise<{ error: { message: string } | null }>((resolve) => {
      pending.push({ table, op, row, resolve: (error = null) => resolve({ error }) });
    });
  const client = {
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>) => gate(table, 'upsert', row),
      update: (row: Record<string, unknown>) => ({
        eq: () => gate(table, 'update', row),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              state.value === null
                ? null
                : { state: state.value, mesocycle_id: sessionMesocycleId },
            error: null,
          }),
        }),
      }),
    }),
  };
  return { client: client as unknown as FinishFlowDeps['supabase'], pending, state };
}

/** Let queued microtasks and immediate timers run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 's1',
    userId: 'u1',
    mesocycleId: null,
    state: 'in_progress',
    plannedDate: '',
    startedAt: '2026-07-07T10:00:00Z',
    completedAt: null,
    preWorkoutCheckIn: null,
    sessionRpe: null,
    pumpRating: null,
    sessionNotes: null,
    ...overrides,
  } as WorkoutSession;
}

const SUMMARY_DATA: FinishSummaryData = {
  sessionRpe: 8,
  pumpRating: 4,
  notes: 'good session',
  muscleFeedback: [
    { muscleGroup: 'chest_upper', pump: 2, workload: 1 },
    { muscleGroup: 'lats', pump: 1, workload: 2 },
  ],
};

describe('submitFinishOptimistic', () => {
  beforeEach(() => {
    __setDriverForTests(memoryDriver());
    __setPostFinishStoreForTests(createMemoryStore<PostFinishWork>());
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    __setDriverForTests(null);
    __setPostFinishStoreForTests(null);
    jest.restoreAllMocks();
    (calculateAndSaveWorkoutCalories as jest.Mock).mockClear();
  });

  it('queues the completion durably and navigates BEFORE any network call settles', async () => {
    const { client, pending } = makeGatedSupabase();
    const navigate = jest.fn();
    const runMesoUpdates = jest.fn().mockResolvedValue(undefined);

    await submitFinishOptimistic(
      { supabase: client, sessionId: 's1', session: makeSession(), navigate, runMesoUpdates },
      SUMMARY_DATA
    );

    // Immediate UI response, with the completion already safe in the outbox
    // and NOTHING waiting on the network (requests are still un-settled).
    expect(navigate).toHaveBeenCalledTimes(1);
    const entries = await listOutbox();
    expect(entries.map((e) => e.id).sort()).toEqual([
      'feedback:s1:chest_upper',
      'feedback:s1:lats',
      sessionFinishEntryId('s1'),
    ]);
    const finish = entries.find((e) => e.id === sessionFinishEntryId('s1'))!;
    expect(finish.op).toBe('update');
    expect(finish.matchId).toBe('s1');
    expect(finish.row).toMatchObject({
      state: 'completed',
      session_rpe: 8,
      pump_rating: 4,
      session_notes: 'good session',
      completion_percent: 100,
    });

    // Release the background flush and confirm the queue drains.
    await settle();
    while (pending.length > 0) {
      pending.shift()!.resolve();
      await settle();
    }
    expect(await outboxCount()).toBe(0);
  });

  it('omits pump entirely on the new pump-less finish payload', async () => {
    const { client } = makeGatedSupabase();

    // What the restructured finish card sends: no global pumpRating, and
    // workload-only per-muscle feedback (pump moved to per-exercise capture).
    await submitFinishOptimistic(
      { supabase: client, sessionId: 's1', session: makeSession(), navigate: jest.fn() },
      {
        sessionRpe: 8,
        notes: 'good session',
        muscleFeedback: [
          { muscleGroup: 'chest_upper', workload: 1 },
          { muscleGroup: 'lats', workload: 2 },
        ],
      }
    );

    const entries = await listOutbox();
    const finish = entries.find((e) => e.id === sessionFinishEntryId('s1'))!;
    expect(finish.row).not.toHaveProperty('pump_rating');
    const feedback = entries.filter((e) => e.id.startsWith('feedback:'));
    expect(feedback).toHaveLength(2);
    feedback.forEach((entry) => {
      expect(entry.row).not.toHaveProperty('pump');
      expect(entry.row).toHaveProperty('workload');
    });
  });

  it('persists the frozen duration snapshot in the completion patch', async () => {
    const { client } = makeGatedSupabase();

    await submitFinishOptimistic(
      { supabase: client, sessionId: 's1', session: makeSession(), navigate: jest.fn() },
      { ...SUMMARY_DATA, durationSeconds: 1215 }
    );

    const finish = (await listOutbox()).find((e) => e.id === sessionFinishEntryId('s1'))!;
    expect(finish.row).toMatchObject({ duration_seconds: 1215 });
  });

  it('omits duration_seconds when no snapshot is provided', async () => {
    const { client } = makeGatedSupabase();

    await submitFinishOptimistic(
      { supabase: client, sessionId: 's1', session: makeSession(), navigate: jest.fn() },
      SUMMARY_DATA
    );

    const finish = (await listOutbox()).find((e) => e.id === sessionFinishEntryId('s1'))!;
    expect(finish.row).not.toHaveProperty('duration_seconds');
  });

  it('responds in under 100ms even when the network never answers', async () => {
    // Requests are gated and never released — a fully dead connection.
    const { client } = makeGatedSupabase();
    let navigatedAfterMs = Infinity;
    const t0 = performance.now();
    const navigate = jest.fn(() => { navigatedAfterMs = performance.now() - t0; });

    await submitFinishOptimistic(
      {
        supabase: client,
        sessionId: 's1',
        session: makeSession(),
        navigate,
        runMesoUpdates: jest.fn(),
      },
      {
        ...SUMMARY_DATA,
        // Worst realistic case: feedback chips for many muscle groups.
        muscleFeedback: (
          ['chest_upper', 'chest_lower', 'lats', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes'] as const
        ).map((muscleGroup) => ({ muscleGroup, pump: 1 as const, workload: 1 as const })),
      }
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigatedAfterMs).toBeLessThan(100);
  });

  it('shows the claim prompt instead of navigating when a candidate is armed', async () => {
    const { client } = makeGatedSupabase();
    const navigate = jest.fn();
    const showClaimPrompt = jest.fn();

    await submitFinishOptimistic(
      {
        supabase: client,
        sessionId: 's1',
        session: makeSession(),
        navigate,
        showClaimPrompt,
        runMesoUpdates: jest.fn(),
      },
      SUMMARY_DATA
    );

    expect(showClaimPrompt).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('runs meso post-processing only AFTER the completion is confirmed synced', async () => {
    const { client, pending } = makeGatedSupabase();
    const runMesoUpdates = jest.fn().mockResolvedValue(undefined);
    const session = makeSession({
      mesocycleId: 'meso-1',
      preWorkoutCheckIn: { readinessScore: 80 } as WorkoutSession['preWorkoutCheckIn'],
    });

    await submitFinishOptimistic(
      { supabase: client, sessionId: 's1', session, navigate: jest.fn(), runMesoUpdates },
      SUMMARY_DATA
    );
    await settle();

    // Completion request in flight, not settled -> no post-processing yet.
    expect(runMesoUpdates).not.toHaveBeenCalled();

    while (pending.length > 0) {
      pending.shift()!.resolve();
      await settle();
    }

    expect(runMesoUpdates).toHaveBeenCalledTimes(1);
    expect(runMesoUpdates).toHaveBeenCalledWith(client, {
      mesocycleId: 'meso-1',
      userId: 'u1',
      sessionRpe: 8,
      checkIn: session.preWorkoutCheckIn,
    });
  });

  it('keeps the queued writes and skips post-processing when the network fails', async () => {
    const { client, pending } = makeGatedSupabase();
    const runMesoUpdates = jest.fn();

    await submitFinishOptimistic(
      {
        supabase: client,
        sessionId: 's1',
        session: makeSession({ mesocycleId: 'meso-1' }),
        navigate: jest.fn(),
        runMesoUpdates,
      },
      SUMMARY_DATA
    );
    await settle();
    // First flush attempt fails like a dead connection.
    pending.shift()!.resolve({ message: 'TypeError: Failed to fetch' });
    await settle();
    await settle();

    expect(runMesoUpdates).not.toHaveBeenCalled();
    // Everything still queued (completion + 2 feedback rows) for later flushes.
    expect(await outboxCount()).toBe(3);
    const finish = (await listOutbox()).find((e) => e.id === sessionFinishEntryId('s1'));
    expect(finish?.attempts).toBeGreaterThanOrEqual(1);
  });

  it('fires onCompletionSynced only AFTER the completion is confirmed synced', async () => {
    const { client, pending } = makeGatedSupabase();
    const onCompletionSynced = jest.fn();

    await submitFinishOptimistic(
      {
        supabase: client,
        sessionId: 's1',
        session: makeSession(),
        navigate: jest.fn(),
        onCompletionSynced,
        runMesoUpdates: jest.fn(),
      },
      SUMMARY_DATA
    );
    await settle();

    // Completion request in flight, not settled -> caches must not be
    // invalidated yet (a refetch now would re-cache the pre-workout state).
    expect(onCompletionSynced).not.toHaveBeenCalled();

    while (pending.length > 0) {
      pending.shift()!.resolve();
      await settle();
    }

    expect(onCompletionSynced).toHaveBeenCalledTimes(1);
  });

  it('does not fire onCompletionSynced when the network fails', async () => {
    const { client, pending } = makeGatedSupabase();
    const onCompletionSynced = jest.fn();

    await submitFinishOptimistic(
      {
        supabase: client,
        sessionId: 's1',
        session: makeSession(),
        navigate: jest.fn(),
        onCompletionSynced,
        runMesoUpdates: jest.fn(),
      },
      SUMMARY_DATA
    );
    await settle();
    pending.shift()!.resolve({ message: 'TypeError: Failed to fetch' });
    await settle();
    await settle();

    expect(onCompletionSynced).not.toHaveBeenCalled();
  });

  it('still runs meso post-processing when onCompletionSynced throws', async () => {
    const { client, pending } = makeGatedSupabase();
    const runMesoUpdates = jest.fn().mockResolvedValue(undefined);
    const onCompletionSynced = jest.fn(() => {
      throw new Error('invalidation exploded');
    });

    await submitFinishOptimistic(
      {
        supabase: client,
        sessionId: 's1',
        session: makeSession({ mesocycleId: 'meso-1' }),
        navigate: jest.fn(),
        onCompletionSynced,
        runMesoUpdates,
      },
      SUMMARY_DATA
    );
    await settle();
    while (pending.length > 0) {
      pending.shift()!.resolve();
      await settle();
    }

    expect(onCompletionSynced).toHaveBeenCalledTimes(1);
    expect(runMesoUpdates).toHaveBeenCalledTimes(1);
  });

  it('fires the calorie estimate after sync when the session has a planned date', async () => {
    const { client, pending } = makeGatedSupabase();

    await submitFinishOptimistic(
      {
        supabase: client,
        sessionId: 's1',
        session: makeSession({ plannedDate: '2026-07-07' }),
        navigate: jest.fn(),
        runMesoUpdates: jest.fn(),
      },
      SUMMARY_DATA
    );
    await settle();
    while (pending.length > 0) {
      pending.shift()!.resolve();
      await settle();
    }
    await settle();

    expect(calculateAndSaveWorkoutCalories).toHaveBeenCalledWith('s1', '2026-07-07');
  });
});

describe('confirmClaimOptimistic', () => {
  beforeEach(() => {
    __setDriverForTests(memoryDriver());
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    __setDriverForTests(null);
    __setPostFinishStoreForTests(null);
    jest.restoreAllMocks();
  });

  it('queues the mesocycle link and runs meso updates once synced', async () => {
    // The row reports the claimed mesocycle, i.e. the claim write landed.
    const { client, pending } = makeGatedSupabase('completed', 'meso-9');
    const runMesoUpdates = jest.fn().mockResolvedValue(undefined);

    await confirmClaimOptimistic({
      supabase: client,
      sessionId: 's1',
      session: makeSession(),
      mesocycleId: 'meso-9',
      sessionRpe: 7,
      runMesoUpdates,
    });

    // Claim is queued before any network work.
    const entries = await listOutbox();
    expect(entries.map((e) => e.id)).toEqual([sessionClaimEntryId('s1')]);
    expect(entries[0].row).toEqual({ mesocycle_id: 'meso-9' });

    await settle();
    while (pending.length > 0) {
      pending.shift()!.resolve();
      await settle();
    }

    expect(runMesoUpdates).toHaveBeenCalledWith(client, {
      mesocycleId: 'meso-9',
      userId: 'u1',
      sessionRpe: 7,
      checkIn: null,
    });
    expect(await outboxCount()).toBe(0);
  });

  it('leaves the claim queued and skips meso updates when the network fails', async () => {
    const { client, pending } = makeGatedSupabase();
    const runMesoUpdates = jest.fn();

    await confirmClaimOptimistic({
      supabase: client,
      sessionId: 's1',
      session: makeSession(),
      mesocycleId: 'meso-9',
      sessionRpe: 7,
      runMesoUpdates,
    });
    await settle();
    pending.shift()!.resolve({ message: 'TypeError: Failed to fetch' });
    await settle();
    await settle();

    expect(runMesoUpdates).not.toHaveBeenCalled();
    expect(await outboxCount('workout_sessions')).toBe(1);
  });
});

/**
 * B3 — post-session processing must not depend on which flush path drains the
 * finish mutation.
 *
 * The invariant under test:
 *
 *     finish durably persisted → post-session work eventually runs
 *
 * HOW THE OLD CODE LOST IT. `submitFinishOptimistic` decided from its own
 * `flushSetOutbox` result whether the completion had landed. That result is a
 * fact about which flush carried the write, not about whether the write
 * landed, and the caller only ever gets ONE look: `flushIncluding` runs at
 * most twice, immediately, and then the caller is done forever. Every finish
 * whose completion syncs later — offline, flaky connection, a timeout the
 * server actually applied, an entry left behind when the flush broke on an
 * earlier row — has its completion drained by some other flush path (dashboard
 * mount, `online` listener, the workout page's 5 s poll) long after that. The
 * post-processing was then skipped permanently, because nothing else was
 * looking for it.
 *
 * So these tests all take the shape: the caller's own flush does NOT land the
 * completion, a later flush does, and the work must still happen. That is the
 * reachable sequence — see the mutation notes at the bottom for what each one
 * is verified to catch.
 */
describe('post-finish settlement survives the flush race', () => {
  beforeEach(() => {
    __setDriverForTests(memoryDriver());
    __setPostFinishStoreForTests(createMemoryStore<PostFinishWork>());
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    __setDriverForTests(null);
    __setPostFinishStoreForTests(null);
    jest.restoreAllMocks();
    (calculateAndSaveWorkoutCalories as jest.Mock).mockClear();
  });

  const CHECK_IN = { readinessScore: 80 } as WorkoutSession['preWorkoutCheckIn'];
  const mesoSession = () => makeSession({ mesocycleId: 'meso-1', preWorkoutCheckIn: CHECK_IN });
  const EXPECTED_MESO_ARGS = {
    mesocycleId: 'meso-1',
    userId: 'u1',
    sessionRpe: 8,
    checkIn: CHECK_IN,
  };

  type Gate = { resolve: (error?: { message: string } | null) => void };
  const OFFLINE = { message: 'TypeError: Failed to fetch' };

  /** Release every gated write currently queued, repeatedly, until none remain. */
  async function releaseAll(pending: Gate[]) {
    await settle();
    while (pending.length > 0) {
      pending.shift()!.resolve();
      await settle();
    }
  }

  /**
   * Finish a workout whose completion does NOT sync: the first flush fails
   * like a dead connection, so the caller's background task ends having
   * observed a failure. This is where the old code gave up for good.
   */
  async function finishWhileOffline(
    client: FinishFlowDeps['supabase'],
    pending: Gate[],
    runMesoUpdates: jest.Mock
  ) {
    await submitFinishOptimistic(
      {
        supabase: client,
        sessionId: 's1',
        session: mesoSession(),
        navigate: jest.fn(),
        runMesoUpdates,
      },
      SUMMARY_DATA
    );
    // Fail EVERY write the caller attempts, so both of `flushIncluding`'s
    // flushes are exhausted and the caller is genuinely finished with the
    // entry still queued. (`doFlush` breaks on the first network error, so
    // this is at most two writes.)
    await settle();
    while (pending.length > 0) {
      pending.shift()!.resolve(OFFLINE);
      await settle();
    }
    await settle();

    expect(runMesoUpdates).not.toHaveBeenCalled();
    expect(await hasQueuedEntry(sessionFinishEntryId('s1'))).toBe(true);
  }

  it('Case A — a later flush drains the completion; the work still runs', async () => {
    const { client, pending } = makeGatedSupabase();
    const runMesoUpdates = jest.fn().mockResolvedValue(undefined);

    await finishWhileOffline(client, pending, runMesoUpdates);

    // Connectivity returns. A DIFFERENT flush path drains the completion —
    // the finish caller is not involved and never learns of it.
    const foreign = flushSetOutbox(client);
    await releaseAll(pending);
    await foreign;
    expect(await hasQueuedEntry(sessionFinishEntryId('s1'))).toBe(false);

    // The drain that runs alongside that same flush settles the work item.
    const outcomes = await drainPostFinishWork(client, { runMesoUpdates });

    expect(outcomes).toEqual(['ran']);
    expect(runMesoUpdates).toHaveBeenCalledTimes(1);
    expect(runMesoUpdates).toHaveBeenCalledWith(client, EXPECTED_MESO_ARGS);
    // Cleared, so no later drain repeats it.
    expect(await listPostFinishWork()).toEqual([]);
  });

  it('Case B — the caller is gone, and a shared in-flight flush attributed the finish to nobody', async () => {
    const { client, pending } = makeGatedSupabase();
    const runMesoUpdates = jest.fn().mockResolvedValue(undefined);

    // A flush is already in flight when the finish is enqueued, so its
    // snapshot excludes the completion.
    await enqueueRowUpsert('feedback:s0:lats', 'session_muscle_feedback', {
      session_id: 's0',
      muscle_group: 'lats',
      workload: 1,
    });
    const inFlight = flushSetOutbox(client);
    await settle();

    await finishWhileOffline(client, pending, runMesoUpdates);
    const shared = await inFlight;
    // The result the caller could have consulted names the finish neither as
    // flushed nor as failed. Attribution is simply unavailable here — which
    // is why the gate must not be built on it.
    expect(shared.flushedIds).not.toContain(sessionFinishEntryId('s1'));
    expect(shared.failedIds).not.toContain(sessionFinishEntryId('s1'));

    // The user leaves the app. Nothing that knows about this finish is still
    // running — the next session's dashboard mount is what picks it up.
    const foreign = flushSetOutbox(client);
    await releaseAll(pending);
    await foreign;

    const outcomes = await drainPostFinishWork(client, { runMesoUpdates });

    expect(outcomes).toEqual(['ran']);
    expect(runMesoUpdates).toHaveBeenCalledTimes(1);
    expect(runMesoUpdates).toHaveBeenCalledWith(client, EXPECTED_MESO_ARGS);
  });

  it('Case C — running the work twice converges, and a settled item is not repeated', async () => {
    const { client, pending } = makeGatedSupabase();
    const runMesoUpdates = jest.fn().mockResolvedValue(undefined);

    await submitFinishOptimistic(
      {
        supabase: client,
        sessionId: 's1',
        session: mesoSession(),
        navigate: jest.fn(),
        runMesoUpdates,
      },
      SUMMARY_DATA
    );
    await releaseAll(pending);
    expect(runMesoUpdates).toHaveBeenCalledTimes(1);

    // A second drain (another tab, an 'online' event, an app restart) finds
    // nothing owed: the item was cleared when the work completed.
    expect(await drainPostFinishWork(client, { runMesoUpdates })).toEqual([]);
    expect(runMesoUpdates).toHaveBeenCalledTimes(1);

    // And when the work DOES run twice — a crash between doing it and
    // clearing the item — it runs with identical arguments. That is what
    // makes at-least-once safe here: every operation behind those arguments
    // recomputes and overwrites from persisted state instead of accumulating.
    await enqueuePostFinishWork({
      sessionId: 's1',
      userId: 'u1',
      mesocycleId: 'meso-1',
      sessionRpe: 8,
      checkIn: CHECK_IN ?? null,
      plannedDate: null,
    });
    expect(await drainPostFinishWork(client, { runMesoUpdates })).toEqual(['ran']);
    expect(runMesoUpdates).toHaveBeenCalledTimes(2);
    expect(runMesoUpdates.mock.calls[1]).toEqual(runMesoUpdates.mock.calls[0]);
    expect(await listPostFinishWork()).toEqual([]);
  });

  it('does not run the work while the completion is still queued', async () => {
    // The other half of Case A: "gone from the queue" is the signal, so
    // "still in the queue" must hold the work back.
    const { client, pending } = makeGatedSupabase();
    const runMesoUpdates = jest.fn();

    await finishWhileOffline(client, pending, runMesoUpdates);

    expect(await drainPostFinishWork(client, { runMesoUpdates })).toEqual(['pending']);
    expect(runMesoUpdates).not.toHaveBeenCalled();
    // Still owed, so the next drain picks it up once the flush succeeds.
    expect((await listPostFinishWork()).map((w) => w.sessionId)).toEqual(['s1']);
  });

  it('drops the work item when the finish left the queue WITHOUT completing', async () => {
    // The flush's 5-attempt give-up deletes an entry the server kept
    // rejecting. "Gone from the queue" must not be read as "landed" — the
    // session row is the authority, and it still says in_progress.
    const { client, pending } = makeGatedSupabase('in_progress');
    const runMesoUpdates = jest.fn();

    await submitFinishOptimistic(
      {
        supabase: client,
        sessionId: 's1',
        session: mesoSession(),
        navigate: jest.fn(),
        runMesoUpdates,
      },
      SUMMARY_DATA
    );
    await releaseAll(pending);

    expect(runMesoUpdates).not.toHaveBeenCalled();
    expect(await listPostFinishWork()).toEqual([]);
  });

  it('keeps the work item when the session state cannot be read', async () => {
    // A read error is not evidence of anything. Dropping the item here would
    // turn a transient blip into permanently skipped processing.
    const { client, pending } = makeGatedSupabase();
    const runMesoUpdates = jest.fn();
    jest.spyOn(client, 'from').mockImplementation(((table: string) => {
      const real = (makeGatedSupabase().client as unknown as { from: (t: string) => unknown }).from;
      void real;
      return {
        upsert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }),
        }),
        table,
      };
    }) as never);

    await submitFinishOptimistic(
      {
        supabase: client,
        sessionId: 's1',
        session: mesoSession(),
        navigate: jest.fn(),
        runMesoUpdates,
      },
      SUMMARY_DATA
    );
    await releaseAll(pending);

    expect(runMesoUpdates).not.toHaveBeenCalled();
    expect((await listPostFinishWork()).map((w) => w.sessionId)).toEqual(['s1']);
  });
});

/**
 * Two ways the claim path could have reintroduced the very dependency this
 * change removes. Both were raised by Codex review on the B3 PR.
 */
describe('claim settlement is durable and verified', () => {
  beforeEach(() => {
    __setDriverForTests(memoryDriver());
    __setPostFinishStoreForTests(createMemoryStore<PostFinishWork>());
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    __setDriverForTests(null);
    __setPostFinishStoreForTests(null);
    jest.restoreAllMocks();
  });

  it('records the claimed mesocycle BEFORE any background work starts', async () => {
    // If the item were only patched after the flush, an app kill (or a claim
    // that sits queued offline for days) would leave it saying
    // `mesocycleId: null` — and the later drain would settle it having
    // skipped the mesocycle updates for good.
    const { client } = makeGatedSupabase('completed', 'meso-9');

    await confirmClaimOptimistic({
      supabase: client,
      sessionId: 's1',
      session: makeSession(),
      mesocycleId: 'meso-9',
      sessionRpe: 7,
      runMesoUpdates: jest.fn(),
    });

    // Nothing has been released, so no network work has happened yet.
    expect(await getPostFinishWork('s1')).toMatchObject({
      sessionId: 's1',
      mesocycleId: 'meso-9',
      sessionRpe: 7,
    });
  });

  it('skips the mesocycle updates when the session is not actually linked', async () => {
    // The flush's give-up path can drop the claim after five rejections, so
    // "no queued claim" does not mean "claimed". Running the mesocycle
    // updates anyway would write fatigue and deload state against a
    // mesocycle this session does not belong to.
    const { client, pending } = makeGatedSupabase('completed', null);
    const runMesoUpdates = jest.fn().mockResolvedValue(undefined);

    await confirmClaimOptimistic({
      supabase: client,
      sessionId: 's1',
      session: makeSession(),
      mesocycleId: 'meso-9',
      sessionRpe: 7,
      runMesoUpdates,
    });
    await settle();
    while (pending.length > 0) {
      pending.shift()!.resolve();
      await settle();
    }

    expect(runMesoUpdates).not.toHaveBeenCalled();
    // Still settled: the session-scoped work is done and the item cleared,
    // because the claim is gone from the queue and will never land.
    expect(await listPostFinishWork()).toEqual([]);
  });
});
