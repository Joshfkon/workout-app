/**
 * Tests for services/volumeTracker.ts
 * Volume calculation, status assessment, recommendations
 */

import {
  calculateWeeklyVolume,
  assessVolumeStatus,
  getVolumeStatusDescription,
  generateVolumeRecommendations,
  calculateVolumeProgression,
  getVolumeSummary,
  toWeeklyMuscleVolume,
  resolvePrimaryMuscleCredits,
  type CalculateVolumeInput,
  type MuscleVolumeData,
} from '../volumeTracker';

import type { Exercise, ExerciseBlock, SetLog, VolumeLandmarks, StandardMuscleGroup } from '@/types/schema';
import { DEFAULT_VOLUME_LANDMARKS, STANDARD_MUSCLE_GROUPS } from '@/types/schema';

// ============================================
// TEST FIXTURES
// ============================================

const createMockExercise = (
  primaryMuscle: string,
  secondaryMuscles: string[] = []
): Exercise => ({
  id: `${primaryMuscle}-exercise`,
  name: `${primaryMuscle} Exercise`,
  primaryMuscle,
  secondaryMuscles,
  mechanic: 'compound',
  defaultRepRange: [8, 12],
  defaultRir: 2,
  minWeightIncrementKg: 2.5,
  formCues: [],
  commonMistakes: [],
  setupNote: '',
  movementPattern: 'horizontal_push',
  equipmentRequired: ['barbell'],
});

const createMockBlock = (exerciseId: string): ExerciseBlock => ({
  id: `block-${exerciseId}`,
  workoutSessionId: 'session-1',
  exerciseId,
  order: 1,
  supersetGroupId: null,
  supersetOrder: null,
  targetSets: 3,
  targetRepRange: [8, 12],
  targetRir: 2,
  targetWeightKg: 100,
  targetRestSeconds: 120,
  progressionType: null,
  suggestionReason: '',
  warmupProtocol: [],
  note: null,
  dropsetsPerSet: 0,
  dropPercentage: 0,
});

const createMockSetLog = (
  blockId: string,
  isWarmup: boolean = false
): SetLog => ({
  id: `set-${blockId}-${Math.random()}`,
  exerciseBlockId: blockId,
  setNumber: 1,
  reps: 10,
  weightKg: 100,
  rpe: 8,
  restSeconds: null,
  isWarmup,
  setType: isWarmup ? 'warmup' : 'normal',
  parentSetId: null,
  quality: 'stimulative',
  qualityReason: 'Good effort',
  note: null,
  loggedAt: new Date().toISOString(),
});

const createLandmarks = (mev: number, mav: number, mrv: number): VolumeLandmarks => ({
  mev,
  mav,
  mrv,
});

// Use the actual DEFAULT_VOLUME_LANDMARKS from schema for tests
const defaultLandmarks = DEFAULT_VOLUME_LANDMARKS.intermediate;

// ============================================
// DEFAULT LANDMARK COMPLETENESS
// ============================================

describe('DEFAULT_VOLUME_LANDMARKS', () => {
  const tiers = ['novice', 'intermediate', 'advanced'] as const;

  it('defines landmarks for every canonical muscle group in every tier', () => {
    for (const tier of tiers) {
      for (const muscle of STANDARD_MUSCLE_GROUPS) {
        const lm = DEFAULT_VOLUME_LANDMARKS[tier][muscle as StandardMuscleGroup];
        expect(lm).toBeDefined();
        // mev < mav < mrv ordering must hold.
        expect(lm.mev).toBeLessThan(lm.mav);
        expect(lm.mav).toBeLessThan(lm.mrv);
      }
    }
  });

  it('includes the previously-missing adductors/forearms/traps', () => {
    for (const tier of tiers) {
      expect(DEFAULT_VOLUME_LANDMARKS[tier].adductors).toBeDefined();
      expect(DEFAULT_VOLUME_LANDMARKS[tier].forearms).toBeDefined();
      expect(DEFAULT_VOLUME_LANDMARKS[tier].traps).toBeDefined();
    }
  });
});

// ============================================
// VOLUME CALCULATION TESTS
// ============================================

