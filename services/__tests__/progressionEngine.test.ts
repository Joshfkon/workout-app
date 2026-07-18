/**
 * Tests for services/progressionEngine.ts
 * Core progression logic, E1RM calculation, set quality, warmup protocols
 */

import {
  calculateSetQuality,
  calculateE1RM,
  calculateBodyweightE1RM,
  detectJunkVolume,
  detectRegression,
  generateWarmupProtocol,
  getWarmedUpMuscles,
  isMuscleWarmedUp,
  getPeriodizationPhase,
  checkFormTrend,
  exerciseEntryToExercise,
  extractPerformanceFromSets,
  extractBodyweightPerformance,
  calculateRelativeStrength,
  getFormLabel,
  getFormColorClass,
  type CalculateSetQualityInput,
  type GenerateWarmupInput,
} from '../progressionEngine';

import type {
  Exercise,
  SetLog,
  LastSessionPerformance,
  SessionFormHistory,
} from '@/types/schema';
import { roundToIncrement } from '@/lib/utils';

// ============================================
// TEST FIXTURES
// ============================================

const createMockExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: 'bench-press',
  name: 'Bench Press',
  primaryMuscle: 'chest',
  secondaryMuscles: ['triceps', 'shoulders'],
  mechanic: 'compound',
  defaultRepRange: [6, 10] as [number, number],
  defaultRir: 2,
  minWeightIncrementKg: 2.5,
  formCues: [],
  commonMistakes: [],
  setupNote: '',
  movementPattern: 'horizontal_push',
  equipmentRequired: ['barbell'],
  ...overrides,
});

const createMockPerformance = (overrides: Partial<LastSessionPerformance> = {}): LastSessionPerformance => ({
  exerciseId: 'bench-press',
  weightKg: 100,
  reps: 8,
  rpe: 8,
  sets: 3,
  allSetsCompleted: true,
  averageRpe: 8,
  ...overrides,
});

const createMockSetLog = (overrides: Partial<SetLog> = {}): SetLog => ({
  id: 'set-1',
  exerciseBlockId: 'block-1',
  setNumber: 1,
  reps: 8,
  weightKg: 100,
  rpe: 8,
  restSeconds: null,
  isWarmup: false,
  setType: 'normal',
  parentSetId: null,
  quality: 'stimulative',
  qualityReason: 'Good effort',
  note: null,
  loggedAt: new Date().toISOString(),
  ...overrides,
});
describe('getPeriodizationPhase', () => {
  it('returns deload for last week', () => {
    expect(getPeriodizationPhase(6, 6)).toBe('deload');
    expect(getPeriodizationPhase(4, 4)).toBe('deload');
  });

  it('returns hypertrophy for early weeks (linear)', () => {
    expect(getPeriodizationPhase(1, 6)).toBe('hypertrophy');
    expect(getPeriodizationPhase(2, 6)).toBe('hypertrophy');
  });

  it('returns strength for middle weeks (linear)', () => {
    expect(getPeriodizationPhase(3, 6)).toBe('strength');
    expect(getPeriodizationPhase(4, 6)).toBe('strength');
  });

  it('returns peaking for late weeks (linear)', () => {
    expect(getPeriodizationPhase(5, 6)).toBe('peaking');
  });

  it('handles block periodization', () => {
    expect(getPeriodizationPhase(1, 8, 'block')).toBe('hypertrophy');
    expect(getPeriodizationPhase(3, 8, 'block')).toBe('hypertrophy');
    expect(getPeriodizationPhase(5, 8, 'block')).toBe('strength');
    expect(getPeriodizationPhase(7, 8, 'block')).toBe('peaking'); // Last blocks are peaking
  });
});
describe('calculateSetQuality', () => {
  const baseInput: CalculateSetQualityInput = {
    rpe: 8,
    targetRir: 2,
    reps: 8,
    targetRepRange: [6, 10],
    isLastSet: false,
  };

  it('classifies RPE <= 5 as junk volume', () => {
    const result = calculateSetQuality({ ...baseInput, rpe: 5 });
    expect(result.quality).toBe('junk');
    expect(result.reason).toContain('too far from failure');
  });

  it('classifies RPE 4 as junk volume', () => {
    const result = calculateSetQuality({ ...baseInput, rpe: 4 });
    expect(result.quality).toBe('junk');
  });

  it('classifies RPE 7.5-9.5 as stimulative', () => {
    expect(calculateSetQuality({ ...baseInput, rpe: 7.5 }).quality).toBe('stimulative');
    expect(calculateSetQuality({ ...baseInput, rpe: 8 }).quality).toBe('stimulative');
    expect(calculateSetQuality({ ...baseInput, rpe: 9 }).quality).toBe('stimulative');
    expect(calculateSetQuality({ ...baseInput, rpe: 9.5 }).quality).toBe('stimulative');
  });

  it('classifies RPE 10 on non-final set as excessive', () => {
    const result = calculateSetQuality({ ...baseInput, rpe: 10, isLastSet: false });
    expect(result.quality).toBe('excessive');
    expect(result.reason).toContain('failure');
  });

  it('allows RPE 10 on last set', () => {
    const result = calculateSetQuality({ ...baseInput, rpe: 10, isLastSet: true });
    expect(result.quality).not.toBe('excessive');
  });

  it('notes when below target rep range', () => {
    const result = calculateSetQuality({ ...baseInput, reps: 4, rpe: 8 });
    expect(result.quality).toBe('effective');
    expect(result.reason).toContain('Below target');
  });

  it('classifies RPE 6-7 as effective', () => {
    expect(calculateSetQuality({ ...baseInput, rpe: 6 }).quality).toBe('effective');
    expect(calculateSetQuality({ ...baseInput, rpe: 7 }).quality).toBe('effective');
  });
});

