/**
 * Tests for Weight Estimation Engine
 *
 * Tests weight recommendations based on user history, related exercises,
 * strength standards, and bodyweight ratios.
 */
import {
  calculateBodyComposition,
  estimate1RM,
  WeightEstimationEngine,
  createStrengthProfile,
  quickWeightEstimate,
  createEstimatedMaxesFromCalibration,
  quickWeightEstimateWithCalibration,
  estimateFromTransferCandidates,
  buildTransferCandidatesFromRows,
  resolveBodyweightRatio,
  isLowerBodyMachineIsolation,
  LOWER_BODY_MACHINE_ISOLATION_RATIO_FLOOR,
  SAME_MUSCLE_TRANSFER_FACTOR,
  DEFAULT_SAME_PATTERN_TRANSFER_FACTOR,
  type BodyComposition,
  type ExerciseHistoryEntry,
  type UserStrengthProfile,
  type EstimatedMax,
  type TransferCandidate,
  type TransferSourceRow,
} from '../weightEstimationEngine';
import type { Experience } from '@/types/schema';
import { makeRegionalAnalysis, makeBodyPartAnalysis } from '@/test-utils/factories';

// ============================================
// TEST HELPERS
// ============================================

function createTestProfile(overrides: Partial<UserStrengthProfile> = {}): UserStrengthProfile {
  return {
    bodyComposition: {
      totalWeightKg: 80,
      bodyFatPercentage: 15,
      leanMassKg: 68,
      ffmi: 22.5,
    },
    experience: 'intermediate',
    trainingAge: 3,
    exerciseHistory: [],
    knownMaxes: [],
    ...overrides,
  };
}

function createHistoryEntry(
  exerciseName: string,
  weight: number,
  reps: number,
  daysAgo: number = 0,
  rpe?: number
): ExerciseHistoryEntry {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return {
    exerciseName,
    date,
    sets: [{ weight, reps, rpe, completed: true }],
  };
}

// ============================================
// BODY COMPOSITION TESTS
// ============================================

describe('calculateBodyComposition', () => {
  it('calculates lean mass correctly', () => {
    const result = calculateBodyComposition(80, 20, 180);

    expect(result.totalWeightKg).toBe(80);
    expect(result.bodyFatPercentage).toBe(20);
    expect(result.leanMassKg).toBe(64); // 80 * 0.8
  });

  it('calculates FFMI correctly for average male', () => {
    // 80kg, 15% BF, 180cm
    // Lean mass = 80 * 0.85 = 68kg
    // FFMI = 68 / 1.8^2 + 6.1 * (1.8 - 1.8) = 68 / 3.24 = 20.99
    const result = calculateBodyComposition(80, 15, 180);

    expect(result.leanMassKg).toBe(68);
    expect(result.ffmi).toBeCloseTo(21.0, 0);
  });

  it('calculates FFMI with height adjustment for short person', () => {
    // Height adjustment: 6.1 * (1.8 - height)
    // For 170cm: 6.1 * (1.8 - 1.7) = 6.1 * 0.1 = 0.61
    const result = calculateBodyComposition(70, 15, 170);

    // FFMI = lean / height^2 + height adjustment
    expect(result.ffmi).toBeGreaterThan(20); // Short stature increases normalized FFMI
  });

  it('calculates FFMI with height adjustment for tall person', () => {
    // For 190cm: 6.1 * (1.8 - 1.9) = 6.1 * -0.1 = -0.61
    const result = calculateBodyComposition(90, 15, 190);

    expect(result.ffmi).toBeDefined();
    expect(result.leanMassKg).toBeCloseTo(76.5, 1);
  });

  it('handles edge case of 0% body fat', () => {
    const result = calculateBodyComposition(75, 0, 175);

    expect(result.leanMassKg).toBe(75);
    expect(result.bodyFatPercentage).toBe(0);
  });

  it('rounds FFMI to one decimal place', () => {
    const result = calculateBodyComposition(82.5, 12, 178);

    // FFMI should be a reasonable number (typically 18-28 for natural athletes)
    expect(result.ffmi).toBeGreaterThan(15);
    expect(result.ffmi).toBeLessThan(35);
    // Should be rounded (no more than 1 decimal)
    expect(Math.round(result.ffmi * 10) / 10).toBeCloseTo(result.ffmi, 1);
  });
});

// ============================================
// 1RM ESTIMATION TESTS
// ============================================

