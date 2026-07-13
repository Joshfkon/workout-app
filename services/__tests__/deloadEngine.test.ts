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
  computeJointPainSignal,
  computeSleepDebtSignal,
  JOINT_PAIN_SEVERITY_WEIGHTS,
  JOINT_PAIN_WINDOW_DAYS,
  JOINT_PAIN_MAX_SCORE,
  JOINT_PAIN_TRIGGER_THRESHOLD,
  SLEEP_DEBT_AVG_THRESHOLD_HOURS,
  SLEEP_DEBT_MAX_SCORE,
  SLEEP_DEBT_WINDOW_DAYS,
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
      day: 'Monday',
      focus: 'Push',
      exercises: [
        {
          exercise: {
            name: 'Bench Press',
            primaryMuscle: 'chest',
            secondaryMuscles: ['triceps', 'shoulders'],
            pattern: 'horizontal_push',
            equipment: 'barbell',
            difficulty: 'intermediate',
            fatigueRating: 2,
          },
          sets: 4,
          reps: { min: 8, max: 12, targetRIR: 2, tempoRecommendation: '2-0-1-0', notes: '' },
          loadGuidance: 'Use last week weight',
          restSeconds: 180,
          notes: '',
          fatigueProfile: {
            systemicCost: 0.5,
            localCost: { chest: 0.8 },
            sfr: 1.0,
            efficiency: 'optimal',
          },
        },
      ],
      totalSets: 4,
      estimatedMinutes: 30,
      warmup: ['Light cardio', 'Dynamic stretches'],
      fatigueSummary: {
        systemicFatigueGenerated: 0.5,
        systemicCapacityUsed: 0.3,
        averageSFR: 1.0,
        localFatigueByMuscle: { chest: 0.8 },
      },
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

    it('triggers on a severity-weighted event score at/above the threshold', () => {
      const performance = [
        createMockPerformanceData(),
        createMockPerformanceData({ jointPainScore: JOINT_PAIN_TRIGGER_THRESHOLD }),
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

    it('does not trigger on a sub-threshold event score', () => {
      const performance = [
        createMockPerformanceData(),
        createMockPerformanceData({ jointPainScore: JOINT_PAIN_TRIGGER_THRESHOLD - 1 }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile(),
        createMockPeriodization()
      );

      expect(result.reasons.some((r) => r.includes('Joint pain'))).toBe(false);
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

    it('a deload-flagged week resets the overdue clock', () => {
      // Weeks 6, 7, 8 with deloadFrequency 4 → the backup trigger (>= 4 + 2 = 6
      // weeks) would normally fire on the raw week number. But week 7 was a
      // deload, so accumulation resets: only 1 week since the last deload, not
      // overdue.
      const performance = [
        createMockPerformanceData({ weekNumber: 6 }),
        createMockPerformanceData({ weekNumber: 7, isDeload: true }),
        createMockPerformanceData({ weekNumber: 8 }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile(),
        createMockPeriodization({ deloadFrequency: 4 })
      );

      expect(result.reasons.some((r) => r.includes('overdue'))).toBe(false);
    });

    it('still fires the overdue clock counting from the last deload week', () => {
      // Deload at week 2, now week 8 → 6 weeks since last deload, which is
      // >= deloadFrequency (4) + 2, so the backup trigger fires again.
      const performance = [
        createMockPerformanceData({ weekNumber: 2, isDeload: true }),
        createMockPerformanceData({ weekNumber: 7 }),
        createMockPerformanceData({ weekNumber: 8 }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile(),
        createMockPeriodization({ deloadFrequency: 4 })
      );

      expect(result.shouldDeload).toBe(true);
      expect(result.reasons.some((r) => r.includes('since last deload'))).toBe(true);
    });
  });

  describe('experience adjustment', () => {
    it('novices deload more readily (single trigger sufficient)', () => {
      // Novices have less efficient CNS patterns and are more prone to overtraining
      // They should deload more readily, not less
      const performance = [
        createMockPerformanceData({ perceivedFatigue: 3 }),
        createMockPerformanceData({ perceivedFatigue: 4 }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile({ experience: 'novice' }),
        createMockPeriodization()
      );

      // Single trigger IS sufficient for novice
      expect(result.shouldDeload).toBe(true);
    });

    it('advanced lifters require more triggers before deloading', () => {
      // Advanced lifters are better at self-regulating and have more efficient
      // movement patterns - they can handle more fatigue before needing deload
      const performance = [
        createMockPerformanceData({ perceivedFatigue: 3 }),
        createMockPerformanceData({ perceivedFatigue: 4 }),
      ];

      const result = checkDeloadTriggers(
        performance,
        createMockProfile({ experience: 'advanced' }),
        createMockPeriodization()
      );

      // Advanced needs more evidence of fatigue
      expect(result.shouldDeload).toBe(false);
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

  it('returns shorter intervals for novices (more frequent deloads)', () => {
    // Novices need more frequent deloads due to CNS inefficiency
    const novice = calculateDeloadFrequency(createMockProfile({ trainingAge: 0.5 }));
    const experienced = calculateDeloadFrequency(createMockProfile({ trainingAge: 6 }));

    expect(novice).toBeLessThan(experienced);
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
  it('returns proactive for novices/intermediate (scheduled deloads for safety)', () => {
    // Novices often don't recognize fatigue signals, so scheduled deloads are safer
    expect(getDeloadStrategy('novice')).toBe('proactive');
    expect(getDeloadStrategy('intermediate')).toBe('proactive');
  });

  it('returns reactive for advanced lifters (they can read their body)', () => {
    // Advanced lifters are better at recognizing fatigue and can respond as needed
    expect(getDeloadStrategy('advanced')).toBe('reactive');
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

// ============================================
// JOINT PAIN SIGNAL (SIGNAL 5) TESTS
// ============================================

describe('computeJointPainSignal', () => {
  const NOW = new Date('2026-07-13T12:00:00.000Z');
  const daysAgo = (days: number) =>
    new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

  it('returns 0 with no events', () => {
    expect(computeJointPainSignal([], NOW)).toBe(0);
  });

  it('weights events by severity (stop > pain > twinge)', () => {
    const twinge = computeJointPainSignal(
      [{ severity: 'twinge', occurredAt: daysAgo(1) }],
      NOW
    );
    const pain = computeJointPainSignal(
      [{ severity: 'pain', occurredAt: daysAgo(1) }],
      NOW
    );
    const stop = computeJointPainSignal(
      [{ severity: 'stop', occurredAt: daysAgo(1) }],
      NOW
    );

    expect(twinge).toBe(JOINT_PAIN_SEVERITY_WEIGHTS.twinge * 2);
    expect(pain).toBe(JOINT_PAIN_SEVERITY_WEIGHTS.pain * 2);
    expect(stop).toBe(JOINT_PAIN_SEVERITY_WEIGHTS.stop * 2);
    expect(stop).toBeGreaterThan(pain);
    expect(pain).toBeGreaterThan(twinge);
  });

  it('ignores events outside the trailing window (and future events)', () => {
    const score = computeJointPainSignal(
      [
        { severity: 'stop', occurredAt: daysAgo(JOINT_PAIN_WINDOW_DAYS + 1) },
        { severity: 'stop', occurredAt: daysAgo(-1) }, // future
      ],
      NOW
    );
    expect(score).toBe(0);
  });

  it('caps the contribution at JOINT_PAIN_MAX_SCORE regardless of event count', () => {
    const events = Array.from({ length: 40 }, (_, i) => ({
      severity: 'stop' as const,
      occurredAt: daysAgo((i % 13) + 0.5),
    }));
    expect(computeJointPainSignal(events, NOW)).toBe(JOINT_PAIN_MAX_SCORE);
  });

  it('a single true pain event reaches the deload trigger threshold', () => {
    const score = computeJointPainSignal(
      [{ severity: 'pain', occurredAt: daysAgo(3) }],
      NOW
    );
    expect(score).toBeGreaterThanOrEqual(JOINT_PAIN_TRIGGER_THRESHOLD);
  });
});

describe('calculateFatigueScore with jointPainScore', () => {
  it('uses the weighted score instead of the boolean flat 10 when present', () => {
    const base = createMockPerformanceData({ jointPain: false });
    const withScore = createMockPerformanceData({ jointPain: false, jointPainScore: 4 });

    expect(calculateFatigueScore(withScore) - calculateFatigueScore(base)).toBe(4);
  });

  it('caps the jointPainScore contribution at the boolean\'s 10 points', () => {
    const boolPain = createMockPerformanceData({ jointPain: true });
    const hugeScore = createMockPerformanceData({ jointPain: false, jointPainScore: 999 });

    expect(calculateFatigueScore(hugeScore)).toBe(calculateFatigueScore(boolPain));
  });

  it('falls back to the legacy boolean when jointPainScore is absent', () => {
    const base = createMockPerformanceData({ jointPain: false });
    const boolPain = createMockPerformanceData({ jointPain: true });

    expect(calculateFatigueScore(boolPain) - calculateFatigueScore(base)).toBe(10);
  });
});

// ============================================
// CHRONIC SHORT SLEEP SIGNAL (SIGNAL 7)
// ============================================

const SLEEP_NOW = new Date('2026-07-11T12:00:00');

/** YYYY-MM-DD local-day string for SLEEP_NOW minus `days`. */
function sleepDayAgo(days: number): string {
  const d = new Date(SLEEP_NOW.getTime() - days * 24 * 60 * 60 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** A full week of nights at the given hours (index 0 = last night). */
function weekOfNights(hoursPerNight: number[]): { localDay: string; hours: number }[] {
  return hoursPerNight.map((hours, i) => ({ localDay: sleepDayAgo(i), hours }));
}

describe('computeSleepDebtSignal', () => {
  it('a 5.9h weekly average yields a small score and the labeled evidence line', () => {
    const signal = computeSleepDebtSignal(
      weekOfNights([5.5, 6, 6.5, 5.5, 6, 6, 5.8]), // avg ≈ 5.9
      SLEEP_NOW
    );

    expect(signal.avgHours).toBeCloseTo(5.9, 1);
    expect(signal.evidence).toBe(
      `Averaging ${signal.avgHours!.toFixed(1)}h sleep over the last week`
    );
    expect(signal.evidence).toContain('5.9h sleep');
    expect(signal.score).toBeGreaterThan(0);
    expect(signal.score).toBeLessThanOrEqual(SLEEP_DEBT_MAX_SCORE);
  });

  it('an average at/above the 6.5h threshold produces no signal', () => {
    const signal = computeSleepDebtSignal(weekOfNights([6.5, 7, 6.5, 7, 8, 7, 6.5]), SLEEP_NOW);
    expect(signal.score).toBe(0);
    expect(signal.evidence).toBeNull();
    expect(signal.avgHours).toBeGreaterThanOrEqual(SLEEP_DEBT_AVG_THRESHOLD_HOURS);
  });

  it('fewer than SLEEP_DEBT_MIN_NIGHTS logged nights is not "chronic" — no signal', () => {
    const signal = computeSleepDebtSignal(weekOfNights([4, 4]), SLEEP_NOW);
    expect(signal.score).toBe(0);
    expect(signal.avgHours).toBeNull();
    expect(signal.evidence).toBeNull();
  });

  it('caps the score at SLEEP_DEBT_MAX_SCORE for extreme deprivation', () => {
    const signal = computeSleepDebtSignal(weekOfNights([2, 2, 2, 2, 2, 2, 2]), SLEEP_NOW);
    expect(signal.score).toBe(SLEEP_DEBT_MAX_SCORE);
  });

  it('ignores nights outside the trailing window (and future days)', () => {
    const signal = computeSleepDebtSignal(
      [
        { localDay: sleepDayAgo(SLEEP_DEBT_WINDOW_DAYS + 2), hours: 2 },
        { localDay: sleepDayAgo(SLEEP_DEBT_WINDOW_DAYS + 3), hours: 2 },
        { localDay: sleepDayAgo(-1), hours: 2 }, // future
        { localDay: sleepDayAgo(0), hours: 8 },
        { localDay: sleepDayAgo(1), hours: 8 },
        { localDay: sleepDayAgo(2), hours: 8 },
      ],
      SLEEP_NOW
    );
    expect(signal.score).toBe(0);
    expect(signal.avgHours).toBeCloseTo(8, 5);
  });
});

describe('checkDeloadTriggers with chronic short sleep', () => {
  const sleepSignal = { sleepDebtScore: 2, sleepDebtEvidence: 'Averaging 5.9h sleep over the last week' };

  it('appends the evidence line when a real trigger fires', () => {
    const result = checkDeloadTriggers(
      [
        createMockPerformanceData({ weekNumber: 1, perceivedFatigue: 3 }),
        createMockPerformanceData({ weekNumber: 2, perceivedFatigue: 4, ...sleepSignal }),
      ],
      createMockProfile(),
      createMockPeriodization()
    );

    expect(result.shouldDeload).toBe(true);
    expect(result.reasons).toContain('Averaging 5.9h sleep over the last week');
  });

  it('never forces a deload on its own — even for novices', () => {
    const calm = [
      createMockPerformanceData({ weekNumber: 1 }),
      createMockPerformanceData({ weekNumber: 2, ...sleepSignal }),
    ];

    expect(
      checkDeloadTriggers(calm, createMockProfile(), createMockPeriodization()).shouldDeload
    ).toBe(false);
    expect(
      checkDeloadTriggers(calm, createMockProfile({ experience: 'novice' }), createMockPeriodization())
        .shouldDeload
    ).toBe(false);
  });

  it('does not count toward the advanced two-trigger requirement', () => {
    // One real trigger + the sleep evidence: advanced lifters still need 2 REAL markers.
    const result = checkDeloadTriggers(
      [
        createMockPerformanceData({ weekNumber: 1, perceivedFatigue: 3 }),
        createMockPerformanceData({ weekNumber: 2, perceivedFatigue: 4, ...sleepSignal }),
      ],
      createMockProfile({ experience: 'advanced' }),
      createMockPeriodization()
    );
    expect(result.shouldDeload).toBe(false);
  });
});

describe('calculateFatigueScore with sleepDebtScore', () => {
  it('adds the capped sleep bump to the score', () => {
    const base = createMockPerformanceData();
    const withSleepDebt = createMockPerformanceData({ sleepDebtScore: 5 });
    expect(calculateFatigueScore(withSleepDebt) - calculateFatigueScore(base)).toBe(5);
  });

  it('caps the contribution at SLEEP_DEBT_MAX_SCORE', () => {
    const base = createMockPerformanceData();
    const huge = createMockPerformanceData({ sleepDebtScore: 999 });
    expect(calculateFatigueScore(huge) - calculateFatigueScore(base)).toBe(SLEEP_DEBT_MAX_SCORE);
  });
});
