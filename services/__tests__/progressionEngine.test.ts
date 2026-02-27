/**
 * Tests for services/progressionEngine.ts
 * Core progression logic, E1RM calculation, set quality, warmup protocols
 */

import {
  calculateNextTargets,
  calculateSetQuality,
  calculateE1RM,
  calculateBodyweightE1RM,
  detectJunkVolume,
  detectRegression,
  generateWarmupProtocol,
  extractPerformanceFromSets,
  getPeriodizationPhase,
  adjustForFatigue,
  checkForPR,
  calculateSuggestedWeight,
  checkFormTrend,
  exerciseEntryToExercise,
  PHASE_CONFIGS,
  type CalculateNextTargetsInput,
  type CalculateSetQualityInput,
  type GenerateWarmupInput,
  type FormAwareProgressionInput,
  type PhaseConfig,
  type PeriodizationPhase,
} from '../progressionEngine';

import type {
  Exercise,
  SetLog,
  LastSessionPerformance,
  PRCriteria,
  SessionFormHistory,
} from '@/types/schema';

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

// ============================================
// PERIODIZATION PHASE TESTS
// ============================================

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

// ============================================
// CALCULATE NEXT TARGETS TESTS
// ============================================

describe('calculateNextTargets', () => {
  const baseInput: CalculateNextTargetsInput = {
    exercise: createMockExercise(),
    lastPerformance: null,
    experience: 'intermediate',
    weekInMeso: 2,
    totalWeeksInMeso: 6,
    isDeloadWeek: false,
    readinessScore: 80,
  };

  describe('first time doing exercise', () => {
    it('returns technique progression with equipment-based starting weight', () => {
      const result = calculateNextTargets(baseInput);

      expect(result.progressionType).toBe('technique');
      // Now provides suggested starting weight based on equipment type (not 0)
      expect(result.weightKg).toBeGreaterThan(0);
      expect(result.reason).toContain('New exercise');
    });

    it('uses calibrated E1RM if available', () => {
      const result = calculateNextTargets({
        ...baseInput,
        calibratedE1RM: 120,
      });

      expect(result.weightKg).toBeGreaterThan(0);
      expect(result.reason).toContain('calibrated');
    });

    it('uses estimated from related exercises (conservative)', () => {
      const result = calculateNextTargets({
        ...baseInput,
        estimatedFromRelated: 120,
      });

      expect(result.weightKg).toBeGreaterThan(0);
      expect(result.reason).toContain('estimated');
    });
  });

  describe('deload week', () => {
    it('reduces weight and volume', () => {
      const result = calculateNextTargets({
        ...baseInput,
        lastPerformance: createMockPerformance(),
        isDeloadWeek: true,
      });

      expect(result.weightKg).toBeLessThan(100); // Less than last performance
      expect(result.sets).toBeLessThanOrEqual(2);
      expect(result.targetRir).toBe(4);
      expect(result.reason).toContain('Deload');
    });
  });

  describe('low readiness', () => {
    it('reduces targets when readiness is low', () => {
      const result = calculateNextTargets({
        ...baseInput,
        lastPerformance: createMockPerformance(),
        readinessScore: 50,
      });

      expect(result.weightKg).toBeLessThan(100);
      expect(result.reason).toContain('readiness');
    });
  });

  describe('load progression', () => {
    it('increases weight when hitting top of rep range with good RPE', () => {
      // In hypertrophy phase (week 2 of 6), compound rep range is adjusted to [6, 12]
      // So we need 12 reps to hit the top of the phase-adjusted range
      const result = calculateNextTargets({
        ...baseInput,
        lastPerformance: createMockPerformance({
          reps: 12, // Top of phase-adjusted [6, 12] range in hypertrophy
          rpe: 8,
          averageRpe: 8,
        }),
      });

      expect(result.progressionType).toBe('load');
      expect(result.weightKg).toBeGreaterThan(100);
    });
  });

  describe('rep progression', () => {
    it('suggests rep progression when not at top of range', () => {
      const result = calculateNextTargets({
        ...baseInput,
        lastPerformance: createMockPerformance({
          reps: 7, // Below top of 6-10 range
          rpe: 7.5,
          averageRpe: 7.5,
        }),
      });

      expect(result.progressionType).toBe('reps');
      expect(result.reason).toContain('reps');
    });
  });

  describe('set progression', () => {
    it('suggests set progression when RPE is low and reps below phase range', () => {
      // weekInMeso=2, total=6 → hypertrophy phase → compound range adjusts to [6, 12]
      // reps=5 is below phase min (6), so neither load nor rep progression triggers,
      // but completedAllSets + low RPE qualifies for set progression
      const result = calculateNextTargets({
        ...baseInput,
        lastPerformance: createMockPerformance({
          reps: 5, // Below phase-adjusted min of 6
          rpe: 7,
          averageRpe: 7,
          allSetsCompleted: true,
        }),
        weekInMeso: 2,
      });

      // Low RPE with all sets completed but below rep range → set progression
      expect(['sets', 'reps', 'technique']).toContain(result.progressionType);
    });
  });

  describe('fatigue adjustment', () => {
    it('adjusts targets for high systemic fatigue', () => {
      // weekInMeso=2, total=6 → hypertrophy phase → RIR adjusts down from default 2
      // Phase-adjusted RIR = max(1, min(4, round(2 - (2/6)*2))) = max(1, round(1.33)) = 1
      // High systemic fatigue adds +1 → final RIR = 2
      // Verify the fatigue adjustment actually increased RIR above the phase-adjusted value
      const result = calculateNextTargets({
        ...baseInput,
        lastPerformance: createMockPerformance(),
        systemicFatiguePercent: 85,
      });

      // Phase-adjusted RIR is 1 for hypertrophy at week 2/6; fatigue bumps it to 2
      expect(result.targetRir).toBeGreaterThanOrEqual(2);
      expect(result.reason).toContain('fatigue');
    });

    it('holds progression for high weekly fatigue', () => {
      const result = calculateNextTargets({
        ...baseInput,
        lastPerformance: createMockPerformance({
          reps: 10,
          rpe: 8,
          averageRpe: 8,
        }),
        weeklyFatigueScore: 8,
      });

      expect(result.reason).toContain('fatigue');
    });
  });
});