describe('calculateWeeklyVolume', () => {
  it('counts direct sets for primary muscle', () => {
    // Use standard muscle groups (chest_upper instead of legacy 'chest')
    const chestExercise = createMockExercise('chest_upper', ['triceps', 'front_delts']);
    const block = createMockBlock(chestExercise.id);

    const input: CalculateVolumeInput = {
      exerciseBlocks: [
        {
          block,
          exercise: chestExercise,
          completedSets: [
            createMockSetLog(block.id),
            createMockSetLog(block.id),
            createMockSetLog(block.id),
          ],
        },
      ],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);
    const chestData = result.get('chest_upper');

    expect(chestData).toBeDefined();
    expect(chestData!.directSets).toBe(3);
    expect(chestData!.totalSets).toBe(3);
  });

  it('counts indirect sets for secondary muscles at 50%', () => {
    // Use standard muscle groups
    const benchPress = createMockExercise('chest_upper', ['triceps', 'front_delts']);
    const block = createMockBlock(benchPress.id);

    const input: CalculateVolumeInput = {
      exerciseBlocks: [
        {
          block,
          exercise: benchPress,
          completedSets: [
            createMockSetLog(block.id),
            createMockSetLog(block.id),
            createMockSetLog(block.id),
            createMockSetLog(block.id),
          ],
        },
      ],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);

    expect(result.get('chest_upper')!.directSets).toBe(4);
    expect(result.get('triceps')!.indirectSets).toBe(2); // 4 * 0.5 = 2
    expect(result.get('front_delts')!.indirectSets).toBe(2);
  });

  it('excludes warmup sets from count', () => {
    const exercise = createMockExercise('chest_upper');
    const block = createMockBlock(exercise.id);

    const input: CalculateVolumeInput = {
      exerciseBlocks: [
        {
          block,
          exercise,
          completedSets: [
            createMockSetLog(block.id, true), // warmup
            createMockSetLog(block.id, true), // warmup
            createMockSetLog(block.id, false),
            createMockSetLog(block.id, false),
            createMockSetLog(block.id, false),
          ],
        },
      ],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);
    expect(result.get('chest_upper')!.totalSets).toBe(3);
  });

  it('aggregates volume from multiple exercises', () => {
    // Both exercises target chest_upper
    const benchPress = createMockExercise('chest_upper', ['triceps']);
    const inclinePress = createMockExercise('chest_upper', ['front_delts']);

    const block1 = createMockBlock(benchPress.id);
    const block2 = createMockBlock(inclinePress.id);

    const input: CalculateVolumeInput = {
      exerciseBlocks: [
        {
          block: block1,
          exercise: benchPress,
          completedSets: [
            createMockSetLog(block1.id),
            createMockSetLog(block1.id),
            createMockSetLog(block1.id),
          ],
        },
        {
          block: block2,
          exercise: inclinePress,
          completedSets: [
            createMockSetLog(block2.id),
            createMockSetLog(block2.id),
            createMockSetLog(block2.id),
          ],
        },
      ],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);
    expect(result.get('chest_upper')!.directSets).toBe(6);
  });

  it('initializes all muscle groups with zero sets', () => {
    const input: CalculateVolumeInput = {
      exerciseBlocks: [],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);

    // Should have entries for all 24 standard muscle groups with 0 sets
    expect(result.size).toBe(24);
    result.forEach((data) => {
      expect(data.totalSets).toBe(0);
      // Muscles with MEV=0 (glute_med, obliques) will have status 'effective' not 'below_mev'
      if (data.landmarks.mev === 0) {
        expect(data.status).toBe('effective');
      } else {
        expect(data.status).toBe('below_mev');
      }
    });
  });

  it('calculates correct percent of MRV', () => {
    // chest_upper has MRV=16 for intermediate
    const exercise = createMockExercise('chest_upper');
    const block = createMockBlock(exercise.id);

    // Create 8 sets (50% of MRV=16 for intermediate chest_upper)
    const sets = Array.from({ length: 8 }, () => createMockSetLog(block.id));

    const input: CalculateVolumeInput = {
      exerciseBlocks: [{ block, exercise, completedSets: sets }],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);
    expect(result.get('chest_upper')!.percentOfMrv).toBe(50);
  });

  it('accumulates fractional secondary credit across exercises before rounding', () => {
    // Two exercises each contributing 1 set of triceps secondary credit.
    // Old per-exercise Math.round(1*0.5)=1 each -> 2 (over-credited).
    // Correct: accumulate 0.5 + 0.5 = 1.0, rounded once -> 1.
    const ex1 = createMockExercise('chest', ['triceps']);
    const ex2 = createMockExercise('shoulders', ['triceps']);
    const block1 = createMockBlock(ex1.id);
    const block2 = createMockBlock(ex2.id);

    const input: CalculateVolumeInput = {
      exerciseBlocks: [
        { block: block1, exercise: ex1, completedSets: [createMockSetLog(block1.id)] },
        { block: block2, exercise: ex2, completedSets: [createMockSetLog(block2.id)] },
      ],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);
    expect(result.get('triceps')!.indirectSets).toBe(1);
  });

  it('rounds leftover fractional secondary credit at the end', () => {
    // Single exercise, 1 working set -> 0.5 triceps credit accumulated.
    // Rounded once at the end: Math.round(0.5) = 1.
    const ex = createMockExercise('chest', ['triceps']);
    const block = createMockBlock(ex.id);

    const input: CalculateVolumeInput = {
      exerciseBlocks: [
        { block, exercise: ex, completedSets: [createMockSetLog(block.id)] },
      ],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);
    expect(result.get('triceps')!.indirectSets).toBe(1);
  });

  it('splits a legacy coarse primary across its standard muscles', () => {
    // Legacy 'chest' can't tell us which head, so 4 sets credit 2 upper + 2
    // lower instead of the old winner-takes-all (4 upper, 0 lower).
    const flatBench = createMockExercise('chest', ['front_delts', 'triceps']);
    const block = createMockBlock(flatBench.id);
    const sets = Array.from({ length: 4 }, () => createMockSetLog(block.id));

    const input: CalculateVolumeInput = {
      exerciseBlocks: [{ block, exercise: flatBench, completedSets: sets }],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);
    expect(result.get('chest_upper')!.directSets).toBe(2);
    expect(result.get('chest_lower')!.directSets).toBe(2);
    // Secondaries still work at 0.5
    expect(result.get('front_delts')!.indirectSets).toBe(2);
    expect(result.get('triceps')!.indirectSets).toBe(2);
  });

  it('does not split legacy glutes/abs primaries onto sibling muscles', () => {
    const hipThrust = createMockExercise('glutes', ['hamstrings']);
    const crunch = createMockExercise('abs');
    const block1 = createMockBlock(hipThrust.id);
    const block2 = createMockBlock(crunch.id);
    const sets = (b: string) => Array.from({ length: 4 }, () => createMockSetLog(b));

    const result = calculateWeeklyVolume({
      exerciseBlocks: [
        { block: block1, exercise: hipThrust, completedSets: sets(block1.id) },
        { block: block2, exercise: crunch, completedSets: sets(block2.id) },
      ],
      userLandmarks: defaultLandmarks,
    });

    expect(result.get('glutes')!.directSets).toBe(4);
    expect(result.get('glute_med')!.totalSets).toBe(0);
    expect(result.get('abs')!.directSets).toBe(4);
    expect(result.get('obliques')!.totalSets).toBe(0);
  });

  it('normalizes secondary tokens with spaces ("rear delts")', () => {
    // The seed data historically stored 'rear delts' (space); that token used
    // to resolve to nothing and silently dropped the credit.
    const row = createMockExercise('back', ['biceps', 'rear delts']);
    const block = createMockBlock(row.id);
    const sets = Array.from({ length: 4 }, () => createMockSetLog(block.id));

    const result = calculateWeeklyVolume({
      exerciseBlocks: [{ block, exercise: row, completedSets: sets }],
      userLandmarks: defaultLandmarks,
    });

    expect(result.get('rear_delts')!.indirectSets).toBe(2);
    // Legacy 'back' primary splits between lats and upper_back
    expect(result.get('lats')!.directSets).toBe(2);
    expect(result.get('upper_back')!.directSets).toBe(2);
  });

  it('skips secondary credit for muscles already covered by a split primary', () => {
    // 'chest' primary already credits chest_upper; a chest_upper secondary
    // must not double-count.
    const press = createMockExercise('chest', ['chest_upper', 'triceps']);
    const block = createMockBlock(press.id);
    const sets = Array.from({ length: 4 }, () => createMockSetLog(block.id));

    const result = calculateWeeklyVolume({
      exerciseBlocks: [{ block, exercise: press, completedSets: sets }],
      userLandmarks: defaultLandmarks,
    });

    expect(result.get('chest_upper')!.directSets).toBe(2);
    expect(result.get('chest_upper')!.indirectSets).toBe(0);
    expect(result.get('triceps')!.indirectSets).toBe(2);
  });

  it('resolves muscle names case-insensitively', () => {
    // The resolver lowercases before matching, so capitalized canonical names
    // ("Quads"/"Hamstrings") map to quads/hamstrings.
    const ex = createMockExercise('Quads', ['Hamstrings']);
    const block = createMockBlock(ex.id);
    const sets = Array.from({ length: 4 }, () => createMockSetLog(block.id));

    const input: CalculateVolumeInput = {
      exerciseBlocks: [{ block, exercise: ex, completedSets: sets }],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);
    expect(result.get('quads')!.directSets).toBe(4);
    expect(result.get('hamstrings')!.indirectSets).toBe(2); // Math.round(4 * 0.5) = 2
  });
});

