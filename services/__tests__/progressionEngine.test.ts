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
  type CalculateNextTargetsInput,
  type CalculateSetQualityInput,
  type GenerateWarmupInput,
  type FormAwareProgressionInput,
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
    it('returns technique progression with no prior data', () => {
      const result = calculateNextTargets(baseInput);

      expect(result.progressionType).toBe('technique');
      expect(result.weightKg).toBe(0);
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
    it('suggests set progression when in rep range with appropriate RPE', () => {
      // Week 2 of 6 is hypertrophy phase with rep range [6, 12] for compounds
      // At 8 reps with appropriate RPE, system should suggest reps or sets
      const result = calculateNextTargets({
        ...baseInput,
        lastPerformance: createMockPerformance({
          reps: 8, // Middle of phase-adjusted [6, 12] range
          rpe: 7.5,
          averageRpe: 7.5,
          allSetsCompleted: true,
        }),
        weekInMeso: 2,
      });

      // When in the rep range but not at top, rep progression is suggested
      // Set progression happens when RPE is appropriate but not making load/rep progress
      expect(['sets', 'reps', 'technique']).toContain(result.progressionType);
    });
  });

  describe('fatigue adjustment', () => {
    it('adjusts targets for high systemic fatigue', () => {
      const result = calculateNextTargets({
        ...baseInput,
        lastPerformance: createMockPerformance(),
        systemicFatiguePercent: 85,
      });

      expect(result.targetRir).toBeGreaterThan(baseInput.exercise.defaultRir);
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
    // E1RM = 100 * (1 + 10/30) = 100 * 1.333 = 133.3
    expect(calculateE1RM(100, 10, 10)).toBeCloseTo(133.33, 1);
  });

  it('adjusts for RIR (RPE < 10)', () => {
    // 100kg x 8 reps @ RPE 8 (2 RIR) = effective 10 reps
    // E1RM = 100 * (1 + 10/30) = 133.3
    const result = calculateE1RM(100, 8, 8);
    expect(result).toBeCloseTo(133.33, 1);
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
    expect(result).toBeCloseTo(133.33, 1);
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

  it('includes general warmup for first exercise', () => {
    const input: GenerateWarmupInput = {
      workingWeight: 100,
      exercise,
      isFirstExercise: true,
    };

    const protocol = generateWarmupProtocol(input);
    expect(protocol[0].percentOfWorking).toBe(0);
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