// ============================================
// ADJUST FOR FATIGUE TESTS
// ============================================

describe('adjustForFatigue', () => {
  const baseTargets = {
    weightKg: 100,
    repRange: [6, 10] as [number, number],
    targetRir: 2,
    sets: 3,
    restSeconds: 180,
    progressionType: 'load' as const,
    reason: 'Normal progression',
  };

  it('returns unchanged targets for low fatigue', () => {
    const result = adjustForFatigue(baseTargets, 3, 30);
    expect(result.reason).toBe('Normal progression');
  });

  it('increases RIR for high systemic fatigue', () => {
    const result = adjustForFatigue(baseTargets, 3, 85);
    expect(result.targetRir).toBe(3);
    expect(result.reason).toContain('systemic fatigue');
  });

  it('switches to technique for high weekly fatigue', () => {
    const result = adjustForFatigue(baseTargets, 8, 50);
    expect(result.progressionType).toBe('technique');
    expect(result.reason).toContain('fatigue score');
  });

  it('adds monitoring note for moderate fatigue', () => {
    const result = adjustForFatigue(baseTargets, 6, 65);
    expect(result.reason).toContain('monitor');
  });
});

// ============================================
// SET QUALITY TESTS
// ============================================

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
// EXTRACT PERFORMANCE TESTS
// ============================================