// ============================================
// PRIMARY MUSCLE CREDIT RESOLUTION
// ============================================

describe('resolvePrimaryMuscleCredits', () => {
  it('splits legacy chest/back across their standard muscles', () => {
    expect(resolvePrimaryMuscleCredits('chest')).toEqual([
      { muscle: 'chest_upper', weight: 0.5 },
      { muscle: 'chest_lower', weight: 0.5 },
    ]);
    expect(resolvePrimaryMuscleCredits('back')).toEqual([
      { muscle: 'lats', weight: 0.5 },
      { muscle: 'upper_back', weight: 0.5 },
    ]);
  });

  it('splits legacy shoulders three ways', () => {
    const credits = resolvePrimaryMuscleCredits('shoulders');
    expect(credits).toHaveLength(3);
    expect(credits.map((c) => c.muscle).sort()).toEqual(['front_delts', 'lateral_delts', 'rear_delts']);
    credits.forEach((c) => expect(c.weight).toBeCloseTo(1 / 3));
  });

  it('gives full credit for precise standard/detailed tags', () => {
    expect(resolvePrimaryMuscleCredits('lateral_delts')).toEqual([{ muscle: 'lateral_delts', weight: 1 }]);
    expect(resolvePrimaryMuscleCredits('chest_upper')).toEqual([{ muscle: 'chest_upper', weight: 1 }]);
    expect(resolvePrimaryMuscleCredits('triceps_long')).toEqual([{ muscle: 'triceps', weight: 1 }]);
  });

  it('does not leak legacy glutes/abs onto glute_med/obliques', () => {
    expect(resolvePrimaryMuscleCredits('glutes')).toEqual([{ muscle: 'glutes', weight: 1 }]);
    expect(resolvePrimaryMuscleCredits('abs')).toEqual([{ muscle: 'abs', weight: 1 }]);
  });

  it('resolves 1:1 legacy tokens and rejects unknown tokens', () => {
    expect(resolvePrimaryMuscleCredits('biceps')).toEqual([{ muscle: 'biceps', weight: 1 }]);
    expect(resolvePrimaryMuscleCredits('not a muscle')).toEqual([]);
  });
});

