import type { SupabaseClient } from '@supabase/supabase-js';
import { startMesocycleWorkoutSession, type StartableMesocycle } from '../startMesocycleSession';
import { quickWeightEstimate } from '@/services/weightEstimationEngine';

/**
 * Fix 5: the session-build target_weight_kg consults the user's own direct
 * exercise history (recency-decayed e1RM anchor) BEFORE the
 * quickWeightEstimate transfer/profile ladder, and does NOT multiply the
 * weekly intensityModifier on top (the RIR ramp already drives weekly
 * intensity). A true cold start keeps the estimate × modifier path
 * bit-for-bit.
 */

// ============================================================
// Chainable Supabase mock (same convention as startMesocycleSession.test.ts,
// plus .order() support for the direct-history embedded query).
// ============================================================

interface RecordedQuery {
  table: string;
  method: 'select' | 'insert' | 'update';
  payload?: unknown;
  filters: Record<string, unknown>;
  single?: boolean;
}

type Responder = (query: RecordedQuery) => { data?: unknown; error?: unknown; count?: number | null };

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
      gte: () => builder,
      order: () => builder,
      limit: () => builder,
      single: () => {
        query.single = true;
        return resolve();
      },
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected),
    };
    return builder;
  }

  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => makeBuilder(table),
  } as unknown as SupabaseClient;

  return { supabase, queries };
}

// ============================================================
// Fixture: a 2-exercise program day. Bench has direct history; the cable
// fly is a true cold start.
// ============================================================

const EX_BENCH = '11111111-1111-1111-1111-111111111111';
const EX_FLY = '22222222-2222-2222-2222-222222222222';

const EXERCISE_META: Record<string, Record<string, unknown>> = {
  'Barbell Bench Press': {
    id: EX_BENCH,
    mechanic: 'compound',
    default_rep_range: [8, 12],
    default_rir: 2,
    primary_muscle: 'chest',
    movement_pattern: 'horizontal_push',
    equipment_required: ['barbell'],
    min_weight_increment_kg: 2.5,
  },
  'Cable Fly': {
    id: EX_FLY,
    mechanic: 'isolation',
    default_rep_range: [10, 15],
    default_rir: 2,
    primary_muscle: 'chest',
    movement_pattern: 'fly',
    equipment_required: ['cable'],
    min_weight_increment_kg: 1,
  },
};

function programSessionWeek(week: number, intensityModifier: number, isDeload = false) {
  return {
    weekNumber: week,
    intensityModifier,
    volumeModifier: 1.0,
    isDeload,
    sessions: [
      {
        day: 'Push',
        focus: 'chest',
        estimatedMinutes: 60,
        totalSets: 6,
        warmup: [],
        exercises: [
          {
            exercise: { id: EX_BENCH, name: 'Barbell Bench Press', primaryMuscle: 'chest' },
            sets: 3,
            reps: { min: 8, max: 12, targetRIR: 2 },
            restSeconds: 180,
          },
          {
            exercise: { id: EX_FLY, name: 'Cable Fly', primaryMuscle: 'chest' },
            sets: 3,
            reps: { min: 10, max: 15, targetRIR: 2 },
            restSeconds: 90,
          },
        ],
      },
    ],
  };
}

// Bench direct history: newest session holds the best set — 100 × 10 @ RPE 8
// → Brzycki-with-RIR e1RM = 100 × 36 / 25 = 144 (no decay on the newest).
const benchHistoryRow = {
  id: EX_BENCH,
  exercise_blocks: [
    {
      workout_sessions: { completed_at: '2026-07-15T10:00:00Z', is_deload: false },
      set_logs: [
        { weight_kg: 100, reps: 10, rpe: 8, is_warmup: false, logged_at: '2026-07-15T10:00:00Z' },
        { weight_kg: 100, reps: 9, rpe: 8.5, is_warmup: false, logged_at: '2026-07-15T10:00:00Z' },
      ],
    },
    {
      workout_sessions: { completed_at: '2026-07-11T10:00:00Z', is_deload: false },
      set_logs: [
        { weight_kg: 97.5, reps: 10, rpe: 8, is_warmup: false, logged_at: '2026-07-11T10:00:00Z' },
      ],
    },
  ],
};

function makeResponder(withBenchHistory: boolean): Responder {
  return (query) => {
    if (query.table === 'user_profiles') return { data: { goal: 'bulk', experience: 'intermediate' } };
    if (query.table === 'users') {
      return {
        data: {
          height_cm: 175,
          weight_kg: 80,
          body_fat_percent: 20,
          experience: 'intermediate',
          volume_landmarks: null,
          enhanced_athlete_mode: false,
        },
      };
    }
    if (query.table === 'workout_sessions') {
      if (query.method === 'insert') return { data: [{ id: 'new-session' }] };
      if (query.method === 'update') return { data: [{ id: 'new-session' }], error: null };
      return { data: null }; // no existing session today
    }
    if (query.table === 'set_logs') return { data: [] }; // no transfer candidates
    if (query.table === 'exercises') {
      // Direct-history embedded query (filters on id list).
      if (Array.isArray(query.filters['id'])) {
        return { data: withBenchHistory ? [benchHistoryRow, { id: EX_FLY, exercise_blocks: [] }] : [] };
      }
      // Per-exercise metadata lookup by name (.single()).
      const name = query.filters['name'];
      if (typeof name === 'string') return { data: EXERCISE_META[name] ?? null };
      return { data: null };
    }
    if (query.table === 'exercise_blocks') {
      if (query.method === 'insert') return { data: null, error: null };
      return { count: 0 };
    }
    return { data: null };
  };
}

