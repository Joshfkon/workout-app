import type { SupabaseClient } from '@supabase/supabase-js';
import {
  startMesocycleWorkoutSession,
  type StartableMesocycle,
} from '../startMesocycleSession';

// ============================================================
// Minimal chainable Supabase mock. Each query chain is recorded and
// resolved through a per-test responder that inspects table/method/filters.
// ============================================================

interface RecordedQuery {
  table: string;
  method: 'select' | 'insert' | 'update';
  payload?: unknown;
  filters: Record<string, unknown>;
  single?: boolean;
}

type Responder = (query: RecordedQuery) => {
  data?: unknown;
  error?: unknown;
  count?: number | null;
};

function createSupabaseMock(responder: Responder) {
  const queries: RecordedQuery[] = [];

  function makeBuilder(table: string) {
    const query: RecordedQuery = { table, method: 'select', filters: {} };
    let resolved = false;
    const resolve = () => {
      if (!resolved) {
        resolved = true;
        queries.push(query);
      }
      return Promise.resolve(responder(query));
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: () => builder,
      insert: (payload: unknown) => {
        query.method = 'insert';
        query.payload = payload;
        return builder;
      },
      update: (payload: unknown) => {
        query.method = 'update';
        query.payload = payload;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        query.filters[col] = val;
        return builder;
      },
      in: (col: string, vals: unknown) => {
        query.filters[col] = vals;
        return builder;
      },
      single: () => {
        query.single = true;
        return resolve();
      },
      // Awaiting the builder directly (count/head queries, updates).
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected),
    };
    return builder;
  }

  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
    },
    from: (table: string) => makeBuilder(table),
  } as unknown as SupabaseClient;

  return { supabase, queries };
}

// program_data null + todayWorkout null keeps the block-building tail inert,
// so these tests exercise only the resume/claim/create decision.
const mesocycle: StartableMesocycle = {
  id: 'meso-1',
  current_week: 2,
  total_weeks: 5,
  deload_week: 5,
  days_per_week: 4,
  program_data: null,
};

function makeResponder(overrides: {
  existingSession?: { id: string; state: string; mesocycle_id: string | null } | null;
  blockCount?: number;
  /** Rows returned by the conditional claim update; [] simulates a lost race. */
  claimedRows?: Array<{ id: string }>;
}): Responder {
  return (query) => {
    if (query.table === 'user_profiles') return { data: { goal: 'bulk', experience: 'intermediate' } };
    if (query.table === 'users') return { data: null };
    if (query.table === 'exercise_blocks') return { count: overrides.blockCount ?? 0 };
    if (query.table === 'workout_sessions') {
      if (query.method === 'insert') return { data: { id: 'new-session' } };
      if (query.method === 'update') {
        return { data: overrides.claimedRows ?? [{ id: query.filters['id'] as string }], error: null };
      }
      if (query.filters['state'] === 'completed') return { count: 4 };
      return { data: overrides.existingSession ?? null };
    }
    return { data: null };
  };
}

describe('startMesocycleWorkoutSession — today\'s existing session handling', () => {
  it('resumes an in-progress session', async () => {
    const { supabase, queries } = createSupabaseMock(
      makeResponder({
        existingSession: { id: 's-1', state: 'in_progress', mesocycle_id: 'meso-1' },
      })
    );

    const result = await startMesocycleWorkoutSession({ supabase, mesocycle, todayWorkout: null });

    expect(result).toEqual({ sessionId: 's-1', resumedExisting: true });
    expect(queries.filter((q) => q.method !== 'select')).toHaveLength(0);
  });

  it('resumes a planned session that already has exercise blocks', async () => {
    const { supabase, queries } = createSupabaseMock(
      makeResponder({
        existingSession: { id: 's-2', state: 'planned', mesocycle_id: 'meso-1' },
        blockCount: 5,
      })
    );

    const result = await startMesocycleWorkoutSession({ supabase, mesocycle, todayWorkout: null });

    expect(result).toEqual({ sessionId: 's-2', resumedExisting: true });
    expect(queries.filter((q) => q.method !== 'select')).toHaveLength(0);
  });

  it('claims a blockless planned shell for this mesocycle instead of resuming it empty', async () => {
    const { supabase, queries } = createSupabaseMock(
      makeResponder({
        existingSession: { id: 'shell-1', state: 'planned', mesocycle_id: 'meso-1' },
        blockCount: 0,
      })
    );

    const result = await startMesocycleWorkoutSession({ supabase, mesocycle, todayWorkout: null });

    // The shell itself becomes the live session — flipped in place, not resumed.
    expect(result).toEqual({ sessionId: 'shell-1', resumedExisting: false });

    const update = queries.find((q) => q.table === 'workout_sessions' && q.method === 'update');
    expect(update).toBeDefined();
    expect(update!.filters['id']).toBe('shell-1');
    // The claim is conditional so a concurrent start can't also win it.
    expect(update!.filters['state']).toBe('planned');
    expect(update!.filters['mesocycle_id']).toBe('meso-1');
    expect((update!.payload as { state: string }).state).toBe('in_progress');
    expect((update!.payload as { started_at?: string }).started_at).toBeTruthy();

    // No duplicate session row is created for today.
    expect(queries.find((q) => q.table === 'workout_sessions' && q.method === 'insert')).toBeUndefined();
  });

  it('resumes instead of building blocks when a concurrent start already claimed the shell', async () => {
    const { supabase, queries } = createSupabaseMock(
      makeResponder({
        existingSession: { id: 'shell-1', state: 'planned', mesocycle_id: 'meso-1' },
        blockCount: 0,
        claimedRows: [], // conditional update matched no rows — the other tab won
      })
    );

    const result = await startMesocycleWorkoutSession({ supabase, mesocycle, todayWorkout: null });

    expect(result).toEqual({ sessionId: 'shell-1', resumedExisting: true });
    // The loser writes nothing beyond the failed claim: no session insert,
    // and no exercise blocks duplicated into the winner's session.
    expect(queries.find((q) => q.table === 'workout_sessions' && q.method === 'insert')).toBeUndefined();
    expect(queries.find((q) => q.table === 'exercise_blocks' && q.method === 'insert')).toBeUndefined();
  });

  it('does not claim a blockless planned session belonging to another mesocycle', async () => {
    const { supabase, queries } = createSupabaseMock(
      makeResponder({
        existingSession: { id: 's-3', state: 'planned', mesocycle_id: 'other-meso' },
        blockCount: 0,
      })
    );

    const result = await startMesocycleWorkoutSession({ supabase, mesocycle, todayWorkout: null });

    expect(result).toEqual({ sessionId: 's-3', resumedExisting: true });
    expect(queries.filter((q) => q.method !== 'select')).toHaveLength(0);
  });

  it('creates a new in-progress session when none exists for today', async () => {
    const { supabase, queries } = createSupabaseMock(makeResponder({ existingSession: null }));

    const result = await startMesocycleWorkoutSession({ supabase, mesocycle, todayWorkout: null });

    expect(result).toEqual({ sessionId: 'new-session', resumedExisting: false });

    const insert = queries.find((q) => q.table === 'workout_sessions' && q.method === 'insert');
    expect(insert).toBeDefined();
    expect((insert!.payload as { state: string }).state).toBe('in_progress');
    expect((insert!.payload as { mesocycle_id: string }).mesocycle_id).toBe('meso-1');
  });
});