describe('estimate1RM', () => {
  it('returns the weight for 1 rep', () => {
    expect(estimate1RM(100, 1)).toBe(100);
    expect(estimate1RM(150, 1)).toBe(150);
  });

  it('estimates 1RM from 5 reps correctly', () => {
    // Using multiple formulas averaged
    // 100kg for 5 reps is typically ~115kg 1RM
    const result = estimate1RM(100, 5);

    expect(result).toBeGreaterThan(110);
    expect(result).toBeLessThan(120);
  });

  it('estimates 1RM from 10 reps', () => {
    // 100kg for 10 reps is typically ~133kg 1RM
    const result = estimate1RM(100, 10);

    expect(result).toBeGreaterThan(125);
    expect(result).toBeLessThan(140);
  });

  it('computes 13-15 effective reps at the 12 cap, none beyond 15', () => {
    // Canonical estimator: 13-15 effective reps compute at the cap
    // (50 * 36/25 = 72); beyond 15 there is NO estimate (0).
    expect(estimate1RM(50, 15)).toBeCloseTo(72, 1);
    expect(estimate1RM(50, 16)).toBe(0);
  });

  it('adjusts for RPE when provided', () => {
    // RPE 8 means 2 reps in reserve
    // Effective reps = actual reps + (10 - RPE)
    const withRPE = estimate1RM(100, 5, 8); // effective reps = 5 + 2 = 7
    const withoutRPE = estimate1RM(100, 5); // effective reps = 5

    expect(withRPE).toBeGreaterThan(withoutRPE);
  });

  it('RPE 10 does not add effective reps', () => {
    const rpe10 = estimate1RM(100, 5, 10);
    const noRpe = estimate1RM(100, 5);

    expect(rpe10).toBeCloseTo(noRpe, 1);
  });

  it('rounds to one decimal place', () => {
    const result = estimate1RM(100, 5);
    expect(result.toString()).toMatch(/^\d+(\.\d)?$/);
  });
});

// ============================================
// WEIGHT ESTIMATION ENGINE TESTS
// ============================================