// ============================================
// E1RM CALCULATION TESTS
// ============================================

describe('calculateE1RM', () => {
  it('returns weight for 1 rep at RPE 10', () => {
    expect(calculateE1RM(100, 1, 10)).toBe(100);
  });

  it('returns 0 for 0 reps', () => {
    expect(calculateE1RM(100, 0, 10)).toBe(0);
  });

  it('calculates E1RM using Epley formula', () => {
    // 100kg x 10 reps @ RPE 10 (0 RIR)
    // Multi-formula average (Brzycki, Epley, Lombardi) for 100kg x 10 reps
    // - Brzycki: 100 * 36 / (37 - 10) = 133.33
    // - Epley: 100 * (1 + 10/30) = 133.33
    // - Lombardi: 100 * 10^0.10 = 125.89
    // Average ≈ 130.9
    expect(calculateE1RM(100, 10, 10)).toBeCloseTo(130.9, 0);
  });

  it('adjusts for RIR (RPE < 10)', () => {
    // 100kg x 8 reps @ RPE 8 (2 RIR) = effective 10 reps
    // Uses multi-formula average ≈ 130.9
    const result = calculateE1RM(100, 8, 8);
    expect(result).toBeCloseTo(130.9, 0);
  });

  it('handles very high rep sets', () => {
    const result = calculateE1RM(50, 20, 10);
    expect(result).toBeGreaterThan(50);
  });

  it('uses a gentle high-rep formula (reps > 12) to avoid inflation', () => {
    // For reps > 12 the adopted formula is weight * (1 + reps/40).
    // 20 reps: 100 * (1 + 20/40) = 150.
    expect(calculateE1RM(100, 20, 10)).toBeCloseTo(150, 1);
    // 15 reps: 100 * (1 + 15/40) = 137.5.
    expect(calculateE1RM(100, 15, 10)).toBeCloseTo(137.5, 1);
    // Anti-inflation: stays well below a raw Epley estimate (100*(1+20/30)=166.7).
    expect(calculateE1RM(100, 20, 10)).toBeLessThan(100 * (1 + 20 / 30));
  });
});