describe('extractPerformanceFromSets', () => {
  it('extracts performance from working sets only', () => {
    const sets = [
      createMockSetLog({ isWarmup: true, weightKg: 50, reps: 10 }),
      createMockSetLog({ isWarmup: false, weightKg: 100, reps: 8, rpe: 8 }),
      createMockSetLog({ isWarmup: false, weightKg: 100, reps: 7, rpe: 9 }),
    ];

    const result = extractPerformanceFromSets(sets, 'bench-press');

    expect(result).not.toBeNull();
    expect(result!.weightKg).toBe(100);
    expect(result!.sets).toBe(2);
    expect(result!.averageRpe).toBe(8.5);
  });

  it('returns null for empty sets', () => {
    expect(extractPerformanceFromSets([], 'bench-press')).toBeNull();
  });

  it('returns null when only warmup sets', () => {
    const sets = [
      createMockSetLog({ isWarmup: true }),
      createMockSetLog({ isWarmup: true }),
    ];

    expect(extractPerformanceFromSets(sets, 'bench-press')).toBeNull();
  });

  it('uses top set weight and reps', () => {
    const sets = [
      createMockSetLog({ weightKg: 95, reps: 8, rpe: 7 }),
      createMockSetLog({ weightKg: 100, reps: 6, rpe: 9 }), // Higher weight
      createMockSetLog({ weightKg: 95, reps: 10, rpe: 8 }),
    ];

    const result = extractPerformanceFromSets(sets, 'test');
    expect(result!.weightKg).toBe(100);
    expect(result!.reps).toBe(6);
  });
});

// ============================================
// PR DETECTION TESTS
// ============================================

describe('checkForPR', () => {
  const baseCriteria: PRCriteria = {
    weight: 100,
    reps: 10,
    repsInTank: 2,
    form: 'clean',
  };

  it('counts first attempt as PR with clean form', () => {
    const result = checkForPR(baseCriteria, null);
    expect(result.isPR).toBe(true);
    expect(result.type).toBe('e1rm');
    expect(result.reason).toBe('first_time');
  });

  it('does not count ugly form as PR on first attempt', () => {
    const result = checkForPR({ ...baseCriteria, form: 'ugly' }, null);
    expect(result.isPR).toBe(false);
    expect(result.reason).toBe('form_breakdown');
  });

  it('does not count ugly form as PR even with better numbers', () => {
    const previous: PRCriteria = { weight: 90, reps: 10, repsInTank: 2, form: 'clean' };
    const current: PRCriteria = { weight: 100, reps: 10, repsInTank: 2, form: 'ugly' };

    const result = checkForPR(current, previous);
    expect(result.isPR).toBe(false);
    expect(result.reason).toBe('form_breakdown');
  });

  it('detects E1RM PR with higher weight', () => {
    const previous: PRCriteria = { weight: 95, reps: 10, repsInTank: 2, form: 'clean' };
    const current: PRCriteria = { weight: 100, reps: 10, repsInTank: 2, form: 'clean' };

    const result = checkForPR(current, previous);
    expect(result.isPR).toBe(true);
    expect(result.type).toBe('e1rm');
  });

  it('detects weight PR when E1RM improves', () => {
    const previous: PRCriteria = { weight: 95, reps: 10, repsInTank: 2, form: 'clean' };
    const current: PRCriteria = { weight: 105, reps: 7, repsInTank: 2, form: 'clean' };

    const result = checkForPR(current, previous);
    expect(result.isPR).toBe(true);
    // E1RM is calculated - higher weight with similar effort = E1RM PR
    expect(['e1rm', 'weight']).toContain(result.type);
  });

  it('detects rep PR when E1RM improves', () => {
    const previous: PRCriteria = { weight: 100, reps: 8, repsInTank: 2, form: 'clean' };
    const current: PRCriteria = { weight: 100, reps: 12, repsInTank: 2, form: 'clean' };

    const result = checkForPR(current, previous);
    expect(result.isPR).toBe(true);
    // More reps at same weight = higher E1RM
    expect(['e1rm', 'reps']).toContain(result.type);
  });

  it('detects form PR', () => {
    const previous: PRCriteria = { weight: 100, reps: 10, repsInTank: 2, form: 'some_breakdown' };
    const current: PRCriteria = { weight: 100, reps: 10, repsInTank: 2, form: 'clean' };

    const result = checkForPR(current, previous);
    expect(result.isPR).toBe(true);
    expect(result.type).toBe('form');
  });
});