describe('WeightEstimationEngine', () => {
  describe('constructor', () => {
    it('initializes with known maxes from profile', () => {
      const profile = createTestProfile({
        knownMaxes: [
          {
            exercise: 'Bench Press',
            estimated1RM: 100,
            confidence: 'high',
            source: 'direct_history',
            lastUpdated: new Date(), // Recent data
          },
        ],
      });

      const engine = new WeightEstimationEngine(profile);
      const result = engine.getWorkingWeight('Bench Press', { min: 8, max: 12 }, 2);

      // Should find the known max and use it for estimation
      expect(result.recommendedWeight).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(result.confidence);
    });

    it('accepts unit parameter', () => {
      const profile = createTestProfile();

      const engineKg = new WeightEstimationEngine(profile, 'kg');
      const engineLb = new WeightEstimationEngine(profile, 'lb');

      expect(engineKg).toBeDefined();
      expect(engineLb).toBeDefined();
    });
  });

  describe('getWorkingWeight', () => {
    it('returns high confidence recommendation for known exercise', () => {
      const profile = createTestProfile({
        knownMaxes: [
          {
            exercise: 'Barbell Bench Press',
            estimated1RM: 100,
            confidence: 'high',
            source: 'direct_history',
            lastUpdated: new Date(),
          },
        ],
      });

      const engine = new WeightEstimationEngine(profile);
      const result = engine.getWorkingWeight('Barbell Bench Press', { min: 8, max: 12 }, 2);

      expect(result.exercise).toBe('Barbell Bench Press');
      expect(result.confidence).toBe('high');
      expect(result.recommendedWeight).toBeGreaterThan(0);
      expect(result.weightRange.low).toBeLessThan(result.recommendedWeight);
      expect(result.weightRange.high).toBeGreaterThan(result.recommendedWeight);
    });

    it('returns low confidence with finding protocol for completely unknown exercise', () => {
      const profile = createTestProfile();

      const engine = new WeightEstimationEngine(profile);
      const result = engine.getWorkingWeight('Some Obscure Exercise', { min: 8, max: 12 }, 2);

      // Unknown exercises now fall back to bodyweight-based estimation with 'low' confidence
      // rather than 'find_working_weight', but still include the finding protocol
      expect(result.confidence).toBe('low');
      expect(result.findingWeightProtocol).toBeDefined();
      expect(result.findingWeightProtocol?.startingWeight).toBeGreaterThan(0);
      expect(result.findingWeightProtocol?.instructions).toContain('Start');
    });

    it('uses direct history when available', () => {
      const profile = createTestProfile({
        exerciseHistory: [
          createHistoryEntry('Squat', 100, 5, 7), // 7 days ago
          createHistoryEntry('Squat', 102.5, 5, 3), // 3 days ago
        ],
      });

      const engine = new WeightEstimationEngine(profile);
      const result = engine.getWorkingWeight('Squat', { min: 5, max: 8 }, 2);

      expect(result.rationale).toContain('recent training history');
    });

    it('estimates from strength standards when no history', () => {
      const profile = createTestProfile({
        bodyComposition: {
          totalWeightKg: 80,
          bodyFatPercentage: 15,
          leanMassKg: 68,
          ffmi: 22,
        },
        experience: 'intermediate',
      });

      const engine = new WeightEstimationEngine(profile);
      const result = engine.getWorkingWeight('Barbell Bench Press', { min: 8, max: 12 }, 2);

      // Without history, should use strength standards or bodyweight ratio
      expect(result.confidence).toBe('low');
      // The rationale may vary based on the estimation source
      expect(result.rationale.length).toBeGreaterThan(0);
    });

    it('provides warmup protocol for known exercises', () => {
      const profile = createTestProfile({
        knownMaxes: [
          {
            exercise: 'Squat',
            estimated1RM: 140,
            confidence: 'high',
            source: 'direct_history',
            lastUpdated: new Date(),
          },
        ],
      });

      const engine = new WeightEstimationEngine(profile);
      const result = engine.getWorkingWeight('Squat', { min: 5, max: 8 }, 2);

      expect(result.warmupProtocol).toBeDefined();
      expect(result.warmupProtocol?.length).toBeGreaterThan(0);
      expect(result.warmupProtocol?.[0].percentOfWorking).toBeLessThan(1);
      expect(result.warmupProtocol?.[0].reps).toBeGreaterThan(0);
    });

    it('includes finding weight protocol for low confidence', () => {
      const profile = createTestProfile();

      const engine = new WeightEstimationEngine(profile);
      // Using a specific exercise that will get low confidence
      const result = engine.getWorkingWeight('Cable Lateral Raise', { min: 10, max: 15 }, 2);

      if (result.confidence === 'low' || result.confidence === 'find_working_weight') {
        expect(result.findingWeightProtocol).toBeDefined();
      }
    });
  });

  describe('related exercise estimation', () => {
    it('estimates from parent exercise (e.g., incline from flat bench)', () => {
      const profile = createTestProfile({
        exerciseHistory: [
          createHistoryEntry('Barbell Bench Press', 100, 5, 5),
          createHistoryEntry('Barbell Bench Press', 100, 5, 3),
          createHistoryEntry('Barbell Bench Press', 102.5, 5, 1),
        ],
      });

      const engine = new WeightEstimationEngine(profile);
      // Incline is ~80% of flat bench
      const result = engine.getWorkingWeight('Incline Barbell Press', { min: 8, max: 12 }, 2);

      expect(result.rationale).toContain('similar exercises');
    });
  });

  describe('updateFromWorkout', () => {
    it('updates estimated max from new workout data', () => {
      const profile = createTestProfile({
        knownMaxes: [
          {
            exercise: 'Deadlift',
            estimated1RM: 150,
            confidence: 'medium',
            source: 'direct_history',
          },
        ],
      });

      const engine = new WeightEstimationEngine(profile);

      // Simulate a PR workout
      engine.updateFromWorkout('Deadlift', [
        { weight: 160, reps: 3, rpe: 9, completed: true },
      ]);

      const result = engine.getWorkingWeight('Deadlift', { min: 5, max: 8 }, 2);

      // Should have updated based on the new data
      expect(result.confidence).toBe('high');
    });

    it('ignores incomplete sets', () => {
      const profile = createTestProfile();
      const engine = new WeightEstimationEngine(profile);

      engine.updateFromWorkout('Squat', [
        { weight: 200, reps: 1, rpe: 10, completed: false }, // Failed rep
        { weight: 180, reps: 3, rpe: 9, completed: true },
      ]);

      // Should use the completed set, not the failed one
      const result = engine.getWorkingWeight('Squat', { min: 5, max: 8 }, 2);
      expect(result).toBeDefined();
    });
  });

  describe('getAsymmetryAdjustment', () => {
    it('returns no adjustment when no regional data', () => {
      const profile = createTestProfile();
      const engine = new WeightEstimationEngine(profile);

      const result = engine.getAsymmetryAdjustment('Dumbbell Curl', 'left');

      expect(result.adjustment).toBe(0);
      expect(result.note).toBe('');
    });

    it('adjusts for arm asymmetry on arm exercises', () => {
      const profile = createTestProfile({
        regionalAnalysis: makeRegionalAnalysis({
          parts: [
            makeBodyPartAnalysis({ name: 'Arms', leanMassKg: 8, percentOfTotal: 12 }),
            makeBodyPartAnalysis({ name: 'Legs', leanMassKg: 25, percentOfTotal: 37 }),
            makeBodyPartAnalysis({ name: 'Trunk', leanMassKg: 35, percentOfTotal: 51 }),
          ],
          asymmetries: {
            arms: 8, // Right arm is 8% stronger
            legs: 2,
          },
        }),
      });

      const engine = new WeightEstimationEngine(profile);
      const leftResult = engine.getAsymmetryAdjustment('Dumbbell Curl', 'left');

      // Should recommend lower weight for weaker left side
      expect(leftResult.adjustment).toBeLessThan(0);
      expect(leftResult.note).toContain('weaker');
    });

    it('adjusts for leg asymmetry on leg exercises', () => {
      const profile = createTestProfile({
        regionalAnalysis: makeRegionalAnalysis({
          parts: [
            makeBodyPartAnalysis({ name: 'Arms', leanMassKg: 8, percentOfTotal: 12 }),
            makeBodyPartAnalysis({ name: 'Legs', leanMassKg: 25, percentOfTotal: 37 }),
            makeBodyPartAnalysis({ name: 'Trunk', leanMassKg: 35, percentOfTotal: 51 }),
          ],
          asymmetries: {
            arms: 2,
            legs: -6, // Left leg is 6% stronger
          },
        }),
      });

      const engine = new WeightEstimationEngine(profile);
      const rightResult = engine.getAsymmetryAdjustment('Bulgarian Split Squat', 'right');

      // Right is weaker, should see adjustment
      expect(rightResult.adjustment).toBeLessThan(0);
    });

    it('returns no adjustment for non-unilateral exercises', () => {
      const profile = createTestProfile({
        regionalAnalysis: makeRegionalAnalysis({
          parts: [],
          asymmetries: { arms: 10, legs: 10 },
        }),
      });

      const engine = new WeightEstimationEngine(profile);
      const result = engine.getAsymmetryAdjustment('Barbell Row', 'left');

      expect(result.adjustment).toBe(0);
    });
  });

  describe('warmup protocol generation', () => {
    it('generates simple warmup for light weights', () => {
      const profile = createTestProfile({
        knownMaxes: [
          {
            exercise: 'Lateral Raise',
            estimated1RM: 15,
            confidence: 'high',
            source: 'direct_history',
            lastUpdated: new Date(),
          },
        ],
      });

      const engine = new WeightEstimationEngine(profile);
      const result = engine.getWorkingWeight('Lateral Raise', { min: 12, max: 15 }, 2);

      // Light weights should have minimal warmup
      expect(result.warmupProtocol?.length).toBeLessThanOrEqual(2);
    });

    it('generates extended warmup for heavy compounds', () => {
      const profile = createTestProfile({
        knownMaxes: [
          {
            exercise: 'Barbell Back Squat',
            estimated1RM: 180,
            confidence: 'high',
            source: 'direct_history',
            lastUpdated: new Date(),
          },
        ],
      });

      const engine = new WeightEstimationEngine(profile);
      const result = engine.getWorkingWeight('Barbell Back Squat', { min: 3, max: 5 }, 2);

      // Heavy squats should have more warmup sets
      expect(result.warmupProtocol?.length).toBeGreaterThanOrEqual(3);
    });
  });
});

