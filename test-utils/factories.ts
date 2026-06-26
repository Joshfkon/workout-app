/**
 * Typed factory builders for commonly-drifted domain shapes.
 *
 * These return valid objects against the CURRENT canonical types in
 * '@/types/schema'. Each accepts a shallow `overrides` object that is merged
 * over sensible defaults. Use these in tests instead of hand-rolling literals
 * that drift out of sync with the schema.
 */
import type {
  WorkoutSession,
  ExerciseBlock,
  PreWorkoutCheckIn,
  SetFeedback,
  Exercise,
  DexaScan,
  BodyPartAnalysis,
  RegionalAnalysis,
  SetLog,
} from '@/types/schema';

export function makeWorkoutSession(
  overrides: Partial<WorkoutSession> = {}
): WorkoutSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    mesocycleId: 'meso-1',
    state: 'planned',
    plannedDate: '2024-01-15',
    startedAt: null,
    completedAt: null,
    preWorkoutCheckIn: null,
    sessionRpe: null,
    pumpRating: null,
    sessionNotes: null,
    completionPercent: 0,
    ...overrides,
  };
}

export function makeExerciseBlock(
  overrides: Partial<ExerciseBlock> = {}
): ExerciseBlock {
  return {
    id: 'block-1',
    workoutSessionId: 'session-1',
    exerciseId: 'exercise-1',
    order: 1,
    supersetGroupId: null,
    supersetOrder: null,
    targetSets: 3,
    targetRepRange: [8, 12],
    targetRir: 2,
    targetWeightKg: 60,
    targetRestSeconds: 120,
    progressionType: null,
    suggestionReason: '',
    warmupProtocol: [],
    note: null,
    dropsetsPerSet: 0,
    dropPercentage: 0,
    ...overrides,
  };
}

export function makePreWorkoutCheckIn(
  overrides: Partial<PreWorkoutCheckIn> = {}
): PreWorkoutCheckIn {
  return {
    sleepHours: 8,
    sleepQuality: 4,
    stressLevel: 2,
    nutritionRating: 4,
    bodyweightKg: 80,
    readinessScore: 75,
    ...overrides,
  };
}

export function makeSetFeedback(
  overrides: Partial<SetFeedback> = {}
): SetFeedback {
  return {
    repsInTank: 2,
    form: 'clean',
    ...overrides,
  };
}

export function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'exercise-1',
    name: 'Bench Press',
    primaryMuscle: 'chest',
    secondaryMuscles: ['triceps', 'shoulders'],
    mechanic: 'compound',
    defaultRepRange: [6, 10],
    defaultRir: 2,
    minWeightIncrementKg: 2.5,
    formCues: [],
    commonMistakes: [],
    setupNote: '',
    movementPattern: 'horizontal_push',
    equipmentRequired: ['barbell'],
    ...overrides,
  };
}

export function makeDexaScan(overrides: Partial<DexaScan> = {}): DexaScan {
  return {
    id: 'dexa-1',
    userId: 'user-1',
    scanDate: '2024-01-15',
    weightKg: 87,
    leanMassKg: 65,
    fatMassKg: 22,
    bodyFatPercent: 25,
    boneMassKg: null,
    regionalData: null,
    notes: null,
    createdAt: '2024-01-15T00:00:00.000Z',
    ...overrides,
  };
}

export function makeBodyPartAnalysis(
  overrides: Partial<BodyPartAnalysis> = {}
): BodyPartAnalysis {
  return {
    name: 'Arms',
    leanMassKg: 8,
    fatMassKg: 2,
    percentOfTotal: 12,
    status: 'balanced',
    ...overrides,
  };
}

export function makeRegionalAnalysis(
  overrides: Partial<RegionalAnalysis> = {}
): RegionalAnalysis {
  return {
    parts: [],
    asymmetries: { arms: 0, legs: 0 },
    upperLowerRatio: 0.4,
    androidGynoidRatio: 0.9,
    laggingAreas: [],
    dominantAreas: [],
    ...overrides,
  };
}

export function makeSetLog(overrides: Partial<SetLog> = {}): SetLog {
  return {
    id: 'set-1',
    exerciseBlockId: 'block-1',
    setNumber: 1,
    reps: 10,
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
  };
}