// ============================================
// VOLUME STATUS TESTS
// ============================================

describe('assessVolumeStatus', () => {
  const landmarks = createLandmarks(10, 16, 22);

  it('returns below_mev for sets below MEV', () => {
    expect(assessVolumeStatus(5, landmarks)).toBe('below_mev');
    expect(assessVolumeStatus(9, landmarks)).toBe('below_mev');
  });

  it('returns effective for sets between MEV and 80% MAV', () => {
    expect(assessVolumeStatus(10, landmarks)).toBe('effective');
    expect(assessVolumeStatus(12, landmarks)).toBe('effective');
  });

  it('returns optimal for sets around MAV (80-110%)', () => {
    // 80% of 16 = 12.8, 110% of 16 = 17.6
    expect(assessVolumeStatus(14, landmarks)).toBe('optimal');
    expect(assessVolumeStatus(16, landmarks)).toBe('optimal');
    expect(assessVolumeStatus(17, landmarks)).toBe('optimal');
  });

  it('returns approaching_mrv for sets above 110% MAV but below MRV', () => {
    expect(assessVolumeStatus(18, landmarks)).toBe('approaching_mrv');
    expect(assessVolumeStatus(20, landmarks)).toBe('approaching_mrv');
    expect(assessVolumeStatus(22, landmarks)).toBe('approaching_mrv');
  });

  it('returns exceeding_mrv for sets above MRV', () => {
    expect(assessVolumeStatus(23, landmarks)).toBe('exceeding_mrv');
    expect(assessVolumeStatus(30, landmarks)).toBe('exceeding_mrv');
  });
});