// ============================================
// CREATE STRENGTH PROFILE TESTS
// ============================================

describe('createStrengthProfile', () => {
  it('creates profile with body composition', () => {
    const profile = createStrengthProfile(180, 80, 15, 'intermediate', 3);

    expect(profile.bodyComposition.totalWeightKg).toBe(80);
    expect(profile.bodyComposition.leanMassKg).toBe(68);
    expect(profile.experience).toBe('intermediate');
    expect(profile.trainingAge).toBe(3);
  });

  it('extracts known maxes from exercise history', () => {
    const history: ExerciseHistoryEntry[] = [
      createHistoryEntry('Bench Press', 100, 5, 5),
      createHistoryEntry('Bench Press', 102.5, 5, 3),
      createHistoryEntry('Squat', 140, 5, 4),
    ];

    const profile = createStrengthProfile(180, 80, 15, 'intermediate', 3, history);

    expect(profile.knownMaxes.length).toBe(2); // Bench and Squat
    expect(profile.knownMaxes.find(m => m.exercise === 'Bench Press')).toBeDefined();
    expect(profile.knownMaxes.find(m => m.exercise === 'Squat')).toBeDefined();
  });

  it('uses high confidence for exercises with 3+ sessions', () => {
    const history: ExerciseHistoryEntry[] = [
      createHistoryEntry('Bench Press', 100, 5, 20),
      createHistoryEntry('Bench Press', 102.5, 5, 15),
      createHistoryEntry('Bench Press', 105, 5, 10),
      createHistoryEntry('Bench Press', 107.5, 5, 5),
    ];

    const profile = createStrengthProfile(180, 80, 15, 'intermediate', 3, history);

    const benchMax = profile.knownMaxes.find(m => m.exercise === 'Bench Press');
    expect(benchMax?.confidence).toBe('high');
  });

  it('uses medium confidence for exercises with fewer sessions', () => {
    const history: ExerciseHistoryEntry[] = [
      createHistoryEntry('Deadlift', 160, 5, 5),
      createHistoryEntry('Deadlift', 165, 5, 2),
    ];

    const profile = createStrengthProfile(180, 80, 15, 'intermediate', 3, history);

    const deadliftMax = profile.knownMaxes.find(m => m.exercise === 'Deadlift');
    expect(deadliftMax?.confidence).toBe('medium');
  });
});

// ============================================
// QUICK ESTIMATE TESTS
// ============================================

describe('quickWeightEstimate', () => {
  it('provides estimate for novice', () => {
    const result = quickWeightEstimate(
      'Barbell Bench Press',
      { min: 8, max: 12 },
      2,
      70, // 70kg user
      175,
      20,
      'novice'
    );

    expect(result.recommendedWeight).toBeGreaterThan(0);
    expect(result.confidence).toBe('low'); // No history
  });

  it('provides estimate for intermediate', () => {
    const result = quickWeightEstimate(
      'Barbell Bench Press',
      { min: 5, max: 8 },
      2,
      80,
      180,
      15,
      'intermediate'
    );

    expect(result.recommendedWeight).toBeGreaterThan(0);
    // Should be higher than novice
  });

  it('provides estimate for advanced', () => {
    const result = quickWeightEstimate(
      'Barbell Bench Press',
      { min: 3, max: 5 },
      1,
      85,
      178,
      12,
      'advanced'
    );

    expect(result.recommendedWeight).toBeGreaterThan(0);
  });

  it('scales estimates with bodyweight', () => {
    const lightUser = quickWeightEstimate(
      'Barbell Back Squat',
      { min: 5, max: 8 },
      2,
      60,
      170,
      15,
      'intermediate'
    );

    const heavyUser = quickWeightEstimate(
      'Barbell Back Squat',
      { min: 5, max: 8 },
      2,
      100,
      185,
      15,
      'intermediate'
    );

    expect(heavyUser.recommendedWeight).toBeGreaterThan(lightUser.recommendedWeight);
  });

  it('works with different units', () => {
    const kgResult = quickWeightEstimate(
      'Bench Press',
      { min: 8, max: 12 },
      2,
      80,
      180,
      15,
      'intermediate',
      undefined,
      'kg'
    );

    const lbResult = quickWeightEstimate(
      'Bench Press',
      { min: 8, max: 12 },
      2,
      80,
      180,
      15,
      'intermediate',
      undefined,
      'lb'
    );

    // Both should give valid results
    expect(kgResult.recommendedWeight).toBeGreaterThan(0);
    expect(lbResult.recommendedWeight).toBeGreaterThan(0);
  });
});