describe('roundToIncrement (bodyweight zero-increment guard)', () => {
  it('returns the value unchanged when increment is 0 (no NaN)', () => {
    // Bodyweight equipment has a 0 min increment -> previously divided by zero.
    expect(roundToIncrement(72.5, 0)).toBe(72.5);
    expect(Number.isNaN(roundToIncrement(72.5, 0))).toBe(false);
  });

  it('returns the value unchanged for negative increments', () => {
    expect(roundToIncrement(50, -2.5)).toBe(50);
  });

  it('still rounds normally for a positive increment', () => {
    expect(roundToIncrement(101, 2.5)).toBe(100);
  });
});

describe('calculateBodyweightE1RM', () => {
  it('uses effective load from bodyweight data if available', () => {
    const set = createMockSetLog({
      weightKg: 0,
      reps: 10,
      rpe: 8,
      bodyweightData: {
        modification: 'weighted',
        addedWeightKg: 20,
        userBodyweightKg: 80,
        effectiveLoadKg: 100,
      },
    });

    const result = calculateBodyweightE1RM(set);
    // Uses effectiveLoadKg of 100
    expect(result).toBeGreaterThan(100);
  });

  it('falls back to weightKg if no bodyweight data', () => {
    const set = createMockSetLog({
      weightKg: 100,
      reps: 10,
      rpe: 10,
    });

    const result = calculateBodyweightE1RM(set);
    // Uses multi-formula average ≈ 130.9
    expect(result).toBeCloseTo(130.9, 0);
  });
});

// ============================================
// JUNK VOLUME DETECTION TESTS
// ============================================

describe('detectJunkVolume', () => {
  it('identifies sets with RPE <= 5 as junk', () => {
    const sets = [
      createMockSetLog({ rpe: 8 }),
      createMockSetLog({ rpe: 5 }),
      createMockSetLog({ rpe: 4 }),
    ];

    const junk = detectJunkVolume(sets);
    expect(junk).toHaveLength(2);
  });

  it('excludes warmup sets', () => {
    const sets = [
      createMockSetLog({ rpe: 4, isWarmup: true }),
      createMockSetLog({ rpe: 4, isWarmup: false }),
    ];

    const junk = detectJunkVolume(sets);
    expect(junk).toHaveLength(1);
  });

  it('returns empty array when no junk volume', () => {
    const sets = [
      createMockSetLog({ rpe: 8 }),
      createMockSetLog({ rpe: 7 }),
    ];

    expect(detectJunkVolume(sets)).toHaveLength(0);
  });

  it('excludes ramp/feeder sets (light on purpose, not junk volume)', () => {
    const sets = [
      createMockSetLog({ rpe: 4, setRole: 'ramp' }),    // feeder — not junk
      createMockSetLog({ rpe: 4, setRole: 'working' }), // genuinely too easy — junk
    ];

    const junk = detectJunkVolume(sets);
    expect(junk).toHaveLength(1);
    expect(junk[0].setRole).toBe('working');
  });
});

// ============================================
// REGRESSION DETECTION TESTS
// ============================================

describe('detectRegression', () => {
  it('returns no regression with no previous data', () => {
    const current = createMockPerformance();
    const result = detectRegression(current, null);

    expect(result.isRegression).toBe(false);
    expect(result.reason).toContain('No previous');
  });

  it('detects weight decrease', () => {
    const current = createMockPerformance({ weightKg: 90 });
    const previous = createMockPerformance({ weightKg: 100 });

    const result = detectRegression(current, previous);
    expect(result.isRegression).toBe(true);
    expect(result.reason).toContain('Weight dropped');
  });

  it('detects significant rep decrease at same weight', () => {
    const current = createMockPerformance({ reps: 6 });
    const previous = createMockPerformance({ reps: 10 });

    const result = detectRegression(current, previous);
    expect(result.isRegression).toBe(true);
    expect(result.reason).toContain('Reps dropped');
  });

  it('ignores minor rep fluctuation', () => {
    const current = createMockPerformance({ reps: 9 });
    const previous = createMockPerformance({ reps: 10 });

    const result = detectRegression(current, previous);
    expect(result.isRegression).toBe(false);
  });

  it('detects significant RPE increase for same performance', () => {
    const current = createMockPerformance({ averageRpe: 9.5 });
    const previous = createMockPerformance({ averageRpe: 7.5 });

    const result = detectRegression(current, previous);
    expect(result.isRegression).toBe(true);
    expect(result.reason).toContain('effort');
  });
});

