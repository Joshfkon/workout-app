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
  type CalculateVolumeInput,
  type MuscleVolumeData,
} from '../volumeTracker';

import type { Exercise, ExerciseBlock, SetLog, VolumeLandmarks } from '@/types/schema';
import { DEFAULT_VOLUME_LANDMARKS } from '@/types/schema';

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

    // Should have entries for all 20 standard muscle groups with 0 sets
    expect(result.size).toBe(20);
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