// ============================================
// CALIBRATION INTEGRATION TESTS
// ============================================

describe('createEstimatedMaxesFromCalibration', () => {
  it('creates estimated maxes from calibrated lifts', () => {
    const calibratedLifts = [
      { lift_name: 'Bench Press', estimated_1rm: 100, tested_at: '2024-01-15T10:00:00Z' },
      { lift_name: 'Squat', estimated_1rm: 140, tested_at: '2024-01-15T10:30:00Z' },
    ];

    const maxes = createEstimatedMaxesFromCalibration(calibratedLifts);

    expect(maxes.length).toBe(2);
    expect(maxes[0].exercise).toBe('Bench Press');
    expect(maxes[0].estimated1RM).toBe(100);
    expect(maxes[0].confidence).toBe('high');
    expect(maxes[0].source).toBe('calibration');
    expect(maxes[0].lastUpdated).toBeInstanceOf(Date);
  });

  it('handles empty calibration data', () => {
    const maxes = createEstimatedMaxesFromCalibration([]);
    expect(maxes).toEqual([]);
  });
});

describe('quickWeightEstimateWithCalibration', () => {
  it('uses calibrated lifts for estimation', () => {
    const calibratedLifts = [
      { lift_name: 'Barbell Bench Press', estimated_1rm: 100, tested_at: new Date().toISOString() },
    ];

    const result = quickWeightEstimateWithCalibration(
      'Barbell Bench Press',
      { min: 8, max: 12 },
      2,
      80,
      180,
      15,
      'intermediate',
      calibratedLifts
    );

    // Should have a recommendation based on calibration
    expect(result.recommendedWeight).toBeGreaterThan(0);
    expect(['high', 'medium']).toContain(result.confidence);
  });

  it('derives related exercises from calibrated lifts', () => {
    const calibratedLifts = [
      { lift_name: 'Barbell Bench Press', estimated_1rm: 100, tested_at: '2024-01-15T10:00:00Z' },
    ];

    // Incline press is related to bench press
    const result = quickWeightEstimateWithCalibration(
      'Incline Barbell Press',
      { min: 8, max: 12 },
      2,
      80,
      180,
      15,
      'intermediate',
      calibratedLifts
    );

    // Should derive from bench press (~80% ratio)
    expect(result.recommendedWeight).toBeGreaterThan(0);
  });

  it('falls back to standards for unrelated exercises', () => {
    const calibratedLifts = [
      { lift_name: 'Bench Press', estimated_1rm: 100, tested_at: '2024-01-15T10:00:00Z' },
    ];

    const result = quickWeightEstimateWithCalibration(
      'Leg Extension', // Not directly related to bench
      { min: 10, max: 15 },
      2,
      80,
      180,
      15,
      'intermediate',
      calibratedLifts
    );

    expect(result.recommendedWeight).toBeGreaterThan(0);
  });
});

// ============================================
// EXERCISE MATCHING TESTS
// ============================================

describe('exercise matching', () => {
  it('matches variations to base exercises', () => {
    const profile = createTestProfile({
      exerciseHistory: [
        createHistoryEntry('Barbell Bench Press', 100, 5, 5),
        createHistoryEntry('Barbell Bench Press', 102.5, 5, 3),
        createHistoryEntry('Barbell Bench Press', 105, 5, 1),
      ],
    });

    const engine = new WeightEstimationEngine(profile);

    // These variations should find the parent exercise
    const inclineResult = engine.getWorkingWeight('Incline Barbell Press', { min: 8, max: 12 }, 2);
    const dbResult = engine.getWorkingWeight('Dumbbell Bench Press', { min: 8, max: 12 }, 2);

    expect(inclineResult.recommendedWeight).toBeGreaterThan(0);
    expect(dbResult.recommendedWeight).toBeGreaterThan(0);
    // Incline and DB should be less than flat barbell
    expect(inclineResult.recommendedWeight).toBeLessThan(100);
    expect(dbResult.recommendedWeight).toBeLessThan(100);
  });

  it('matches fuzzy exercise names', () => {
    const profile = createTestProfile();
    const engine = new WeightEstimationEngine(profile);

    // These should all get some form of estimate (may be find_working_weight)
    const pulldownResult = engine.getWorkingWeight('Wide Grip Lat Pulldown', { min: 8, max: 12 }, 2);
    const ohpResult = engine.getWorkingWeight('Seated Shoulder Press', { min: 8, max: 12 }, 2);
    const rowResult = engine.getWorkingWeight('Bent Over Barbell Row', { min: 8, max: 12 }, 2);

    // All should return valid recommendations
    expect(pulldownResult).toBeDefined();
    expect(ohpResult).toBeDefined();
    expect(rowResult).toBeDefined();

    // Should have some form of estimation or finding protocol
    expect(pulldownResult.findingWeightProtocol || pulldownResult.recommendedWeight >= 0).toBeTruthy();
    expect(ohpResult.findingWeightProtocol || ohpResult.recommendedWeight >= 0).toBeTruthy();
    expect(rowResult.findingWeightProtocol || rowResult.recommendedWeight >= 0).toBeTruthy();
  });
});