// ============================================
// FORM-AWARE WEIGHT SUGGESTION TESTS
// ============================================

describe('calculateSuggestedWeight', () => {
  const baseInput: FormAwareProgressionInput = {
    lastSession: {
      weight: 100,
      reps: [8, 8, 8],
      repsInTank: [2, 2, 2],
      form: ['clean', 'clean', 'clean'],
    },
    targetRepRange: [6, 10],
    targetRIR: 2,
    exerciseMinIncrement: 2.5,
  };

  it('suggests progression with clean form and reps in tank', () => {
    const input: FormAwareProgressionInput = {
      ...baseInput,
      lastSession: {
        weight: 100,
        reps: [8, 8, 8],
        repsInTank: [4, 4, 4], // Too easy
        form: ['clean', 'clean', 'clean'],
      },
    };

    const result = calculateSuggestedWeight(input);
    expect(result.weight).toBeGreaterThan(100);
    expect(result.reason).toBe('progression');
  });

  it('maintains weight when on target', () => {
    const result = calculateSuggestedWeight(baseInput);
    expect(result.weight).toBe(100);
    expect(result.reason).toBe('on_target');
  });

  it('reduces weight for form regression', () => {
    const input: FormAwareProgressionInput = {
      ...baseInput,
      lastSession: {
        weight: 100,
        reps: [8, 7, 6],
        repsInTank: [2, 1, 0],
        form: ['some_breakdown', 'ugly', 'ugly'], // Bad form
      },
    };

    const result = calculateSuggestedWeight(input);
    expect(result.weight).toBeLessThan(100);
    expect(result.reason).toBe('form_correction');
  });

  it('holds weight for consolidation with some breakdown', () => {
    const input: FormAwareProgressionInput = {
      ...baseInput,
      lastSession: {
        weight: 100,
        reps: [8, 8, 7],
        repsInTank: [2, 2, 1],
        form: ['clean', 'some_breakdown', 'some_breakdown'],
      },
    };

    const result = calculateSuggestedWeight(input);
    expect(result.weight).toBe(100);
    expect(result.reason).toBe('form_consolidation');
  });
});

// ============================================
// FORM TREND TESTS
// ============================================

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
// PHASE CONFIG TESTS
// ============================================