// ============================================
// WARMUP PROTOCOL TESTS
// ============================================

describe('generateWarmupProtocol', () => {
  const exercise = createMockExercise();

  it('generates minimal warmup for very light weights', () => {
    const input: GenerateWarmupInput = {
      workingWeight: 15,
      exercise,
      isFirstExercise: false,
    };

    const protocol = generateWarmupProtocol(input);
    expect(protocol.length).toBe(1);
    expect(protocol[0].purpose).toContain('activation');
  });

  it('includes general warmup for first exercise (barbell)', () => {
    const input: GenerateWarmupInput = {
      workingWeight: 100,
      exercise,
      isFirstExercise: true,
    };

    const protocol = generateWarmupProtocol(input);
    expect(protocol[0].percentOfWorking).toBe(0);
    expect(protocol[0].purpose).toContain('General warmup');
  });

  it('uses light weight (not 0) for first exercise warmup with non-barbell equipment', () => {
    const dumbbellExercise = createMockExercise({
      id: 'dumbbell-curl',
      name: 'Dumbbell Curl',
      primaryMuscle: 'biceps',
      mechanic: 'isolation',
      equipmentRequired: ['dumbbell'],
    });

    const input: GenerateWarmupInput = {
      workingWeight: 50,
      exercise: dumbbellExercise,
      isFirstExercise: true,
    };

    const protocol = generateWarmupProtocol(input);

    // For dumbbell exercises, first warmup should NOT be 0% (empty dumbbell doesn't make sense)
    expect(protocol[0].percentOfWorking).toBeGreaterThan(0);
    expect(protocol[0].purpose).toContain('General warmup');
  });

  it('generates progressive loading for heavy weights', () => {
    const input: GenerateWarmupInput = {
      workingWeight: 150,
      exercise,
      isFirstExercise: false,
    };

    const protocol = generateWarmupProtocol(input);

    // Should have multiple warmup sets with increasing intensity
    expect(protocol.length).toBeGreaterThanOrEqual(3);

    // Verify progressive loading
    for (let i = 1; i < protocol.length; i++) {
      expect(protocol[i].percentOfWorking).toBeGreaterThan(protocol[i - 1].percentOfWorking);
    }
  });

  it('decreases reps as weight increases', () => {
    const input: GenerateWarmupInput = {
      workingWeight: 100,
      exercise,
      isFirstExercise: false,
    };

    const protocol = generateWarmupProtocol(input);

    // Later sets (heavier) should have fewer reps
    const heavySet = protocol[protocol.length - 1];
    const lightSet = protocol[0];
    expect(heavySet.targetReps).toBeLessThanOrEqual(lightSet.targetReps);
  });
});

// ============================================
// MUSCLE WARMUP STATUS TESTS
// ============================================