describe('getVolumeStatusDescription', () => {
  it('returns correct description for each status', () => {
    const belowMev = getVolumeStatusDescription('below_mev');
    expect(belowMev.label).toBe('Below MEV');
    expect(belowMev.description).toContain('maintain');

    const effective = getVolumeStatusDescription('effective');
    expect(effective.label).toBe('Effective');
    expect(effective.description).toContain('sufficient');

    const optimal = getVolumeStatusDescription('optimal');
    expect(optimal.label).toBe('Optimal');
    expect(optimal.description).toContain('ideal');

    const approaching = getVolumeStatusDescription('approaching_mrv');
    expect(approaching.label).toBe('Approaching MRV');
    expect(approaching.description).toContain('recovery');

    const exceeding = getVolumeStatusDescription('exceeding_mrv');
    expect(exceeding.label).toBe('Exceeding MRV');
    expect(exceeding.description).toContain('overtraining');
  });

  it('returns appropriate colors for each status', () => {
    expect(getVolumeStatusDescription('below_mev').color).toContain('surface');
    expect(getVolumeStatusDescription('effective').color).toContain('primary');
    expect(getVolumeStatusDescription('optimal').color).toContain('success');
    expect(getVolumeStatusDescription('approaching_mrv').color).toContain('warning');
    expect(getVolumeStatusDescription('exceeding_mrv').color).toContain('danger');
  });
});

// ============================================
// VOLUME RECOMMENDATIONS TESTS
// ============================================

describe('generateVolumeRecommendations', () => {
  it('recommends increase for below_mev', () => {
    const volumeData = new Map<string, MuscleVolumeData>();
    volumeData.set('chest_upper', {
      muscleGroup: 'chest_upper',
      totalSets: 5,
      directSets: 5,
      indirectSets: 0,
      landmarks: createLandmarks(10, 16, 22),
      status: 'below_mev',
      percentOfMrv: 23,
    });

    const recommendations = generateVolumeRecommendations(volumeData as Map<never, MuscleVolumeData>, 2, false);

    expect(recommendations[0].action).toBe('increase');
    expect(recommendations[0].message).toContain('Add');
  });

  it('recommends decrease for exceeding_mrv', () => {
    const volumeData = new Map<string, MuscleVolumeData>();
    volumeData.set('chest_upper', {
      muscleGroup: 'chest_upper',
      totalSets: 25,
      directSets: 25,
      indirectSets: 0,
      landmarks: createLandmarks(10, 16, 22),
      status: 'exceeding_mrv',
      percentOfMrv: 114,
    });

    const recommendations = generateVolumeRecommendations(volumeData as Map<never, MuscleVolumeData>, 2, false);

    expect(recommendations[0].action).toBe('decrease');
    expect(recommendations[0].message).toContain('Reduce');
  });

  it('recommends maintain for optimal', () => {
    const volumeData = new Map<string, MuscleVolumeData>();
    volumeData.set('chest_upper', {
      muscleGroup: 'chest_upper',
      totalSets: 16,
      directSets: 16,
      indirectSets: 0,
      landmarks: createLandmarks(10, 16, 22),
      status: 'optimal',
      percentOfMrv: 73,
    });

    const recommendations = generateVolumeRecommendations(volumeData as Map<never, MuscleVolumeData>, 2, false);

    expect(recommendations[0].action).toBe('optimal');
    expect(recommendations[0].message).toContain('maintain');
  });

  it('recommends decrease during deload week', () => {
    const volumeData = new Map<string, MuscleVolumeData>();
    volumeData.set('chest_upper', {
      muscleGroup: 'chest_upper',
      totalSets: 16,
      directSets: 16,
      indirectSets: 0,
      landmarks: createLandmarks(10, 16, 22),
      status: 'optimal',
      percentOfMrv: 73,
    });

    const recommendations = generateVolumeRecommendations(volumeData as Map<never, MuscleVolumeData>, 6, true);

    expect(recommendations[0].action).toBe('decrease');
    expect(recommendations[0].message).toContain('Deload');
  });

  it('sorts recommendations by priority (worst status first)', () => {
    const volumeData = new Map<string, MuscleVolumeData>();

    volumeData.set('chest_upper', {
      muscleGroup: 'chest_upper',
      totalSets: 16,
      directSets: 16,
      indirectSets: 0,
      landmarks: createLandmarks(10, 16, 22),
      status: 'optimal',
      percentOfMrv: 73,
    });

    volumeData.set('lats', {
      muscleGroup: 'lats',
      totalSets: 30,
      directSets: 30,
      indirectSets: 0,
      landmarks: createLandmarks(10, 18, 25),
      status: 'exceeding_mrv',
      percentOfMrv: 120,
    });

    const recommendations = generateVolumeRecommendations(volumeData as Map<never, MuscleVolumeData>, 2, false);

    expect(recommendations[0].muscleGroup).toBe('lats'); // exceeding_mrv first
    expect(recommendations[0].status).toBe('exceeding_mrv');
  });
});