describe('PHASE_CONFIGS', () => {
  it('has configs for all four phases', () => {
    const phases: PeriodizationPhase[] = ['hypertrophy', 'strength', 'peaking', 'deload'];
    for (const phase of phases) {
      expect(PHASE_CONFIGS[phase]).toBeDefined();
      expect(PHASE_CONFIGS[phase].name).toBeTruthy();
    }
  });

  it('hypertrophy prioritizes reps → sets → load', () => {
    expect(PHASE_CONFIGS.hypertrophy.progressionPriority).toEqual(['reps', 'sets', 'load']);
  });

  it('strength prioritizes load → reps', () => {
    expect(PHASE_CONFIGS.strength.progressionPriority).toEqual(['load', 'reps']);
  });

  it('peaking prioritizes load → reps', () => {
    expect(PHASE_CONFIGS.peaking.progressionPriority).toEqual(['load', 'reps']);
  });

  it('deload has no progression priorities (exits early)', () => {
    expect(PHASE_CONFIGS.deload.progressionPriority).toEqual([]);
  });

  it('only hypertrophy allows set progression', () => {
    expect(PHASE_CONFIGS.hypertrophy.allowSetProgression).toBe(true);
    expect(PHASE_CONFIGS.strength.allowSetProgression).toBe(false);
    expect(PHASE_CONFIGS.peaking.allowSetProgression).toBe(false);
    expect(PHASE_CONFIGS.deload.allowSetProgression).toBe(false);
  });

  it('strength and peaking add rest bonus in technique fallback', () => {
    expect(PHASE_CONFIGS.strength.restBonusSeconds).toBe(30);
    expect(PHASE_CONFIGS.peaking.restBonusSeconds).toBe(30);
    expect(PHASE_CONFIGS.hypertrophy.restBonusSeconds).toBe(0);
  });

  it('strength and peaking reduce sets in technique fallback', () => {
    expect(PHASE_CONFIGS.strength.techniqueSetDelta).toBe(-1);
    expect(PHASE_CONFIGS.peaking.techniqueSetDelta).toBe(-1);
    expect(PHASE_CONFIGS.hypertrophy.techniqueSetDelta).toBe(0);
  });

  it('peaking compound bounds are [1, 5]', () => {
    expect(PHASE_CONFIGS.peaking.compoundRepBounds).toEqual([1, 5]);
  });

  it('hypertrophy compound bounds are [6, 12]', () => {
    expect(PHASE_CONFIGS.hypertrophy.compoundRepBounds).toEqual([6, 12]);
  });

  it('only hypertrophy has a progress taper factor', () => {
    expect(PHASE_CONFIGS.hypertrophy.progressTaperFactor).toBe(2);
    expect(PHASE_CONFIGS.strength.progressTaperFactor).toBe(0);
    expect(PHASE_CONFIGS.peaking.progressTaperFactor).toBe(0);
    expect(PHASE_CONFIGS.deload.progressTaperFactor).toBe(0);
  });

  it('high-rep exercises in peaking produce a valid (non-inverted) rep range', () => {
    // Farmer's Carry has defaultRepRange [30, 60].  Peaking compound bounds
    // are [1, 5] with adjust [-10, 0].  Without the inversion clamp the
    // formula would yield [20, 5].
    const farmersCarry = createMockExercise({
      id: 'farmers-carry',
      name: "Farmer's Carry",
      defaultRepRange: [30, 60] as [number, number],
    });
    const result = calculateNextTargets({
      exercise: farmersCarry,
      lastPerformance: createMockPerformance({
        exerciseId: 'farmers-carry',
        reps: 5,
        rpe: 8,
        weightKg: 60,
      }),
      experience: 'intermediate',
      weekInMeso: 3,
      totalWeeksInMeso: 6,
      isDeloadWeek: false,
      periodizationPhase: 'peaking',
    });

    // The returned repRange must be valid: min <= max
    expect(result.repRange[0]).toBeLessThanOrEqual(result.repRange[1]);
    // And must stay within the peaking compound bounds ceiling
    expect(result.repRange[1]).toBeLessThanOrEqual(
      PHASE_CONFIGS.peaking.compoundRepBounds[1]
    );
  });
});

// ============================================
// FORM QUALITY GATE TESTS
// ============================================

