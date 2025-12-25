/**
 * Tests for services/deloadEngine.ts
 * Deload detection, generation, and fatigue analysis
 */

import {
  checkDeloadTriggers,
  generateDeloadWeek,
  calculateDeloadFrequency,
  getDeloadStrategy,
  calculateFatigueScore,
  assessFatigueScore,
  analyzeFatigueTrend,
} from '../deloadEngine';

import type {
  WeeklyPerformanceData,
  ExtendedUserProfile,
  PeriodizationPlan,
  MesocycleWeek,
} from '@/types/schema';

// ============================================
// TEST FIXTURES
// ============================================

const createMockPerformanceData = (
  overrides: Partial<WeeklyPerformanceData> = {}
): WeeklyPerformanceData => ({
  weekNumber: 1,
  perceivedFatigue: 3,
  sleepQuality: 4,
  motivationLevel: 4,
  missedReps: 0,
  jointPain: false,
  strengthDecline: false,
  ...overrides,
});

const createMockProfile = (
  overrides: Partial<ExtendedUserProfile> = {}
): ExtendedUserProfile => ({
  userId: 'user-1',
  experience: 'intermediate',
  age: 30,
  trainingAge: 3,
  sleepQuality: 4,
  stressLevel: 2,
  ...overrides,
} as ExtendedUserProfile);

const createMockPeriodization = (
  overrides: Partial<PeriodizationPlan> = {}
): PeriodizationPlan => ({
  totalWeeks: 6,
  deloadFrequency: 5,
  deloadType: 'volume',
  ...overrides,
} as PeriodizationPlan);

const createMockWeek = (): MesocycleWeek => ({
  weekNumber: 3,
  focus: 'Hypertrophy',
  volumeModifier: 1.0,
  intensityModifier: 1.0,
  rpeTarget: { min: 7, max: 9 },
  isDeload: false,
  sessions: [
    {
      dayOfWeek: 1,
      focus: 'Push',
      exercises: [
        {
          exerciseId: 'bench-press',
          name: 'Bench Press',
          sets: 4,
          reps: { min: 8, max: 12, targetRIR: 2, notes: '' },
          loadGuidance: 'Use last week weight',
          restSeconds: 180,
        },
      ],
      totalSets: 4,
    },
  ],
});

// ============================================
// DELOAD TRIGGER TESTS
// ============================================

