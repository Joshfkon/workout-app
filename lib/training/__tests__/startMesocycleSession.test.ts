import type { SupabaseClient } from '@supabase/supabase-js';
import {
  startMesocycleWorkoutSession,
  programSessionHasUsableExercises,
  type StartableMesocycle,
} from '../startMesocycleSession';
import type { ExtractedSession } from '@/services/mesocycleHelpers';

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
      is: (col: string, val: unknown) => {
        query.filters[col] = val;
        return builder;
      },
      limit: () => builder,
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
      // The origin-aware insert path inserts an array and selects without
      // .single(), so the response is an array of created rows.
      if (query.method === 'insert') return { data: [{ id: 'new-session' }] };
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
    const [row] = insert!.payload as { state: string; mesocycle_id: string; origin: string }[];
    expect(row.state).toBe('in_progress');
    expect(row.mesocycle_id).toBe('meso-1');
    // Sessions record how they were started; the mesocycle path is 'scheduled'.
    expect(row.origin).toBe('scheduled');
  });
});

// ============================================================
// programSessionHasUsableExercises — must mirror the start path's
// block-building skip logic so display surfaces fall back to the calendar
// workout exactly when Start does.
// ============================================================

const REAL_UUID = '123e4567-e89b-42d3-a456-426614174000';

function makeSession(
  exercises: Array<{ exerciseId?: string; exerciseName: string }>
): ExtractedSession {
  return {
    dayName: 'Upper A',
    focus: 'upper',
    muscles: ['chest'],
    exercises: exercises.map((ex) => ({
      ...ex,
      primaryMuscle: 'chest' as const,
      sets: 3,
      repRange: { min: 8, max: 12 },
      targetRir: 2,
      restSeconds: 120,
    })),
    estimatedMinutes: 60,
    totalSets: 9,
    warmup: [],
  };
}

/** Responder for the exercises-by-name lookup: resolves only knownNames. */
function makeExerciseResponder(knownNames: string[]): Responder {
  return (query) => {
    if (query.table === 'exercises') {
      const requested = (query.filters['name'] as string[]) ?? [];
      const matches = requested.filter((n) => knownNames.includes(n));
      return { data: matches.map((n) => ({ id: `id-${n}` })) };
    }
    return { data: null };
  };
}

describe('programSessionHasUsableExercises', () => {
  it('is false for a null session or one with no exercises (no query made)', async () => {
    const { supabase, queries } = createSupabaseMock(makeExerciseResponder([]));

    expect(await programSessionHasUsableExercises(supabase, null)).toBe(false);
    expect(await programSessionHasUsableExercises(supabase, makeSession([]))).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('is true without querying when an entry carries a real UUID id', async () => {
    const { supabase, queries } = createSupabaseMock(makeExerciseResponder([]));
    const session = makeSession([
      { exerciseId: REAL_UUID, exerciseName: 'Renamed Out Of Library' },
    ]);

    expect(await programSessionHasUsableExercises(supabase, session)).toBe(true);
    expect(queries).toHaveLength(0);
  });

  it('is true when a placeholder-id entry still resolves by name', async () => {
    const { supabase } = createSupabaseMock(makeExerciseResponder(['Bench Press']));
    const session = makeSession([
      { exerciseId: 'db-row', exerciseName: 'Bench Press' },
    ]);

    expect(await programSessionHasUsableExercises(supabase, session)).toBe(true);
  });

  it('is false when every entry has a placeholder id and an unresolvable name', async () => {
    const { supabase } = createSupabaseMock(makeExerciseResponder(['Bench Press']));
    const session = makeSession([
      { exerciseId: 'db-row', exerciseName: 'Deleted Exercise' },
      { exerciseName: 'Also Renamed' },
    ]);

    expect(await programSessionHasUsableExercises(supabase, session)).toBe(false);
  });

  it('applies exercise overrides before checking, matching the start path', async () => {
    const { supabase } = createSupabaseMock(makeExerciseResponder([]));
    const session = makeSession([
      { exerciseId: 'db-row', exerciseName: 'Deleted Exercise' },
    ]);

    // The user swapped the stale exercise for a real library one — Start
    // builds the replacement's block, so the slot is usable.
    const overrides = [
      {
        originalExerciseName: 'Deleted Exercise',
        replacementExerciseId: REAL_UUID,
        replacementExerciseName: 'Incline Dumbbell Press',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];

    expect(await programSessionHasUsableExercises(supabase, session, overrides)).toBe(true);
  });
});

describe('startMesocycleWorkoutSession — programmed deload auto-flag', () => {
  // program_data whose week 2 is the programmed deload. Week sessions are
  // empty so the block-building tail stays inert — the auto-flag write (the
  // behavior under test) happens before it.
  const deloadWeekProgram = {
    mesocycleWeeks: [
      { weekNumber: 1, intensityModifier: 1, volumeModifier: 1, isDeload: false, sessions: [] },
      { weekNumber: 2, intensityModifier: 0.9, volumeModifier: 0.5, isDeload: true, sessions: [] },
    ],
  };

  const deloadMeso: StartableMesocycle = {
    id: 'meso-1',
    current_week: 2,
    total_weeks: 2,
    deload_week: 2,
    days_per_week: 4,
    program_data: deloadWeekProgram,
  };

  async function deloadFlagWrites(completedSessions: number) {
    const { supabase, queries } = createSupabaseMock(makeResponder({ existingSession: null }));
    try {
      await startMesocycleWorkoutSession({
        supabase,
        mesocycle: deloadMeso,
        todayWorkout: null,
        completedSessions,
      });
    } catch {
      // The empty-program block-building tail may throw; the auto-flag write
      // (or its absence) has been recorded before that point.
    }
    return queries.filter(
      (q) =>
        q.table === 'workout_sessions' &&
        q.method === 'update' &&
        (q.payload as Record<string, unknown> | undefined)?.is_deload === true
    );
  }

  it('flags a session started inside the programmed deload week', async () => {
    // 4 of 8 programmed sessions done (week 2 of 2 at 4/wk): genuinely in the
    // deload week, block not complete.
    expect(await deloadFlagWrites(4)).toHaveLength(1);
  });

  it('does not flag sessions once the block is complete', async () => {
    // All 8 programmed sessions done: current_week clamps at the final
    // (deload) week forever, but post-block sessions are real training — they
    // must not be silently deload-flagged and hidden from e1RM/PR trends.
    expect(await deloadFlagWrites(8)).toHaveLength(0);
  });
});