function insertedBlocks(queries: RecordedQuery[]): any[] {
  const insert = queries.find((q) => q.table === 'exercise_blocks' && q.method === 'insert');
  expect(insert).toBeDefined();
  return insert!.payload as any[];
}

const baseMesocycle: StartableMesocycle = {
  id: 'meso-1',
  current_week: 2,
  total_weeks: 5,
  deload_week: 5,
  days_per_week: 4,
  program_data: {
    mesocycleWeeks: [
      programSessionWeek(1, 1.0),
      programSessionWeek(2, 1.05),
      programSessionWeek(3, 0.6, true),
    ],
  },
};

describe('startMesocycleWorkoutSession — direct-history targets (Fix 5)', () => {
  it('an exercise with direct history gets its target from the decayed e1RM anchor, with NO intensityModifier', async () => {
    const { supabase, queries } = createSupabaseMock(makeResponder(true));
    await startMesocycleWorkoutSession({
      supabase,
      mesocycle: baseMesocycle,
      todayWorkout: null,
      completedSessions: 4, // week 2, first session slot
    });

    const blocks = insertedBlocks(queries);
    const bench = blocks.find((b) => b.exercise_id === EX_BENCH);
    // Anchor 144 → mid of 8-12 (10 reps) @ 2 RIR: 144 / (1 + 12/30) ≈ 102.86,
    // rounded to the exercise's 2.5 kg increment. Week 2's 1.05 modifier is
    // NOT applied (102.5 × 1.05 would be ≈107.5).
    expect(bench.target_weight_kg).toBe(102.5);
  });

  it('a true cold start keeps the quickWeightEstimate × intensityModifier path bit-for-bit', async () => {
    const { supabase, queries } = createSupabaseMock(makeResponder(true));
    await startMesocycleWorkoutSession({
      supabase,
      mesocycle: baseMesocycle,
      todayWorkout: null,
      completedSessions: 4,
    });

    const blocks = insertedBlocks(queries);
    const fly = blocks.find((b) => b.exercise_id === EX_FLY);

    // Exactly what the pre-fix code computed for this exercise.
    const rec = quickWeightEstimate(
      'Cable Fly',
      { min: 10, max: 15 },
      2,
      80,
      175,
      20,
      'intermediate',
      undefined,
      'kg',
      undefined,
      {
        transferCandidates: [],
        targetMeta: {
          primaryMuscle: 'chest',
          movementPattern: 'fly',
          equipmentRequired: ['cable'],
        },
      }
    );
    const expected = Math.round((rec.recommendedWeight || 0) * 1.05 * 2) / 2;
    expect(fly.target_weight_kg).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it('with no history rows at all, every exercise takes the legacy estimate path', async () => {
    const { supabase, queries } = createSupabaseMock(makeResponder(false));
    await startMesocycleWorkoutSession({
      supabase,
      mesocycle: baseMesocycle,
      todayWorkout: null,
      completedSessions: 4,
    });

    const blocks = insertedBlocks(queries);
    const bench = blocks.find((b) => b.exercise_id === EX_BENCH);
    const rec = quickWeightEstimate(
      'Barbell Bench Press',
      { min: 8, max: 12 },
      2,
      80,
      175,
      20,
      'intermediate',
      undefined,
      'kg',
      undefined,
      {
        transferCandidates: [],
        targetMeta: {
          primaryMuscle: 'chest',
          movementPattern: 'horizontal_push',
          equipmentRequired: ['barbell'],
        },
      }
    );
    expect(bench.target_weight_kg).toBe(Math.round((rec.recommendedWeight || 0) * 1.05 * 2) / 2);
  });

  it('a deload week still applies the scheduled reduction to the direct-history target', async () => {
    const { supabase, queries } = createSupabaseMock(makeResponder(true));
    await startMesocycleWorkoutSession({
      supabase,
      mesocycle: { ...baseMesocycle, current_week: 3 },
      todayWorkout: null,
      completedSessions: 8,
    });

    const blocks = insertedBlocks(queries);
    const bench = blocks.find((b) => b.exercise_id === EX_BENCH);
    // The deload modifier (0.6) is the lightening mechanism itself — it must
    // still apply: 102.5 × 0.6 = 61.5.
    expect(bench.target_weight_kg).toBe(61.5);
  });
});