describe('getWarmedUpMuscles / isMuscleWarmedUp', () => {
  const benchBlock = {
    id: 'block-bench',
    exercise: { primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'front_delts'] },
  };
  const inclineBlock = {
    id: 'block-incline',
    exercise: { primaryMuscle: 'chest', secondaryMuscles: ['front_delts'] },
  };
  const pushdownBlock = {
    id: 'block-pushdown',
    exercise: { primaryMuscle: 'triceps', secondaryMuscles: [] as string[] },
  };
  const blocks = [benchBlock, inclineBlock, pushdownBlock];

  const workingSet = (blockId: string) => ({
    exerciseBlockId: blockId,
    isWarmup: false,
    setType: 'normal',
  });

  it('returns no warmed muscles when no sets are completed', () => {
    expect(getWarmedUpMuscles({ completedSets: [], blocks }).size).toBe(0);
    expect(isMuscleWarmedUp('chest', { completedSets: [], blocks })).toBe(false);
  });

  it('marks the primary muscle warm after a working set', () => {
    const completedSets = [workingSet('block-bench')];
    expect(isMuscleWarmedUp('chest', { completedSets, blocks })).toBe(true);
  });

  it('marks secondary muscles warm after a working set', () => {
    const completedSets = [workingSet('block-bench')];
    expect(isMuscleWarmedUp('triceps', { completedSets, blocks })).toBe(true);
    expect(isMuscleWarmedUp('front_delts', { completedSets, blocks })).toBe(true);
  });

  it('does not warm unrelated muscles', () => {
    const completedSets = [workingSet('block-bench')];
    expect(isMuscleWarmedUp('quads', { completedSets, blocks })).toBe(false);
  });

  it('counts warmup sets for the primary muscle but not secondaries', () => {
    const warmupSet = { exerciseBlockId: 'block-bench', isWarmup: true, setType: 'warmup' };
    expect(isMuscleWarmedUp('chest', { completedSets: [warmupSet], blocks })).toBe(true);
    expect(isMuscleWarmedUp('triceps', { completedSets: [warmupSet], blocks })).toBe(false);
  });

  it('treats setType "warmup" like isWarmup for secondaries', () => {
    const typedWarmup = { exerciseBlockId: 'block-bench', isWarmup: false, setType: 'warmup' };
    expect(isMuscleWarmedUp('triceps', { completedSets: [typedWarmup], blocks })).toBe(false);
  });

  it('compares muscle names case-insensitively', () => {
    const completedSets = [workingSet('block-bench')];
    expect(isMuscleWarmedUp('Chest', { completedSets, blocks })).toBe(true);
    const mixedCaseBlocks = [
      { id: 'b1', exercise: { primaryMuscle: 'Chest', secondaryMuscles: ['Triceps'] } },
    ];
    expect(
      isMuscleWarmedUp('chest', {
        completedSets: [workingSet('b1')],
        blocks: mixedCaseBlocks,
      })
    ).toBe(true);
  });

  it('ignores sets whose block is not in the session', () => {
    const orphanSet = workingSet('block-deleted');
    expect(getWarmedUpMuscles({ completedSets: [orphanSet], blocks }).size).toBe(0);
  });

  it('returns false for an empty muscle name', () => {
    const completedSets = [workingSet('block-bench')];
    expect(isMuscleWarmedUp('', { completedSets, blocks })).toBe(false);
  });

  it('matches legacy and precise muscle tokens through the taxonomy', () => {
    // Flat bench tagged with the legacy coarse token warms the upper chest
    // for a following incline press tagged with the precise token
    const completedSets = [workingSet('block-bench')];
    expect(isMuscleWarmedUp('chest_upper', { completedSets, blocks })).toBe(true);

    // And the reverse: a precise-token exercise warms the coarse group
    const inclinePrecise = [
      { id: 'b-incline', exercise: { primaryMuscle: 'chest_upper', secondaryMuscles: [] as string[] } },
    ];
    expect(
      isMuscleWarmedUp('chest', { completedSets: [workingSet('b-incline')], blocks: inclinePrecise })
    ).toBe(true);
  });

  it('matches front_delts against the legacy shoulders token', () => {
    const ohpBlocks = [
      { id: 'b-ohp', exercise: { primaryMuscle: 'shoulders', secondaryMuscles: ['triceps'] } },
    ];
    const completedSets = [workingSet('b-ohp')];
    expect(isMuscleWarmedUp('front_delts', { completedSets, blocks: ohpBlocks })).toBe(true);
    expect(isMuscleWarmedUp('lateral_delts', { completedSets, blocks: ohpBlocks })).toBe(true);
    expect(isMuscleWarmedUp('lats', { completedSets, blocks: ohpBlocks })).toBe(false);
  });

  it('does not cross unrelated precise tokens', () => {
    const lateralBlocks = [
      { id: 'b-lat-raise', exercise: { primaryMuscle: 'lateral_delts', secondaryMuscles: [] as string[] } },
    ];
    const completedSets = [workingSet('b-lat-raise')];
    expect(isMuscleWarmedUp('front_delts', { completedSets, blocks: lateralBlocks })).toBe(false);
    expect(isMuscleWarmedUp('chest_upper', { completedSets, blocks: lateralBlocks })).toBe(false);
  });
});
describe('checkFormTrend', () => {
  it('returns null with insufficient data', () => {
    const history: SessionFormHistory[] = [
      { sessionDate: '2024-01-01', exerciseId: 'bench-press', sets: [{ weight: 100, reps: 8, repsInTank: 2, form: 'clean' }] },
    ];

    expect(checkFormTrend(history)).toBeNull();
  });

  it('detects declining form trend', () => {
    const history: SessionFormHistory[] = [
      { sessionDate: '2024-01-04', exerciseId: 'bench-press', sets: [{ weight: 100, reps: 8, repsInTank: 2, form: 'some_breakdown' }] },
      { sessionDate: '2024-01-03', exerciseId: 'bench-press', sets: [{ weight: 100, reps: 8, repsInTank: 2, form: 'some_breakdown' }] },
      { sessionDate: '2024-01-02', exerciseId: 'bench-press', sets: [{ weight: 100, reps: 8, repsInTank: 2, form: 'clean' }] },
      { sessionDate: '2024-01-01', exerciseId: 'bench-press', sets: [{ weight: 100, reps: 8, repsInTank: 2, form: 'clean' }] },
    ];

    const result = checkFormTrend(history);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('declining_form');
  });

  it('detects persistent breakdown', () => {
    const history: SessionFormHistory[] = [
      { sessionDate: '2024-01-03', exerciseId: 'bench-press', sets: [{ weight: 100, reps: 8, repsInTank: 1, form: 'ugly' }] },
      { sessionDate: '2024-01-02', exerciseId: 'bench-press', sets: [{ weight: 100, reps: 7, repsInTank: 1, form: 'ugly' }] },
      { sessionDate: '2024-01-01', exerciseId: 'bench-press', sets: [{ weight: 100, reps: 6, repsInTank: 0, form: 'ugly' }] },
    ];

    const result = checkFormTrend(history);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('persistent_breakdown');
    expect(result!.action).toBe('deload_required');
  });
});