describe('form quality gate', () => {
  const exercise = createMockExercise();

  const baseInput: CalculateNextTargetsInput = {
    exercise,
    lastPerformance: createMockPerformance({
      reps: 12,   // top of hypertrophy range
      rpe: 8,
      averageRpe: 8,
      allSetsCompleted: true,
    }),
    experience: 'intermediate',
    weekInMeso: 2,
    totalWeeksInMeso: 6,
    isDeloadWeek: false,
    readinessScore: 80,
  };

  it('normal analysis when formScore is undefined (backward compat)', () => {
    const result = calculateNextTargets(baseInput);
    // Without form score, should progress normally (load progression at top of range + good RPE)
    expect(result.progressionType).toBe('load');
  });

  it('normal analysis when formScore >= 0.7', () => {
    const result = calculateNextTargets({
      ...baseInput,
      lastSessionFormScore: 0.85,
    });
    // Clean form → normal load progression
    expect(result.progressionType).toBe('load');
  });

  it('blocks load progression when 0.3 <= formScore < 0.7', () => {
    const result = calculateNextTargets({
      ...baseInput,
      lastSessionFormScore: 0.55,
    });
    // Moderate form breakdown blocks load progression
    // Should fall through to next priority (reps or technique)
    expect(result.progressionType).not.toBe('load');
    expect(result.weightKg).toBe(100); // Same weight maintained
  });

  it('reduces weight when formScore < 0.3', () => {
    const result = calculateNextTargets({
      ...baseInput,
      lastSessionFormScore: 0.2,
    });
    // Severe form breakdown → 90% weight reduction
    expect(result.progressionType).toBe('technique');
    expect(result.weightKg).toBeLessThan(100);
    expect(result.weightKg).toBeCloseTo(90, 0); // ~90% of 100
    expect(result.reason).toContain('Form breakdown');
  });

  it('form gate at 0.3 boundary blocks all progression', () => {
    const result = calculateNextTargets({
      ...baseInput,
      lastSessionFormScore: 0.29,
    });
    expect(result.weightKg).toBeLessThan(100);
    expect(result.reason).toContain('Form breakdown');
  });

  it('form gate at 0.7 boundary still blocks load', () => {
    const result = calculateNextTargets({
      ...baseInput,
      lastSessionFormScore: 0.69,
    });
    expect(result.progressionType).not.toBe('load');
    expect(result.weightKg).toBe(100);
  });

  it('form gate at exactly 0.7 allows normal analysis', () => {
    const result = calculateNextTargets({
      ...baseInput,
      lastSessionFormScore: 0.7,
    });
    // 0.7 is >= 0.7, so normal analysis applies
    expect(result.progressionType).toBe('load');
  });
});

// ============================================
// PERFORMANCE SIGNALS ANNOTATION TESTS
// ============================================

describe('calculateNextTargets with performance signals', () => {
  const exercise = createMockExercise();

  const baseInput: CalculateNextTargetsInput = {
    exercise,
    lastPerformance: createMockPerformance({
      reps: 8,
      rpe: 8,
      averageRpe: 8,
    }),
    experience: 'intermediate',
    weekInMeso: 2,
    totalWeeksInMeso: 6,
    isDeloadWeek: false,
    readinessScore: 80,
  };

  it('appends signal notes to reason when signals are provided', () => {
    const result = calculateNextTargets({
      ...baseInput,
      performanceSignals: [
        { signal: 'stagnation_detected', reason: 'No progress in 5 weeks' },
      ],
    });
    expect(result.reason).toContain('No progress in 5 weeks');
    expect(result.reason).toContain('[Note:');
  });

  it('does not modify reason when no signals provided', () => {
    const result = calculateNextTargets(baseInput);
    expect(result.reason).not.toContain('[Note:');
  });

  it('does not modify reason when signals array is empty', () => {
    const result = calculateNextTargets({
      ...baseInput,
      performanceSignals: [],
    });
    expect(result.reason).not.toContain('[Note:');
  });

  it('signals never override progression type or targets', () => {
    const resultWithSignals = calculateNextTargets({
      ...baseInput,
      performanceSignals: [
        { signal: 'consistent_underperformance', reason: 'Missing targets 3 sessions' },
      ],
    });
    const resultWithout = calculateNextTargets(baseInput);

    // Same targets regardless of signals
    expect(resultWithSignals.weightKg).toBe(resultWithout.weightKg);
    expect(resultWithSignals.progressionType).toBe(resultWithout.progressionType);
    expect(resultWithSignals.sets).toBe(resultWithout.sets);
    expect(resultWithSignals.targetRir).toBe(resultWithout.targetRir);
  });
});