describe('checkDeloadTriggers', () => {
  it('returns no deload with insufficient data', () => {
    const result = checkDeloadTriggers(
      [createMockPerformanceData()],
      createMockProfile(),
      createMockPeriodization()
    );

    expect(result.shouldDeload).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  describe('fatigue trigger', () => {
    it('triggers on elevated fatigue for 2+ weeks', () => {
      const performance = [
        createMockPerformanceData({ perceivedFatigue: 3 }),
        createMockPerformanceData({ perceivedFatigue: 4 }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile(),
        createMockPeriodization()
      );

      expect(result.shouldDeload).toBe(true);
      expect(result.reasons).toContain('Perceived fatigue elevated for 2+ weeks');
    });

    it('does not trigger on single week of high fatigue', () => {
      const performance = [
        createMockPerformanceData({ perceivedFatigue: 2 }),
        createMockPerformanceData({ perceivedFatigue: 5 }),
      ];

      // Last week high, but previous week low
      const result = checkDeloadTriggers(
        performance,
        createMockProfile(),
        createMockPeriodization()
      );

      expect(result.reasons).not.toContain('Perceived fatigue elevated for 2+ weeks');
    });
  });

  describe('performance decline trigger', () => {
    it('triggers on strength decline', () => {
      const performance = [
        createMockPerformanceData(),
        createMockPerformanceData({ strengthDecline: true }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile(),
        createMockPeriodization()
      );

      expect(result.shouldDeload).toBe(true);
      expect(result.suggestedDeloadType).toBe('intensity');
    });

    it('triggers on significant missed reps', () => {
      const performance = [
        createMockPerformanceData(),
        createMockPerformanceData({ missedReps: 8 }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile(),
        createMockPeriodization()
      );

      expect(result.shouldDeload).toBe(true);
      expect(result.reasons.some((r) => r.includes('missed reps'))).toBe(true);
    });
  });

  describe('sleep/recovery trigger', () => {
    it('triggers on poor sleep for 2+ weeks', () => {
      const performance = [
        createMockPerformanceData({ sleepQuality: 2 }),
        createMockPerformanceData({ sleepQuality: 2 }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile(),
        createMockPeriodization()
      );

      expect(result.shouldDeload).toBe(true);
      expect(result.suggestedDeloadType).toBe('full');
      expect(result.reasons.some((r) => r.includes('sleep'))).toBe(true);
    });
  });

  describe('motivation trigger', () => {
    it('triggers on declining motivation', () => {
      const performance = [
        createMockPerformanceData({ motivationLevel: 3 }),
        createMockPerformanceData({ motivationLevel: 2 }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile(),
        createMockPeriodization()
      );

      expect(result.shouldDeload).toBe(true);
      expect(result.reasons.some((r) => r.includes('motivation'))).toBe(true);
    });
  });

  describe('joint pain trigger', () => {
    it('triggers on joint pain', () => {
      const performance = [
        createMockPerformanceData(),
        createMockPerformanceData({ jointPain: true }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile(),
        createMockPeriodization()
      );

      expect(result.shouldDeload).toBe(true);
      expect(result.suggestedDeloadType).toBe('intensity');
      expect(result.reasons.some((r) => r.includes('Joint pain'))).toBe(true);
    });
  });

  describe('time-based trigger', () => {
    it('triggers when overdue for deload', () => {
      const performance = [
        createMockPerformanceData({ weekNumber: 6 }),
        createMockPerformanceData({ weekNumber: 7 }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile(),
        createMockPeriodization({ deloadFrequency: 4 })
      );

      expect(result.shouldDeload).toBe(true);
      expect(result.reasons.some((r) => r.includes('overdue'))).toBe(true);
    });
  });

  describe('experience adjustment', () => {
    it('requires more triggers for novices', () => {
      const performance = [
        createMockPerformanceData({ perceivedFatigue: 3 }),
        createMockPerformanceData({ perceivedFatigue: 4 }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile({ experience: 'novice' }),
        createMockPeriodization()
      );

      // Single trigger insufficient for novice
      expect(result.shouldDeload).toBe(false);
    });

    it('trusts single trigger for advanced lifters', () => {
      const performance = [
        createMockPerformanceData({ perceivedFatigue: 3 }),
        createMockPerformanceData({ perceivedFatigue: 4 }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile({ experience: 'advanced' }),
        createMockPeriodization()
      );

      expect(result.shouldDeload).toBe(true);
    });
  });
});

// ============================================
// DELOAD WEEK GENERATION TESTS
// ============================================

describe('generateDeloadWeek', () => {
  const baseWeek = createMockWeek();

  it('generates volume deload (same weight, fewer sets)', () => {
    const deloadWeek = generateDeloadWeek(baseWeek, 'volume');

    expect(deloadWeek.isDeload).toBe(true);
    expect(deloadWeek.volumeModifier).toBe(0.5);
    expect(deloadWeek.intensityModifier).toBe(1.0);
    expect(deloadWeek.focus).toContain('DELOAD');
  });

  it('generates intensity deload (less weight, moderate volume)', () => {
    const deloadWeek = generateDeloadWeek(baseWeek, 'intensity');

    expect(deloadWeek.volumeModifier).toBe(0.7);
    expect(deloadWeek.intensityModifier).toBe(0.85);
    expect(deloadWeek.sessions[0].exercises[0].loadGuidance).toContain('85%');
  });

  it('generates full deload (light and easy)', () => {
    const deloadWeek = generateDeloadWeek(baseWeek, 'full');

    expect(deloadWeek.volumeModifier).toBe(0.5);
    expect(deloadWeek.intensityModifier).toBe(0.6);
    expect(deloadWeek.rpeTarget).toEqual({ min: 5, max: 6 });
  });

  it('reduces sets in exercises', () => {
    const deloadWeek = generateDeloadWeek(baseWeek, 'volume');

    expect(deloadWeek.sessions[0].exercises[0].sets).toBe(2); // 4 * 0.5 = 2
    expect(deloadWeek.sessions[0].totalSets).toBe(2);
  });

  it('increases target RIR', () => {
    const deloadWeek = generateDeloadWeek(baseWeek, 'volume');

    expect(deloadWeek.sessions[0].exercises[0].reps.targetRIR).toBe(4); // +2 from base 2
  });

  it('adds deload notes to exercises', () => {
    const deloadWeek = generateDeloadWeek(baseWeek, 'volume');

    expect(deloadWeek.sessions[0].exercises[0].reps.notes).toContain('Deload');
  });
});

// ============================================
// DELOAD FREQUENCY CALCULATION TESTS
// ============================================

describe('calculateDeloadFrequency', () => {
  it('returns longer intervals for young lifters', () => {
    const young = calculateDeloadFrequency(createMockProfile({ age: 22 }));
    const older = calculateDeloadFrequency(createMockProfile({ age: 40 }));

    expect(young).toBeGreaterThan(older);
  });

  it('returns longer intervals for novices', () => {
    const novice = calculateDeloadFrequency(createMockProfile({ trainingAge: 0.5 }));
    const experienced = calculateDeloadFrequency(createMockProfile({ trainingAge: 6 }));

    expect(novice).toBeGreaterThan(experienced);
  });

  it('shortens interval for poor sleep/high stress', () => {
    const goodRecovery = calculateDeloadFrequency(
      createMockProfile({ sleepQuality: 5, stressLevel: 1 })
    );
    const poorRecovery = calculateDeloadFrequency(
      createMockProfile({ sleepQuality: 2, stressLevel: 5 })
    );

    expect(goodRecovery).toBeGreaterThan(poorRecovery);
  });

  it('returns reasonable range (3-8 weeks)', () => {
    const frequencies = [
      calculateDeloadFrequency(createMockProfile({ age: 20, trainingAge: 0.5 })),
      calculateDeloadFrequency(createMockProfile({ age: 60, trainingAge: 10 })),
    ];

    frequencies.forEach((freq) => {
      expect(freq).toBeGreaterThanOrEqual(3);
      expect(freq).toBeLessThanOrEqual(8);
    });
  });
});

// ============================================
// DELOAD STRATEGY TESTS
// ============================================

describe('getDeloadStrategy', () => {
  it('returns reactive for novices', () => {
    expect(getDeloadStrategy('novice')).toBe('reactive');
  });

  it('returns proactive for intermediate/advanced', () => {
    expect(getDeloadStrategy('intermediate')).toBe('proactive');
    expect(getDeloadStrategy('advanced')).toBe('proactive');
  });
});

// ============================================
// FATIGUE SCORE TESTS
// ============================================

describe('calculateFatigueScore', () => {
  it('returns low score for good conditions', () => {
    const score = calculateFatigueScore(
      createMockPerformanceData({
        perceivedFatigue: 1,
        sleepQuality: 5,
        motivationLevel: 5,
        missedReps: 0,
        jointPain: false,
        strengthDecline: false,
      })
    );

    expect(score).toBeLessThan(25);
  });

  it('returns high score for poor conditions', () => {
    const score = calculateFatigueScore(
      createMockPerformanceData({
        perceivedFatigue: 5,
        sleepQuality: 1,
        motivationLevel: 1,
        missedReps: 10,
        jointPain: true,
        strengthDecline: true,
      })
    );

    expect(score).toBeGreaterThan(75);
  });

  it('caps score at 100', () => {
    const score = calculateFatigueScore(
      createMockPerformanceData({
        perceivedFatigue: 5,
        sleepQuality: 1,
        motivationLevel: 1,
        missedReps: 20,
        jointPain: true,
        strengthDecline: true,
      })
    );

    expect(score).toBe(100);
  });

  it('increases score for missed reps', () => {
    const noMisses = calculateFatigueScore(createMockPerformanceData({ missedReps: 0 }));
    const manyMisses = calculateFatigueScore(createMockPerformanceData({ missedReps: 5 }));

    expect(manyMisses).toBeGreaterThan(noMisses);
  });

  it('increases score for joint pain', () => {
    const noPain = calculateFatigueScore(createMockPerformanceData({ jointPain: false }));
    const withPain = calculateFatigueScore(createMockPerformanceData({ jointPain: true }));

    expect(withPain).toBeGreaterThan(noPain);
  });
});

describe('assessFatigueScore', () => {
  it('returns low for scores under 25', () => {
    const result = assessFatigueScore(20);
    expect(result.level).toBe('low');
    expect(result.recommendation).toContain('Continue');
  });

  it('returns moderate for scores 25-49', () => {
    const result = assessFatigueScore(35);
    expect(result.level).toBe('moderate');
    expect(result.recommendation).toContain('Monitor');
  });

  it('returns high for scores 50-74', () => {
    const result = assessFatigueScore(60);
    expect(result.level).toBe('high');
    expect(result.recommendation).toContain('deload');
  });

  it('returns critical for scores 75+', () => {
    const result = assessFatigueScore(80);
    expect(result.level).toBe('critical');
    expect(result.recommendation).toContain('rest');
  });
});

// ============================================
// FATIGUE TREND TESTS
// ============================================

describe('analyzeFatigueTrend', () => {
  it('returns stable with insufficient data', () => {
    const result = analyzeFatigueTrend([createMockPerformanceData()]);

    expect(result.trend).toBe('stable');
    expect(result.recommendation).toContain('Not enough data');
  });

  it('detects worsening trend', () => {
    const performances = [
      createMockPerformanceData({ perceivedFatigue: 2, sleepQuality: 4, motivationLevel: 4 }),
      createMockPerformanceData({ perceivedFatigue: 3, sleepQuality: 3, motivationLevel: 3 }),
      createMockPerformanceData({ perceivedFatigue: 4, sleepQuality: 2, motivationLevel: 2 }),
    ];

    const result = analyzeFatigueTrend(performances);

    expect(result.trend).toBe('worsening');
  });

  it('detects improving trend', () => {
    const performances = [
      createMockPerformanceData({ perceivedFatigue: 4, sleepQuality: 2, motivationLevel: 2 }),
      createMockPerformanceData({ perceivedFatigue: 3, sleepQuality: 3, motivationLevel: 3 }),
      createMockPerformanceData({ perceivedFatigue: 2, sleepQuality: 4, motivationLevel: 4 }),
    ];

    const result = analyzeFatigueTrend(performances);

    expect(result.trend).toBe('improving');
  });

  it('calculates average and peak scores', () => {
    const performances = [
      createMockPerformanceData({ perceivedFatigue: 3, sleepQuality: 3 }),
      createMockPerformanceData({ perceivedFatigue: 4, sleepQuality: 2 }),
      createMockPerformanceData({ perceivedFatigue: 3, sleepQuality: 3 }),
    ];

    const result = analyzeFatigueTrend(performances);

    expect(result.averageScore).toBeGreaterThan(0);
    expect(result.peakScore).toBeGreaterThanOrEqual(result.averageScore);
  });

  it('recommends deload for worsening high fatigue', () => {
    const performances = [
      createMockPerformanceData({ perceivedFatigue: 3, sleepQuality: 3, motivationLevel: 3 }),
      createMockPerformanceData({ perceivedFatigue: 4, sleepQuality: 2, motivationLevel: 2 }),
      createMockPerformanceData({ perceivedFatigue: 5, sleepQuality: 1, motivationLevel: 2 }),
    ];

    const result = analyzeFatigueTrend(performances);

    expect(result.recommendation).toContain('deload');
  });
});