// ============================================
// VOLUME PROGRESSION TESTS
// ============================================

describe('calculateVolumeProgression', () => {
  it('calculates change from previous week', () => {
    const currentWeek = new Map<string, MuscleVolumeData>();
    currentWeek.set('chest_upper', {
      muscleGroup: 'chest_upper',
      totalSets: 15,
      directSets: 15,
      indirectSets: 0,
      landmarks: createLandmarks(10, 16, 22),
      status: 'effective',
      percentOfMrv: 68,
    });

    const previousWeek = new Map<string, MuscleVolumeData>();
    previousWeek.set('chest_upper', {
      muscleGroup: 'chest_upper',
      totalSets: 12,
      directSets: 12,
      indirectSets: 0,
      landmarks: createLandmarks(10, 16, 22),
      status: 'effective',
      percentOfMrv: 55,
    });

    const changes = calculateVolumeProgression(currentWeek as Map<never, MuscleVolumeData>, previousWeek as Map<never, MuscleVolumeData>);

    expect(changes.get('chest_upper')!.change).toBe(3);
    expect(changes.get('chest_upper')!.percentChange).toBe(25);
  });

  it('handles missing previous week data', () => {
    const currentWeek = new Map<string, MuscleVolumeData>();
    currentWeek.set('chest_upper', {
      muscleGroup: 'chest_upper',
      totalSets: 10,
      directSets: 10,
      indirectSets: 0,
      landmarks: createLandmarks(10, 16, 22),
      status: 'effective',
      percentOfMrv: 45,
    });

    const previousWeek = new Map<string, MuscleVolumeData>();

    const changes = calculateVolumeProgression(currentWeek as Map<never, MuscleVolumeData>, previousWeek as Map<never, MuscleVolumeData>);

    expect(changes.get('chest_upper')!.change).toBe(10);
    expect(changes.get('chest_upper')!.percentChange).toBe(100);
  });

  it('handles zero previous sets', () => {
    const currentWeek = new Map<string, MuscleVolumeData>();
    currentWeek.set('chest_upper', {
      muscleGroup: 'chest_upper',
      totalSets: 10,
      directSets: 10,
      indirectSets: 0,
      landmarks: createLandmarks(10, 16, 22),
      status: 'effective',
      percentOfMrv: 45,
    });

    const previousWeek = new Map<string, MuscleVolumeData>();
    previousWeek.set('chest_upper', {
      muscleGroup: 'chest_upper',
      totalSets: 0,
      directSets: 0,
      indirectSets: 0,
      landmarks: createLandmarks(10, 16, 22),
      status: 'below_mev',
      percentOfMrv: 0,
    });

    const changes = calculateVolumeProgression(currentWeek as Map<never, MuscleVolumeData>, previousWeek as Map<never, MuscleVolumeData>);

    expect(changes.get('chest_upper')!.change).toBe(10);
    expect(changes.get('chest_upper')!.percentChange).toBe(100);
  });
});