// ============================================
// EXERCISE ENTRY ADAPTER TESTS
// ============================================

describe('exerciseEntryToExercise', () => {
  it('converts ExerciseEntry to Exercise with defaults', () => {
    const entry = {
      name: 'Barbell Squat',
      primaryMuscle: 'quads',
      secondaryMuscles: ['glutes', 'hamstrings'],
      pattern: 'squat' as const,
      equipment: 'barbell' as const,
    };

    const result = exerciseEntryToExercise(entry as any);

    expect(result.name).toBe('Barbell Squat');
    expect(result.primaryMuscle).toBe('quads');
    expect(result.mechanic).toBe('compound');
    expect(result.minWeightIncrementKg).toBe(2.5); // Barbell default
    expect(result.defaultRepRange).toEqual([5, 8]); // Squat default
  });

  it('handles isolation pattern', () => {
    const entry = {
      name: 'Bicep Curl',
      primaryMuscle: 'biceps',
      secondaryMuscles: [],
      pattern: 'isolation' as const,
      equipment: 'dumbbell' as const,
    };

    const result = exerciseEntryToExercise(entry as any);

    expect(result.mechanic).toBe('isolation');
    expect(result.defaultRepRange).toEqual([10, 15]);
    expect(result.minWeightIncrementKg).toBe(2);
  });

  it('uses provided values over defaults', () => {
    const entry = {
      name: 'Custom Exercise',
      primaryMuscle: 'chest',
      secondaryMuscles: [],
      pattern: 'horizontal_push' as const,
      equipment: 'cable' as const,
      defaultRepRange: [12, 15] as [number, number],
      defaultRir: 1,
      minWeightIncrementKg: 5,
    };

    const result = exerciseEntryToExercise(entry as any);

    expect(result.defaultRepRange).toEqual([12, 15]);
    expect(result.defaultRir).toBe(1);
    expect(result.minWeightIncrementKg).toBe(5);
  });
});
// ============================================
// PERFORMANCE EXTRACTION + FORM DISPLAY HELPERS
// ============================================

