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
import {
  __setDriverForTests,
  listOutbox,
  outboxCount,
  type OutboxEntry,
} from '@/lib/offline/setOutbox';
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
 * Supabase stub with manually releasable operations, so tests can assert
 * what happened BEFORE the network settles.
 */
function makeGatedSupabase() {
  const pending: Array<{
    table: string;
    op: 'upsert' | 'update';
    row: Record<string, unknown>;
    resolve: (error?: { message: string } | null) => void;
  }> = [];
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
    }),
  };
  return { client: client as unknown as FinishFlowDeps['supabase'], pending };
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
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    __setDriverForTests(null);
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
    jest.restoreAllMocks();
  });

  it('queues the mesocycle link and runs meso updates once synced', async () => {
    const { client, pending } = makeGatedSupabase();
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