// ============================================
// VOLUME SUMMARY TESTS
// ============================================

describe('getVolumeSummary', () => {
  it('calculates total sets across all muscles', () => {
    const volumeData = new Map<string, MuscleVolumeData>();

    volumeData.set('chest_upper', createVolumeData('chest_upper', 15, 'optimal'));
    volumeData.set('lats', createVolumeData('lats', 18, 'optimal'));
    volumeData.set('front_delts', createVolumeData('front_delts', 12, 'effective'));

    const summary = getVolumeSummary(volumeData as Map<never, MuscleVolumeData>);

    expect(summary.totalSets).toBe(45);
  });

  it('returns 0 average for an empty map (no divide-by-zero)', () => {
    const summary = getVolumeSummary(new Map<string, MuscleVolumeData>() as any);
    expect(summary.totalSets).toBe(0);
    expect(summary.averagePercentMrv).toBe(0);
    expect(Number.isNaN(summary.averagePercentMrv)).toBe(false);
  });

  it('identifies muscles below MEV', () => {
    const volumeData = new Map<string, MuscleVolumeData>();

    volumeData.set('chest_upper', createVolumeData('chest_upper', 5, 'below_mev'));
    volumeData.set('lats', createVolumeData('lats', 18, 'optimal'));
    volumeData.set('calves', createVolumeData('calves', 0, 'below_mev'));

    const summary = getVolumeSummary(volumeData as Map<never, MuscleVolumeData>);

    expect(summary.musclesBelowMev).toContain('chest_upper');
    expect(summary.musclesBelowMev).toContain('calves');
    expect(summary.musclesBelowMev).not.toContain('lats');
  });

  it('identifies optimal muscles', () => {
    const volumeData = new Map<string, MuscleVolumeData>();

    volumeData.set('chest_upper', createVolumeData('chest_upper', 16, 'optimal'));
    volumeData.set('lats', createVolumeData('lats', 18, 'optimal'));

    const summary = getVolumeSummary(volumeData as Map<never, MuscleVolumeData>);

    expect(summary.musclesOptimal).toContain('chest_upper');
    expect(summary.musclesOptimal).toContain('lats');
  });

  it('identifies muscles exceeding MRV', () => {
    const volumeData = new Map<string, MuscleVolumeData>();

    volumeData.set('chest_upper', createVolumeData('chest_upper', 25, 'exceeding_mrv'));
    volumeData.set('lats', createVolumeData('lats', 18, 'optimal'));

    const summary = getVolumeSummary(volumeData as Map<never, MuscleVolumeData>);

    expect(summary.musclesOverMrv).toContain('chest_upper');
    expect(summary.musclesOverMrv).not.toContain('lats');
  });

  it('calculates average percent of MRV', () => {
    const volumeData = new Map<string, MuscleVolumeData>();

    volumeData.set('chest_upper', { ...createVolumeData('chest_upper', 11, 'optimal'), percentOfMrv: 50 });
    volumeData.set('lats', { ...createVolumeData('lats', 12, 'optimal'), percentOfMrv: 50 });

    const summary = getVolumeSummary(volumeData as Map<never, MuscleVolumeData>);

    expect(summary.averagePercentMrv).toBe(50);
  });
});

// ============================================
// WEEKLY MUSCLE VOLUME CONVERSION TESTS
// ============================================