// ============================================
// APPROPRIATE INCREMENT TESTS
// ============================================

describe('appropriate increments', () => {
  it('uses smaller increments for isolation exercises', () => {
    const profile = createTestProfile();
    const engine = new WeightEstimationEngine(profile);

    const lateralResult = engine.getWorkingWeight('Lateral Raise', { min: 12, max: 15 }, 2);
    const curlResult = engine.getWorkingWeight('Barbell Curl', { min: 8, max: 12 }, 2);

    // Small muscle group exercises should have small increments in finding protocol
    if (lateralResult.findingWeightProtocol) {
      expect(lateralResult.findingWeightProtocol.incrementKg).toBeLessThanOrEqual(2);
    }
    if (curlResult.findingWeightProtocol) {
      expect(curlResult.findingWeightProtocol.incrementKg).toBeLessThanOrEqual(2);
    }
  });
});

// ============================================
// HISTORY RECENCY TESTS
// ============================================

describe('history recency', () => {
  it('prefers recent history over old history', () => {
    const profile = createTestProfile({
      exerciseHistory: [
        createHistoryEntry('Bench Press', 80, 5, 60), // Old (60 days)
        createHistoryEntry('Bench Press', 100, 5, 5), // Recent
      ],
    });

    const engine = new WeightEstimationEngine(profile);
    const result = engine.getWorkingWeight('Bench Press', { min: 5, max: 8 }, 2);

    // Should use the more recent 100kg data, not the old 80kg
    // Working weight for 100kg 1RM at 5-8 reps should be around 70-80kg
    expect(result.recommendedWeight).toBeGreaterThan(60);
  });

  it('marks old history as low confidence', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60); // 60 days ago

    const profile = createTestProfile({
      exerciseHistory: [
        {
          exerciseName: 'Deadlift',
          date: oldDate,
          sets: [{ weight: 150, reps: 5, completed: true }],
        },
      ],
    });

    const engine = new WeightEstimationEngine(profile);
    const result = engine.getWorkingWeight('Deadlift', { min: 5, max: 8 }, 2);

    // Old data should result in low confidence
    expect(result.confidence).toBe('low');
  });
});

// ============================================
// COLD-START ESTIMATION LADDER (transfer rungs)
// ============================================

const lyingLegCurlCandidate = (bestE1RMKg: number, over: Partial<TransferCandidate> = {}): TransferCandidate => ({
  exerciseName: 'Lying Leg Curl',
  primaryMuscle: 'hamstrings',
  movementPattern: 'knee_flexion',
  equipmentRequired: ['leg curl machine'],
  bestE1RMKg,
  ...over,
});

const seatedLegCurlMeta = {
  primaryMuscle: 'hamstrings',
  movementPattern: 'knee_flexion',
  equipmentRequired: ['seated leg curl machine'],
};

describe('estimateFromTransferCandidates (ladder rungs 1–2)', () => {
  it('rung 1: transfers from a known variant pair (seated ↔ lying leg curl @ 0.9)', () => {
    const result = estimateFromTransferCandidates('Seated Leg Curl', seatedLegCurlMeta, [
      lyingLegCurlCandidate(90),
    ]);

    expect(result).not.toBeNull();
    expect(result!.rung).toBe('same_pattern');
    expect(result!.fromExercise).toBe('Lying Leg Curl');
    expect(result!.factor).toBe(0.9);
  });

  it('rung 1: same muscle + pattern + equipment class without a pair entry uses the default factor', () => {
    const result = estimateFromTransferCandidates('Seated Leg Curl', seatedLegCurlMeta, [
      {
        // Canonicalizes to nothing paired with Seated Leg Curl, but matches on
        // muscle + pattern + (machine) equipment class.
        exerciseName: 'Nordic Ham Machine',
        primaryMuscle: 'hamstrings',
        movementPattern: 'knee_flexion',
        equipmentRequired: ['leg curl machine'],
        bestE1RMKg: 80,
      },
    ]);

    expect(result).not.toBeNull();
    expect(result!.rung).toBe('same_pattern');
    expect(result!.factor).toBe(DEFAULT_SAME_PATTERN_TRANSFER_FACTOR);
  });

  it('rung 1 picks the STRONGEST matching e1RM', () => {
    const result = estimateFromTransferCandidates('Seated Leg Curl', seatedLegCurlMeta, [
      lyingLegCurlCandidate(70),
      lyingLegCurlCandidate(95),
    ]);

    expect(result!.sourceE1RMKg).toBe(95);
  });

  it('rung 2: same muscle but different pattern transfers at the lower factor', () => {
    const result = estimateFromTransferCandidates('Seated Leg Curl', seatedLegCurlMeta, [
      {
        exerciseName: 'Romanian Deadlift',
        primaryMuscle: 'hamstrings',
        movementPattern: 'hip_hinge',
        equipmentRequired: ['barbell'],
        bestE1RMKg: 180,
      },
    ]);

    expect(result).not.toBeNull();
    expect(result!.rung).toBe('same_muscle');
    expect(result!.fromExercise).toBe('Romanian Deadlift');
    expect(result!.factor).toBe(SAME_MUSCLE_TRANSFER_FACTOR);
  });

  it('prefers rung 1 over a stronger rung-2 candidate', () => {
    const result = estimateFromTransferCandidates('Seated Leg Curl', seatedLegCurlMeta, [
      lyingLegCurlCandidate(90),
      {
        exerciseName: 'Romanian Deadlift',
        primaryMuscle: 'hamstrings',
        movementPattern: 'hip_hinge',
        equipmentRequired: ['barbell'],
        bestE1RMKg: 200,
      },
    ]);

    expect(result!.rung).toBe('same_pattern');
    expect(result!.fromExercise).toBe('Lying Leg Curl');
  });

  it('never transfers from deload-flagged or soft-deleted candidates', () => {
    const flagged = [
      lyingLegCurlCandidate(90, { fromDeload: true }),
      lyingLegCurlCandidate(95, { softDeleted: true }),
    ];

    expect(estimateFromTransferCandidates('Seated Leg Curl', seatedLegCurlMeta, flagged)).toBeNull();
  });

  it('never transfers from the target exercise itself or unrelated muscles', () => {
    const result = estimateFromTransferCandidates('Seated Leg Curl', seatedLegCurlMeta, [
      { exerciseName: 'Seated Leg Curl', primaryMuscle: 'hamstrings', movementPattern: 'knee_flexion', bestE1RMKg: 90 },
      { exerciseName: 'Barbell Bench Press', primaryMuscle: 'chest', movementPattern: 'horizontal_press', bestE1RMKg: 140 },
    ]);

    expect(result).toBeNull();
  });
});

