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

function benchSet(weight_kg: number, reps: number, rpe: number, set_number: number, logged_at: string) {
  return { weight_kg, reps, rpe, is_warmup: false, set_number, set_type: 'normal', logged_at };
}

// Bench direct history: newest session holds the best set — 100 × 10 @ RPE 8
// → Brzycki-with-RIR e1RM = 100 × 36 / 25 = 144 (no decay on the newest).
// Sets are mid-range (10/9 vs an 8-12 top), so the all-sets bump gate holds
// the target at the recent 100 kg working weight.
const benchHistoryRow = {
  id: EX_BENCH,
  exercise_blocks: [
    {
      workout_sessions: { id: 'ws-1', completed_at: '2026-07-15T10:00:00Z', is_deload: false },
      set_logs: [
        benchSet(100, 10, 8, 1, '2026-07-15T10:00:00Z'),
        benchSet(100, 9, 8.5, 2, '2026-07-15T10:00:00Z'),
      ],
    },
    {
      workout_sessions: { id: 'ws-2', completed_at: '2026-07-11T10:00:00Z', is_deload: false },
      set_logs: [benchSet(97.5, 10, 8, 1, '2026-07-11T10:00:00Z')],
    },
  ],
};

// Variant where the whole previous session EARNED a bump: every working set
// at the top of the range with >= 2 RIR spare (RPE 6 = 4 RIR vs target 2).
const benchAllTopHistoryRow = {
  id: EX_BENCH,
  exercise_blocks: [
    {
      workout_sessions: { id: 'ws-1', completed_at: '2026-07-15T10:00:00Z', is_deload: false },
      set_logs: [
        benchSet(100, 12, 6, 1, '2026-07-15T10:00:00Z'),
        benchSet(100, 12, 6, 2, '2026-07-15T10:00:00Z'),
      ],
    },
  ],
};

// Variant where the NEWEST completed session holds an EMPTY block for bench
// (exercise skipped that day / never logged): the last-session inputs must
// fall back to the newest block WITH working sets, not anchor on the empty
// one (which would zero the clamp/bump-gate inputs).
const benchSkippedNewestHistoryRow = {
  id: EX_BENCH,
  exercise_blocks: [
    {
      workout_sessions: { id: 'ws-0', completed_at: '2026-07-18T10:00:00Z', is_deload: false },
      set_logs: [],
    },
    ...benchHistoryRow.exercise_blocks,
  ],
};

type BenchHistoryRow =
  | typeof benchHistoryRow
  | typeof benchAllTopHistoryRow
  | typeof benchSkippedNewestHistoryRow
  | null;

function makeResponder(benchRow: BenchHistoryRow): Responder {
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
        return { data: benchRow ? [benchRow, { id: EX_FLY, exercise_blocks: [] }] : [] };
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
  it('direct history runs through the live session-start gates: mid-range session HOLDs at the recent working weight, no intensityModifier', async () => {
    const { supabase, queries } = createSupabaseMock(makeResponder(benchHistoryRow));
    await startMesocycleWorkoutSession({
      supabase,
      mesocycle: baseMesocycle,
      todayWorkout: null,
      completedSessions: 4, // week 2, first session slot
    });

    const blocks = insertedBlocks(queries);
    const bench = blocks.find((b) => b.exercise_id === EX_BENCH);
    // Anchor 144 → curve mid of 8-12 @ 2 RIR ≈ 102.86, but last session's
    // sets were mid-range (10/9 vs top 12), so the all-sets bump gate ceilings
    // the target at the recent 100 kg working weight. Week 2's 1.05 modifier
    // is NOT applied (100 × 1.05 would be 105).
    expect(bench.target_weight_kg).toBe(100);
  });

  it('an empty newest block (skipped exercise) falls back to the last session WITH sets', async () => {
    const { supabase, queries } = createSupabaseMock(makeResponder(benchSkippedNewestHistoryRow));
    await startMesocycleWorkoutSession({
      supabase,
      mesocycle: baseMesocycle,
      todayWorkout: null,
      completedSessions: 4,
    });

    const blocks = insertedBlocks(queries);
    const bench = blocks.find((b) => b.exercise_id === EX_BENCH);
    // Identical outcome to the plain benchHistoryRow case: the empty ws-0
    // block carries no signal, so the clamp/bump gates still read the
    // 2026-07-15 session and hold at its 100 kg working weight.
    expect(bench.target_weight_kg).toBe(100);
  });

  it('an EARNED session (all sets at top with spare RIR) may bump the stored target', async () => {
    const { supabase, queries } = createSupabaseMock(makeResponder(benchAllTopHistoryRow));
    await startMesocycleWorkoutSession({
      supabase,
      mesocycle: baseMesocycle,
      todayWorkout: null,
      completedSessions: 4,
    });

    const blocks = insertedBlocks(queries);
    const bench = blocks.find((b) => b.exercise_id === EX_BENCH);
    // Anchor: 100 × 12 @ RPE 6 → eff reps 16 → 100 × (1 + 16/30) ≈ 153.3.
    // Curve ≈ 109.5, allowed up to the ±10% clamp of the recent 100 → 110.
    expect(bench.target_weight_kg).toBeGreaterThan(100);
    expect(bench.target_weight_kg).toBeLessThanOrEqual(110);
  });

  it('a true cold start keeps the quickWeightEstimate × intensityModifier path bit-for-bit', async () => {
    const { supabase, queries } = createSupabaseMock(makeResponder(benchHistoryRow));
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
    const { supabase, queries } = createSupabaseMock(makeResponder(null));
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
    const { supabase, queries } = createSupabaseMock(makeResponder(benchHistoryRow));
    await startMesocycleWorkoutSession({
      supabase,
      mesocycle: { ...baseMesocycle, current_week: 3 },
      todayWorkout: null,
      completedSessions: 8,
    });

    const blocks = insertedBlocks(queries);
    const bench = blocks.find((b) => b.exercise_id === EX_BENCH);
    // The deload modifier (0.6) is the lightening mechanism itself — it must
    // still apply to the gated target: 100 × 0.6 = 60.
    expect(bench.target_weight_kg).toBe(60);
  });
});