describe('toWeeklyMuscleVolume', () => {
  it('converts volume data to storage format', () => {
    const volumeData = new Map<string, MuscleVolumeData>();
    volumeData.set('chest_upper', createVolumeData('chest_upper', 16, 'optimal'));
    volumeData.set('lats', createVolumeData('lats', 18, 'approaching_mrv'));

    const records = toWeeklyMuscleVolume('user-1', '2024-01-01', volumeData as Map<never, MuscleVolumeData>);

    expect(records).toHaveLength(2);

    const chestRecord = records.find((r) => r.muscleGroup === 'chest_upper');
    expect(chestRecord).toBeDefined();
    expect(chestRecord!.userId).toBe('user-1');
    expect(chestRecord!.weekStart).toBe('2024-01-01');
    expect(chestRecord!.totalSets).toBe(16);
    expect(chestRecord!.status).toBe('optimal');
  });
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function createVolumeData(
  muscleGroup: string,
  totalSets: number,
  status: MuscleVolumeData['status']
): MuscleVolumeData {
  return {
    muscleGroup: muscleGroup as MuscleVolumeData['muscleGroup'],
    totalSets,
    directSets: totalSets,
    indirectSets: 0,
    landmarks: defaultLandmarks[muscleGroup as keyof typeof defaultLandmarks] || createLandmarks(10, 16, 22),
    status,
    percentOfMrv: Math.round((totalSets / 22) * 100),
  };
}

// ============================================
// EFFECTIVE VOLUME (RIR-WEIGHTED) TESTS
// ============================================

describe('calculateWeeklyVolume — effectiveVolumeSets (RIR-weighted)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  const setWithRir = (blockId: string, rir: 0 | 1 | 2 | 3 | 4): SetLog => ({
    ...createMockSetLog(blockId),
    feedback: { repsInTank: rir, form: 'clean' },
  });

  it('weights a mixed-RIR session by the EFFECTIVE_VOLUME_WEIGHTS table', () => {
    const exercise = createMockExercise('chest_upper');
    const block = createMockBlock(exercise.id);
    const input: CalculateVolumeInput = {
      exerciseBlocks: [
        {
          block,
          exercise,
          // 0 → 1.0, 1 → 1.0, 2 → 1.0, 3 → 0.6, 4 → 0.25 = 3.85
          completedSets: [
            setWithRir(block.id, 0),
            setWithRir(block.id, 1),
            setWithRir(block.id, 2),
            setWithRir(block.id, 3),
            setWithRir(block.id, 4),
          ],
        },
      ],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);
    const chest = result.get('chest_upper')!;
    expect(chest.totalSets).toBe(5); // raw count untouched
    expect(chest.effectiveVolumeSets).toBeCloseTo(3.9, 5); // 3.85 rounded to 1dp
  });

  it('excludes warm-up sets from effective volume exactly like the raw count', () => {
    const exercise = createMockExercise('chest_upper');
    const block = createMockBlock(exercise.id);
    const input: CalculateVolumeInput = {
      exerciseBlocks: [
        {
          block,
          exercise,
          completedSets: [
            { ...createMockSetLog(block.id, true), feedback: { repsInTank: 4, form: 'clean' } },
            { ...createMockSetLog(block.id, true), feedback: { repsInTank: 4, form: 'clean' } },
            setWithRir(block.id, 1),
            setWithRir(block.id, 2),
          ],
        },
      ],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);
    const chest = result.get('chest_upper')!;
    expect(chest.totalSets).toBe(2);
    expect(chest.effectiveVolumeSets).toBeCloseTo(2.0, 5);
  });

  it('weights sets with null/unknown RIR 1.0 (conservative), warns, and never drops them', () => {
    const exercise = createMockExercise('chest_upper');
    const block = createMockBlock(exercise.id);
    const input: CalculateVolumeInput = {
      exerciseBlocks: [
        {
          block,
          exercise,
          // No feedback at all (legacy set) + one explicit RIR 3.
          completedSets: [createMockSetLog(block.id), setWithRir(block.id, 3)],
        },
      ],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);
    const chest = result.get('chest_upper')!;
    expect(chest.totalSets).toBe(2);
    expect(chest.effectiveVolumeSets).toBeCloseTo(1.6, 5); // 1.0 (unknown) + 0.6
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/null\/unknown RIR/);
  });

  it('applies the 0.5x secondary-muscle credit to effective volume too', () => {
    const exercise = createMockExercise('chest_upper', ['triceps']);
    const block = createMockBlock(exercise.id);
    const input: CalculateVolumeInput = {
      exerciseBlocks: [
        {
          block,
          exercise,
          completedSets: [setWithRir(block.id, 0), setWithRir(block.id, 4)], // 1.25 effective
        },
      ],
      userLandmarks: defaultLandmarks,
    };

    const result = calculateWeeklyVolume(input);
    expect(result.get('chest_upper')!.effectiveVolumeSets).toBeCloseTo(1.3, 5); // 1.25 → 1dp
    expect(result.get('triceps')!.effectiveVolumeSets).toBeCloseTo(0.6, 5); // 1.25 × 0.5 → 1dp
  });
});