describe('buildTransferCandidatesFromRows', () => {
  const row = (over: Partial<TransferSourceRow> = {}): TransferSourceRow => ({
    weightKg: 60,
    reps: 10,
    rpe: 8,
    exercise: {
      id: 'ex-1',
      name: 'Lying Leg Curl',
      primaryMuscle: 'hamstrings',
      movementPattern: 'knee_flexion',
      equipmentRequired: ['leg curl machine'],
    },
    ...over,
  });

  it('reduces rows to one best-e1RM candidate per exercise', () => {
    const candidates = buildTransferCandidatesFromRows([
      row({ weightKg: 50 }),
      row({ weightKg: 70 }),
      row({ weightKg: 60 }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].exerciseName).toBe('Lying Leg Curl');
    expect(candidates[0].bestE1RMKg).toBe(estimate1RM(70, 10, 8));
  });

  it('drops warmup, deload-session, and soft-deleted-exercise rows', () => {
    const candidates = buildTransferCandidatesFromRows([
      row({ isWarmup: true }),
      row({ isDeload: true }),
      row({ exercise: { ...row().exercise, deletedAt: '2026-07-01T00:00:00Z' } }),
    ]);

    expect(candidates).toHaveLength(0);
  });
});

describe('cold-start ladder end-to-end (quickWeightEstimate)', () => {
  // The reported bug: 100+ logged sets of Lying Leg Curl (~200 lb e1RM),
  // Seated Leg Curl cold start suggested 25 lb × 10-15.
  const legCurlOpts = {
    transferCandidates: [lyingLegCurlCandidate(90)], // 90 kg ≈ 198 lb e1RM
    targetMeta: seatedLegCurlMeta,
  };

  it('seats leg curl cold start ≈ a 12-15 rep load off ~180 lb e1RM, NOT 25 lb', () => {
    const result = quickWeightEstimate(
      'Seated Leg Curl',
      { min: 10, max: 15 },
      2,
      90, // 90 kg user
      178,
      20,
      'intermediate',
      undefined,
      'lb',
      undefined,
      legCurlOpts
    );

    // 90 kg × 0.9 = 81 kg (~178 lb) discounted e1RM → ~13 reps @ 3 RIR ≈ 105 lb
    expect(result.recommendedWeight).toBeGreaterThanOrEqual(90);
    expect(result.recommendedWeight).toBeLessThanOrEqual(120);
    expect(result.estimateSource).toBe('exercise_transfer');
    expect(result.transferFrom).toBe('Lying Leg Curl');
  });

  it('names the transfer source in the rationale (rung 1)', () => {
    const result = quickWeightEstimate(
      'Seated Leg Curl', { min: 10, max: 15 }, 2, 90, 178, 20, 'intermediate',
      undefined, 'lb', undefined, legCurlOpts
    );

    expect(result.rationale).toContain('Lying Leg Curl');
    expect(result.rationale).not.toContain('bodyweight');
  });

  it('prescribes the first session at 3 RIR (calibration headroom) on every cold-start rung', () => {
    const transferResult = quickWeightEstimate(
      'Seated Leg Curl', { min: 10, max: 15 }, 2, 90, 178, 20, 'intermediate',
      undefined, 'lb', undefined, legCurlOpts
    );
    const profileResult = quickWeightEstimate(
      'Seated Leg Curl', { min: 10, max: 15 }, 2, 90, 178, 20, 'intermediate',
      undefined, 'lb'
    );

    expect(transferResult.targetRIR).toBe(3);
    expect(profileResult.targetRIR).toBe(3);
  });

  it('keeps the requested RIR when direct history exists (not a cold start)', () => {
    const result = quickWeightEstimate(
      'Seated Leg Curl', { min: 10, max: 15 }, 2, 90, 178, 20, 'intermediate',
      undefined, 'lb', 80 /* knownE1RM from direct history */, legCurlOpts
    );

    expect(result.targetRIR).toBe(2);
    expect(result.estimateSource).toBe('direct_history');
  });

  it('flags lower confidence + names the source on a same-muscle (rung 2) transfer', () => {
    const result = quickWeightEstimate(
      'Seated Leg Curl', { min: 10, max: 15 }, 2, 90, 178, 20, 'intermediate',
      undefined, 'lb', undefined,
      {
        transferCandidates: [{
          exerciseName: 'Romanian Deadlift',
          primaryMuscle: 'hamstrings',
          movementPattern: 'hip_hinge',
          equipmentRequired: ['barbell'],
          bestE1RMKg: 180,
        }],
        targetMeta: seatedLegCurlMeta,
      }
    );

    expect(result.confidence).toBe('low');
    expect(result.transferFrom).toBe('Romanian Deadlift');
    expect(result.rationale).toContain('Romanian Deadlift');
  });

  it('falls to the profile rung when the only candidates are deload/soft-deleted', () => {
    const result = quickWeightEstimate(
      'Seated Leg Curl', { min: 10, max: 15 }, 2, 90, 178, 20, 'intermediate',
      undefined, 'lb', undefined,
      {
        transferCandidates: [
          lyingLegCurlCandidate(90, { fromDeload: true }),
          lyingLegCurlCandidate(95, { softDeleted: true }),
        ],
        targetMeta: seatedLegCurlMeta,
      }
    );

    expect(result.estimateSource).not.toBe('exercise_transfer');
    expect(result.transferFrom).toBeUndefined();
    expect(result.rationale).not.toContain('Lying Leg Curl');
  });
});

// ============================================
// PROFILE RUNG COEFFICIENT SANITY (rung 3)
// ============================================

describe('profile-heuristic coefficient sanity', () => {
  it('machine-isolation lower-body ratios clear the equipment-class floor', () => {
    const machineIsolationLifts = [
      'Seated Leg Curl',
      'Lying Leg Curl',
      'Leg Extension',
      'Calf Machine',
      'Hip Abduction Machine',
    ];

    for (const name of machineIsolationLifts) {
      expect(isLowerBodyMachineIsolation(name)).toBe(true);
      expect(resolveBodyweightRatio(name)).toBeGreaterThanOrEqual(
        LOWER_BODY_MACHINE_ISOLATION_RATIO_FLOOR
      );
    }
  });

  it('leg curl coefficient is no longer below the generic hamstrings fallback', () => {
    // The 25-lb bug: leg curls were 0.30×BW while the muscle-group fallback
    // for hamstrings was 0.50 — the specific coefficient undercut the generic one.
    expect(resolveBodyweightRatio('Seated Leg Curl')).toBeGreaterThanOrEqual(0.5);
    expect(resolveBodyweightRatio('Lying Leg Curl')).toBeGreaterThanOrEqual(0.5);
  });

  it('profile-rung seated leg curl for a 90 kg lifter is a plausible machine load (≥ 40 lb)', () => {
    const result = quickWeightEstimate(
      'Seated Leg Curl',
      { min: 10, max: 15 },
      2,
      90,
      178,
      20,
      'intermediate',
      undefined,
      'lb'
    );

    expect(result.recommendedWeight).toBeGreaterThanOrEqual(40);
  });
});

// ============================================
// EDGE CASES
// ============================================

describe('edge cases', () => {
  it('handles very high body fat percentage', () => {
    const result = quickWeightEstimate(
      'Bench Press',
      { min: 8, max: 12 },
      2,
      100,
      175,
      40, // 40% body fat
      'novice'
    );

    expect(result.recommendedWeight).toBeGreaterThan(0);
  });

  it('handles very low body fat percentage', () => {
    const result = quickWeightEstimate(
      'Bench Press',
      { min: 8, max: 12 },
      2,
      70,
      175,
      5, // 5% body fat
      'advanced'
    );

    expect(result.recommendedWeight).toBeGreaterThan(0);
  });

  it('handles unknown exercise gracefully', () => {
    const profile = createTestProfile();
    const engine = new WeightEstimationEngine(profile);

    const result = engine.getWorkingWeight('Completely Unknown Exercise XYZ', { min: 8, max: 12 }, 2);

    expect(result).toBeDefined();
    // Unknown exercises now fall back to bodyweight-based estimation with 'low' confidence
    expect(result.confidence).toBe('low');
    expect(result.findingWeightProtocol).toBeDefined();
  });

  it('handles empty exercise history', () => {
    const profile = createTestProfile({ exerciseHistory: [] });
    const engine = new WeightEstimationEngine(profile);

    const result = engine.getWorkingWeight('Squat', { min: 5, max: 8 }, 2);

    expect(result).toBeDefined();
    expect(result.recommendedWeight).toBeGreaterThanOrEqual(0);
  });

  it('handles sets with no completed reps', () => {
    const profile = createTestProfile({
      exerciseHistory: [
        {
          exerciseName: 'Bench Press',
          date: new Date(),
          sets: [
            { weight: 100, reps: 0, completed: false },
            { weight: 90, reps: 5, completed: true },
          ],
        },
      ],
    });

    const engine = new WeightEstimationEngine(profile);
    const result = engine.getWorkingWeight('Bench Press', { min: 8, max: 12 }, 2);

    // Should still work using the completed set
    expect(result).toBeDefined();
  });
});