describe('extractPerformanceFromSets', () => {
  it('returns null with no working sets', () => {
    expect(extractPerformanceFromSets([createMockSetLog({ isWarmup: true })], 'bench-press')).toBeNull();
  });

  it('picks the top set by load (reps break ties) and averages RPE', () => {
    const sets = [
      createMockSetLog({ weightKg: 100, reps: 8, rpe: 8 }),
      createMockSetLog({ id: 'set-2', weightKg: 102.5, reps: 6, rpe: 9 }),
      createMockSetLog({ id: 'set-3', weightKg: 102.5, reps: 7, rpe: 9 }),
    ];
    const perf = extractPerformanceFromSets(sets, 'bench-press');
    expect(perf).not.toBeNull();
    expect(perf!.weightKg).toBe(102.5);
    expect(perf!.reps).toBe(7);
    expect(perf!.sets).toBe(3);
    expect(perf!.averageRpe).toBeCloseTo(8.7, 5);
  });

  it('uses effective load for bodyweight sets', () => {
    const sets = [
      createMockSetLog({
        weightKg: 0,
        reps: 10,
        bodyweightData: {
          modification: 'weighted',
          addedWeightKg: 10,
          userBodyweightKg: 80,
          effectiveLoadKg: 90,
        },
      }),
    ];
    const perf = extractPerformanceFromSets(sets, 'pull-up');
    expect(perf!.weightKg).toBe(90);
  });
});

describe('extractBodyweightPerformance', () => {
  it('returns null bodyweightData when no set carries it', () => {
    const { performance, bodyweightData } = extractBodyweightPerformance(
      [createMockSetLog()],
      'bench-press'
    );
    expect(performance).not.toBeNull();
    expect(bodyweightData).toBeNull();
  });

  it('returns the top bodyweight set data by effective load', () => {
    const mk = (effectiveLoadKg: number, reps: number, id: string) =>
      createMockSetLog({
        id,
        reps,
        weightKg: 0,
        bodyweightData: {
          modification: 'weighted',
          addedWeightKg: effectiveLoadKg - 80,
          userBodyweightKg: 80,
          effectiveLoadKg,
        },
      });
    const { bodyweightData } = extractBodyweightPerformance(
      [mk(85, 10, 's1'), mk(90, 8, 's2')],
      'pull-up'
    );
    expect(bodyweightData).not.toBeNull();
    expect(bodyweightData!.effectiveLoadKg).toBe(90);
  });
});

describe('calculateRelativeStrength', () => {
  it('defaults to 1 without bodyweight data or with invalid bodyweight', () => {
    expect(calculateRelativeStrength(createMockSetLog())).toBe(1);
    expect(
      calculateRelativeStrength(
        createMockSetLog({
          bodyweightData: {
            modification: 'none',
            userBodyweightKg: 0,
            effectiveLoadKg: 80,
          },
        })
      )
    ).toBe(1);
  });

  it('computes effective load / bodyweight rounded to 2 decimals', () => {
    const set = createMockSetLog({
      bodyweightData: {
        modification: 'weighted',
        addedWeightKg: 20,
        userBodyweightKg: 80,
        effectiveLoadKg: 100,
      },
    });
    expect(calculateRelativeStrength(set)).toBe(1.25);
  });
});

describe('form display helpers', () => {
  it('maps form ratings to labels', () => {
    expect(getFormLabel('clean')).toBe('Clean');
    expect(getFormLabel('some_breakdown')).toBe('Some Breakdown');
    expect(getFormLabel('ugly')).toBe('Form Breakdown');
  });

  it('maps form ratings to color classes', () => {
    expect(getFormColorClass('clean')).toBe('text-success-400');
    expect(getFormColorClass('some_breakdown')).toBe('text-warning-400');
    expect(getFormColorClass('ugly')).toBe('text-danger-400');
  });
});
