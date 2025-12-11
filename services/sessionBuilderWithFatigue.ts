/**
 * Session Builder with Fatigue Integration
 * Builds detailed workout sessions using the rep range engine, fatigue budget system,
 * and weekly recovery tracking.
 */

import type {
  Goal,
  Experience,
  MuscleGroup,
  MovementPattern,
  Equipment,
  PeriodizationModel,
  DUPDayType,
  ExtendedUserProfile,
  ExerciseEntry,
  SessionTemplate,
  WeeklyProgression,
  FatigueBudgetConfig,
  RepRangeConfig,
  DetailedSessionWithFatigue,
  DetailedExerciseWithFatigue,
  MesocycleWeek,
  PeriodizationPlan,
  RecoveryFactors,
  FullProgramRecommendation,
  Split,
} from '@/types/schema';

import {
  calculateRepRange,
  getDUPRepRange,
  getDUPTempo,
  getDUPRestPeriod,
  getDUPNotes,
  getDUPTargetRIR,
  getPositionCategory,
  buildLoadGuidance,
} from './repRangeEngine';

import {
  calculateExerciseFatigue,
  createFatigueBudget,
  SessionFatigueManager,
  WeeklyFatigueTracker,
  BASE_SFR,
} from './fatigueBudgetEngine';

import { calculateRecoveryFactors, buildPeriodizationPlan, calculateVolumeDistribution as calculateVolumeDistributionWithLagging, EXERCISE_DATABASE } from './mesocycleBuilder';

// ============================================================
// WARMUP GENERATION
// ============================================================

/**
 * Generate warmup instructions based on primary muscle
 */
function generateWarmup(primaryMuscle: MuscleGroup): string[] {
  const warmups: Record<string, string[]> = {
    lower: [
      '5 min bike or walking',
      'Leg swings (front/back, side to side) x 10 each',
      'Goblet squat x 10 (bodyweight or light)',
      'Glute bridges x 10',
    ],
    upper: [
      '5 min rowing or arm circles',
      'Band pull-aparts x 15',
      'Push-ups x 10',
      'Face pulls x 10 (light)',
    ],
    full: [
      '5 min cardio',
      "World's greatest stretch x 5 each side",
      'Arm circles and leg swings',
      'Bodyweight squats x 10',
      'Push-ups x 10',
    ],
  };

  if (['quads', 'hamstrings', 'glutes', 'calves'].includes(primaryMuscle)) {
    return warmups.lower;
  }
  if (['chest', 'back', 'shoulders', 'biceps', 'triceps'].includes(primaryMuscle)) {
    return warmups.upper;
  }
  return warmups.full;
}

// ============================================================
// REST PERIOD CALCULATION
// ============================================================

/**
 * Get rest period based on exercise type and goal
 */
function getRestPeriod(exercise: ExerciseEntry, goal: Goal): number {
  const isCompound = exercise.pattern !== 'isolation';

  if (goal === 'cut') {
    return isCompound ? 120 : 60;
  }
  if (goal === 'bulk') {
    return isCompound ? 180 : 90;
  }
  return isCompound ? 150 : 75;
}

// ============================================================
// EXERCISE SELECTION WITH FATIGUE AWARENESS
// ============================================================

/**
 * Select exercises for a muscle group considering equipment, experience, injury, and SFR
 */
function selectExercisesWithFatigue(
  muscle: MuscleGroup,
  setsNeeded: number,
  profile: ExtendedUserProfile,
  fatigueManager: SessionFatigueManager,
  startingPosition: number
): { exercise: ExerciseEntry; sets: number }[] {
  // Filter available exercises
  let candidates = EXERCISE_DATABASE.filter(
    (e) =>
      e.primaryMuscle === muscle &&
      profile.availableEquipment.includes(e.equipment) &&
      !profile.injuryHistory.includes(muscle)
  );

  // Filter by difficulty
  if (profile.experience === 'novice') {
    candidates = candidates.filter((e) => e.difficulty === 'beginner');
  } else if (profile.experience === 'intermediate') {
    candidates = candidates.filter((e) => e.difficulty !== 'advanced');
  }

  if (candidates.length === 0) {
    candidates = EXERCISE_DATABASE.filter(
      (e) => e.primaryMuscle === muscle && profile.availableEquipment.includes(e.equipment)
    );
  }

  if (candidates.length === 0) {
    candidates = EXERCISE_DATABASE.filter((e) => e.primaryMuscle === muscle);
  }

  // Sort by SFR (stimulus-to-fatigue ratio) - prefer more efficient exercises
  candidates.sort((a, b) => {
    const sfrA = BASE_SFR[a.pattern]?.[a.equipment] ?? 1.0;
    const sfrB = BASE_SFR[b.pattern]?.[b.equipment] ?? 1.0;

    // Compounds first for early positions
    if (startingPosition <= 2) {
      const aCompound = a.pattern !== 'isolation' ? 0 : 1;
      const bCompound = b.pattern !== 'isolation' ? 0 : 1;
      if (aCompound !== bCompound) return aCompound - bCompound;
    }

    return sfrB - sfrA; // Higher SFR first
  });

  const selected: { exercise: ExerciseEntry; sets: number }[] = [];
  let remainingSets = setsNeeded;

  for (const exercise of candidates) {
    if (remainingSets <= 0) break;

    // Estimate if this exercise can fit in the budget
    const testFatigue = calculateExerciseFatigue(
      exercise,
      Math.min(remainingSets, 3),
      8, // Estimate average reps
      2, // Estimate RIR
      startingPosition + selected.length
    );

    const canAdd = fatigueManager.canAddExercise(testFatigue);
    if (!canAdd.allowed) continue;

    // Determine sets for this exercise
    const maxSetsForExercise = exercise.pattern === 'isolation' ? 3 : 4;
    const setsForThis = Math.min(remainingSets, maxSetsForExercise);

    selected.push({ exercise, sets: setsForThis });
    remainingSets -= setsForThis;
  }

  return selected;
}

// ============================================================
// DETAILED EXERCISE BUILDER
// ============================================================

/**
 * Build a detailed exercise entry with all fatigue and rep information
 */
function buildDetailedExercise(
  exercise: ExerciseEntry,
  sets: number,
  reps: RepRangeConfig,
  goal: Goal,
  fatigue: ReturnType<typeof calculateExerciseFatigue>,
  efficiency: 'optimal' | 'acceptable' | 'suboptimal' | 'junk',
  weeklyProgression: WeeklyProgression
): DetailedExerciseWithFatigue {
  const restSeconds = getRestPeriod(exercise, goal);
  const loadGuidance = buildLoadGuidance(reps, weeklyProgression.focus);

  // Combine notes
  const notes = [exercise.notes, reps.notes, efficiency === 'suboptimal' ? 'Consider swapping for more efficient alternative' : '']
    .filter(Boolean)
    .join('. ');

  // Convert Map to Record for serialization
  const localCostRecord: Record<string, number> = {};
  const entries = Array.from(fatigue.localCost.entries());
  for (const [muscle, cost] of entries) {
    localCostRecord[muscle] = cost;
  }

  return {
    exercise,
    sets,
    reps,
    restSeconds,
    loadGuidance,
    notes,
    fatigueProfile: {
      systemicCost: fatigue.systemicCost,
      localCost: localCostRecord,
      sfr: fatigue.stimulusPerFatigue,
      efficiency,
    },
  };
}

// ============================================================
// STANDARD SESSION BUILDER
// ============================================================

/**
 * Build a detailed session with fatigue tracking
 */
export function buildDetailedSessionWithFatigue(
  sessionTemplate: SessionTemplate,
  volumePerMuscle: Record<MuscleGroup, { sets: number; frequency: number }>,
  profile: ExtendedUserProfile,
  fatigueBudgetConfig: FatigueBudgetConfig,
  weeklyTracker: WeeklyFatigueTracker,
  currentDay: number,
  weekInMesocycle: number,
  totalMesocycleWeeks: number,
  periodizationModel: PeriodizationModel,
  weeklyProgression: WeeklyProgression
): DetailedSessionWithFatigue {
  const fatigueManager = new SessionFatigueManager(fatigueBudgetConfig);
  const exercises: DetailedExerciseWithFatigue[] = [];

  // Order muscles: compounds first (big muscles), then isolations
  const muscleOrder: MuscleGroup[] = [
    'quads',
    'hamstrings',
    'glutes',
    'back',
    'chest',
    'shoulders',
    'biceps',
    'triceps',
    'calves',
    'abs',
  ];

  const orderedMuscles = [...sessionTemplate.targetMuscles].sort(
    (a, b) => muscleOrder.indexOf(a) - muscleOrder.indexOf(b)
  );

  let exercisePosition = 1;

  for (const muscle of orderedMuscles) {
    // Check if muscle is recovered enough to train
    const recoveryStatus = weeklyTracker.canTrainMuscle(
      muscle,
      currentDay,
      (volumePerMuscle[muscle]?.sets || 0) / (volumePerMuscle[muscle]?.frequency || 1)
    );

    if (!recoveryStatus.ready && recoveryStatus.currentFatigue > 50) {
      // Skip this muscle entirely if severely fatigued
      continue;
    }

    const muscleVolume = volumePerMuscle[muscle];
    if (!muscleVolume) continue;

    let setsThisSession = Math.ceil(muscleVolume.sets / muscleVolume.frequency);

    // Apply weekly volume modifier
    setsThisSession = Math.round(setsThisSession * weeklyProgression.volumeModifier);
    setsThisSession = Math.max(1, setsThisSession);

    // Reduce volume if muscle has residual fatigue
    if (recoveryStatus.currentFatigue > 25) {
      const fatigueReduction = 1 - (recoveryStatus.currentFatigue - 25) / 100;
      setsThisSession = Math.max(1, Math.round(setsThisSession * fatigueReduction));
    }

    // Select exercises with fatigue awareness
    const selectedExercises = selectExercisesWithFatigue(muscle, setsThisSession, profile, fatigueManager, exercisePosition);

    for (const selection of selectedExercises) {
      // Determine position category
      const positionCategory = getPositionCategory(exercisePosition, orderedMuscles.length * 2);

      // Calculate rep range
      const repConfig = calculateRepRange({
        goal: profile.goal,
        experience: profile.experience,
        exercisePattern: selection.exercise.pattern,
        muscleGroup: muscle,
        positionInWorkout: positionCategory,
        weekInMesocycle,
        totalMesocycleWeeks,
        periodizationModel,
      });

      // Apply weekly intensity modifier to RIR
      const adjustedRIR = Math.max(
        0,
        Math.min(4, repConfig.targetRIR + Math.round((1 - weeklyProgression.intensityModifier) * 3))
      );

      // Calculate fatigue for this exercise
      const avgReps = Math.round((repConfig.min + repConfig.max) / 2);
      const exerciseFatigue = calculateExerciseFatigue(
        selection.exercise,
        selection.sets,
        avgReps,
        adjustedRIR,
        exercisePosition
      );

      // Check if we can add this exercise
      const canAdd = fatigueManager.canAddExercise(exerciseFatigue);

      if (!canAdd.allowed) {
        // Try to reduce sets to fit
        const reducedSets = Math.max(1, selection.sets - 1);
        const reducedFatigue = calculateExerciseFatigue(
          selection.exercise,
          reducedSets,
          avgReps,
          adjustedRIR,
          exercisePosition
        );

        const canAddReduced = fatigueManager.canAddExercise(reducedFatigue);
        if (!canAddReduced.allowed) {
          continue; // Skip this exercise entirely
        }

        selection.sets = reducedSets;
        fatigueManager.addExercise(reducedFatigue);

        exercises.push(
          buildDetailedExercise(
            selection.exercise,
            reducedSets,
            { ...repConfig, targetRIR: adjustedRIR },
            profile.goal,
            reducedFatigue,
            canAddReduced.efficiency,
            weeklyProgression
          )
        );
      } else {
        fatigueManager.addExercise(exerciseFatigue);

        exercises.push(
          buildDetailedExercise(
            selection.exercise,
            selection.sets,
            { ...repConfig, targetRIR: adjustedRIR },
            profile.goal,
            exerciseFatigue,
            canAdd.efficiency,
            weeklyProgression
          )
        );
      }

      // Track weekly fatigue
      const localCost = exerciseFatigue.localCost.get(muscle) ?? 0;
      weeklyTracker.recordTraining(muscle, currentDay, localCost, selection.sets);

      exercisePosition++;
    }
  }

  // Get session fatigue summary
  const fatigueSummary = fatigueManager.getSessionSummary();

  // Calculate time
  const totalSets = exercises.reduce((sum, e) => sum + e.sets, 0);
  const totalRestMinutes = exercises.reduce((sum, e) => sum + (e.sets * e.restSeconds) / 60, 0);
  const estimatedMinutes = Math.round(totalRestMinutes + totalSets * 0.75 + 10);

  return {
    day: sessionTemplate.day,
    focus: sessionTemplate.focus,
    exercises,
    totalSets,
    estimatedMinutes,
    warmup: generateWarmup(orderedMuscles[0]),
    fatigueSummary: {
      systemicFatigueGenerated: fatigueSummary.totalSystemicFatigue,
      systemicCapacityUsed: fatigueSummary.systemicCapacityUsed,
      averageSFR: fatigueSummary.averageSFR,
      localFatigueByMuscle: fatigueSummary.localFatigueByMuscle,
    },
  };
}

// ============================================================
// DUP (DAILY UNDULATING PERIODIZATION) SESSION BUILDER
// ============================================================

/**
 * Build a session for Daily Undulating Periodization
 */
export function buildDUPSession(
  sessionTemplate: SessionTemplate,
  volumePerMuscle: Record<MuscleGroup, { sets: number; frequency: number }>,
  profile: ExtendedUserProfile,
  fatigueBudgetConfig: FatigueBudgetConfig,
  weeklyTracker: WeeklyFatigueTracker,
  currentDay: number,
  dupDayType: DUPDayType,
  weekInMesocycle: number,
  totalMesocycleWeeks: number
): DetailedSessionWithFatigue {
  const fatigueManager = new SessionFatigueManager(fatigueBudgetConfig);
  const exercises: DetailedExerciseWithFatigue[] = [];

  const muscleOrder: MuscleGroup[] = [
    'quads',
    'hamstrings',
    'glutes',
    'back',
    'chest',
    'shoulders',
    'biceps',
    'triceps',
    'calves',
    'abs',
  ];

  const orderedMuscles = [...sessionTemplate.targetMuscles].sort(
    (a, b) => muscleOrder.indexOf(a) - muscleOrder.indexOf(b)
  );

  // Adjust volume based on DUP day type
  const volumeModifiers: Record<DUPDayType, number> = {
    hypertrophy: 1.1, // Higher volume
    strength: 0.85, // Moderate volume
    power: 0.7, // Lower volume, higher intensity
  };

  let exercisePosition = 1;

  for (const muscle of orderedMuscles) {
    const recoveryStatus = weeklyTracker.canTrainMuscle(muscle, currentDay, 0);
    if (!recoveryStatus.ready && recoveryStatus.currentFatigue > 50) continue;

    const muscleVolume = volumePerMuscle[muscle];
    if (!muscleVolume) continue;

    let setsThisSession = Math.ceil(muscleVolume.sets / muscleVolume.frequency);
    setsThisSession = Math.round(setsThisSession * volumeModifiers[dupDayType]);
    setsThisSession = Math.max(1, setsThisSession);

    const selectedExercises = selectExercisesWithFatigue(muscle, setsThisSession, profile, fatigueManager, exercisePosition);

    for (const selection of selectedExercises) {
      const isCompound = selection.exercise.pattern !== 'isolation';

      // Get DUP-specific rep range
      const dupRepRange = getDUPRepRange(dupDayType, isCompound, muscle);
      const targetRIR = getDUPTargetRIR(dupDayType);

      const repConfig: RepRangeConfig = {
        min: dupRepRange.min,
        max: dupRepRange.max,
        targetRIR,
        tempoRecommendation: getDUPTempo(dupDayType, isCompound),
        notes: getDUPNotes(dupDayType),
      };

      const avgReps = Math.round((repConfig.min + repConfig.max) / 2);
      const exerciseFatigue = calculateExerciseFatigue(
        selection.exercise,
        selection.sets,
        avgReps,
        repConfig.targetRIR,
        exercisePosition
      );

      const canAdd = fatigueManager.canAddExercise(exerciseFatigue);
      if (!canAdd.allowed) continue;

      fatigueManager.addExercise(exerciseFatigue);

      const restSeconds = getDUPRestPeriod(dupDayType, isCompound);

      // Convert Map to Record
      const localCostRecord: Record<string, number> = {};
      const entries = Array.from(exerciseFatigue.localCost.entries());
      for (const [m, cost] of entries) {
        localCostRecord[m] = cost;
      }

      exercises.push({
        exercise: selection.exercise,
        sets: selection.sets,
        reps: repConfig,
        restSeconds,
        loadGuidance: `${repConfig.min}-${repConfig.max} reps @ ${repConfig.targetRIR} RIR`,
        notes: repConfig.notes,
        fatigueProfile: {
          systemicCost: exerciseFatigue.systemicCost,
          localCost: localCostRecord,
          sfr: exerciseFatigue.stimulusPerFatigue,
          efficiency: canAdd.efficiency,
        },
      });

      const localCost = exerciseFatigue.localCost.get(muscle) ?? 0;
      weeklyTracker.recordTraining(muscle, currentDay, localCost, selection.sets);

      exercisePosition++;
    }
  }

  const fatigueSummary = fatigueManager.getSessionSummary();
  const totalSets = exercises.reduce((sum, e) => sum + e.sets, 0);
  const totalRestMinutes = exercises.reduce((sum, e) => sum + (e.sets * e.restSeconds) / 60, 0);

  return {
    day: sessionTemplate.day,
    focus: `${sessionTemplate.focus} - ${dupDayType.toUpperCase()} Day`,
    exercises,
    totalSets,
    estimatedMinutes: Math.round(totalRestMinutes + totalSets * 0.75 + 10),
    warmup: generateWarmup(orderedMuscles[0]),
    fatigueSummary: {
      systemicFatigueGenerated: fatigueSummary.totalSystemicFatigue,
      systemicCapacityUsed: fatigueSummary.systemicCapacityUsed,
      averageSFR: fatigueSummary.averageSFR,
      localFatigueByMuscle: fatigueSummary.localFatigueByMuscle,
    },
  };
}

// ============================================================
// FULL MESOCYCLE BUILDER WITH FATIGUE INTEGRATION
// ============================================================

/**
 * Build session templates based on split
 */
function buildSessionTemplates(split: Split, daysPerWeek: number): SessionTemplate[] {
  const templates: Record<Split, SessionTemplate[]> = {
    'Full Body': [
      { day: 'Full Body A', focus: 'Quad/Push emphasis', targetMuscles: ['quads', 'chest', 'shoulders', 'triceps', 'abs'] },
      { day: 'Full Body B', focus: 'Hinge/Pull emphasis', targetMuscles: ['hamstrings', 'back', 'biceps', 'glutes', 'calves'] },
      { day: 'Full Body C', focus: 'Balanced', targetMuscles: ['quads', 'back', 'shoulders', 'biceps', 'triceps'] },
    ],
    'Upper/Lower': [
      { day: 'Upper A', focus: 'Horizontal emphasis', targetMuscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] },
      { day: 'Lower A', focus: 'Quad emphasis', targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
      { day: 'Upper B', focus: 'Vertical emphasis', targetMuscles: ['back', 'chest', 'shoulders', 'triceps', 'biceps'] },
      { day: 'Lower B', focus: 'Hinge emphasis', targetMuscles: ['hamstrings', 'quads', 'glutes', 'calves', 'abs'] },
    ],
    PPL: [
      { day: 'Push', focus: 'Chest, shoulders, triceps', targetMuscles: ['chest', 'shoulders', 'triceps'] },
      { day: 'Pull', focus: 'Back, biceps, rear delts', targetMuscles: ['back', 'biceps', 'shoulders'] },
      { day: 'Legs', focus: 'Quads, hamstrings, glutes', targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    Arnold: [
      { day: 'Chest & Back', focus: 'Antagonist supersets', targetMuscles: ['chest', 'back'] },
      { day: 'Shoulders & Arms', focus: 'Upper body detail', targetMuscles: ['shoulders', 'biceps', 'triceps'] },
      { day: 'Legs', focus: 'Complete lower body', targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    'Bro Split': [
      { day: 'Chest', focus: 'Chest only', targetMuscles: ['chest'] },
      { day: 'Back', focus: 'Back only', targetMuscles: ['back'] },
      { day: 'Shoulders', focus: 'All three heads', targetMuscles: ['shoulders'] },
      { day: 'Arms', focus: 'Biceps & Triceps', targetMuscles: ['biceps', 'triceps'] },
      { day: 'Legs', focus: 'Complete lower body', targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
    ],
  };

  const baseTemplates = templates[split];

  // Adjust number of templates based on days per week
  if (split === 'PPL' && daysPerWeek >= 6) {
    return [
      ...baseTemplates.map((t) => ({ ...t, day: t.day + ' 1' })),
      ...baseTemplates.map((t) => ({ ...t, day: t.day + ' 2' })),
    ].slice(0, daysPerWeek);
  }

  return baseTemplates.slice(0, daysPerWeek);
}

/**
 * Calculate volume distribution with frequency
 */
function calculateVolumeDistribution(
  split: Split,
  daysPerWeek: number,
  experience: Experience,
  goal: Goal,
  recoveryFactors: RecoveryFactors
): Record<MuscleGroup, { sets: number; frequency: number }> {
  const muscles: MuscleGroup[] = [
    'chest',
    'back',
    'shoulders',
    'biceps',
    'triceps',
    'quads',
    'hamstrings',
    'glutes',
    'calves',
    'abs',
  ];

  // Base volumes
  const baseVolumes: Record<string, Record<Experience, number>> = {
    chest: { novice: 10, intermediate: 14, advanced: 18 },
    back: { novice: 12, intermediate: 16, advanced: 20 },
    shoulders: { novice: 10, intermediate: 14, advanced: 18 },
    biceps: { novice: 8, intermediate: 12, advanced: 16 },
    triceps: { novice: 8, intermediate: 12, advanced: 16 },
    quads: { novice: 10, intermediate: 14, advanced: 18 },
    hamstrings: { novice: 8, intermediate: 12, advanced: 14 },
    glutes: { novice: 8, intermediate: 12, advanced: 16 },
    calves: { novice: 10, intermediate: 14, advanced: 18 },
    abs: { novice: 8, intermediate: 12, advanced: 16 },
  };

  // Frequency based on split
  const frequencyMap: Record<Split, Record<MuscleGroup, number>> = {
    'Full Body': {
      chest: Math.min(daysPerWeek, 3),
      back: Math.min(daysPerWeek, 3),
      shoulders: Math.min(daysPerWeek, 3),
      biceps: Math.min(daysPerWeek, 2),
      triceps: Math.min(daysPerWeek, 2),
      quads: Math.min(daysPerWeek, 3),
      hamstrings: Math.min(daysPerWeek, 2),
      glutes: Math.min(daysPerWeek, 2),
      calves: Math.min(daysPerWeek, 2),
      abs: Math.min(daysPerWeek, 2),
    },
    'Upper/Lower': {
      chest: 2,
      back: 2,
      shoulders: 2,
      biceps: 2,
      triceps: 2,
      quads: 2,
      hamstrings: 2,
      glutes: 2,
      calves: 2,
      abs: 2,
    },
    PPL: {
      chest: daysPerWeek >= 6 ? 2 : 1,
      back: daysPerWeek >= 6 ? 2 : 1,
      shoulders: daysPerWeek >= 6 ? 2 : 1,
      biceps: daysPerWeek >= 6 ? 2 : 1,
      triceps: daysPerWeek >= 6 ? 2 : 1,
      quads: daysPerWeek >= 6 ? 2 : 1,
      hamstrings: daysPerWeek >= 6 ? 2 : 1,
      glutes: daysPerWeek >= 6 ? 2 : 1,
      calves: daysPerWeek >= 6 ? 2 : 1,
      abs: daysPerWeek >= 6 ? 2 : 1,
    },
    Arnold: {
      chest: 2,
      back: 2,
      shoulders: 2,
      biceps: 2,
      triceps: 2,
      quads: 2,
      hamstrings: 2,
      glutes: 2,
      calves: 2,
      abs: 2,
    },
    'Bro Split': {
      chest: 1,
      back: 1,
      shoulders: 1,
      biceps: 1,
      triceps: 1,
      quads: 1,
      hamstrings: 1,
      glutes: 1,
      calves: 1,
      abs: 1,
    },
  };

  const frequencies = frequencyMap[split];
  const result = {} as Record<MuscleGroup, { sets: number; frequency: number }>;

  muscles.forEach((muscle) => {
    let baseVolume = baseVolumes[muscle]?.[experience] || 12;

    // Goal adjustment
    if (goal === 'cut') {
      baseVolume = Math.round(baseVolume * 0.7);
    } else if (goal === 'bulk') {
      baseVolume = Math.round(baseVolume * 1.1);
    }

    // Recovery adjustment
    const adjustedVolume = Math.round(baseVolume * recoveryFactors.volumeMultiplier);
    const frequency = Math.round(frequencies[muscle] * recoveryFactors.frequencyMultiplier);

    result[muscle] = {
      sets: adjustedVolume,
      frequency: Math.max(1, frequency),
    };
  });

  return result;
}

/**
 * Generate a complete mesocycle with fatigue-integrated sessions
 */
export function generateFullMesocycleWithFatigue(
  daysPerWeek: number,
  profile: ExtendedUserProfile,
  sessionMinutes: number = 60,
  laggingAreas?: string[]
): FullProgramRecommendation {
  const warnings: string[] = [];
  const programNotes: string[] = [];

  // Step 1: Calculate recovery factors
  const recoveryFactors = calculateRecoveryFactors(profile);
  warnings.push(...recoveryFactors.warnings);

  // Step 2: Create fatigue budget
  const fatigueBudgetConfig = createFatigueBudget(profile);
  programNotes.push(`Systemic fatigue limit: ${fatigueBudgetConfig.systemicLimit}/session`);
  programNotes.push(`Minimum SFR threshold: ${fatigueBudgetConfig.minSFRThreshold}`);

  // Step 3: Get split recommendation (import from mesocycleBuilder)
  const { recommendSplit } = require('./mesocycleBuilder');
  const splitRec = recommendSplit(daysPerWeek, profile.goal, profile.experience, sessionMinutes);
  const split: Split = splitRec.split;

  programNotes.push(`Split: ${split} - ${splitRec.reason}`);

  // Step 4: Build periodization plan
  const periodization = buildPeriodizationPlan(profile, recoveryFactors);
  programNotes.push(`Periodization model: ${periodization.model}`);
  programNotes.push(`Mesocycle: ${periodization.mesocycleWeeks} weeks`);
  programNotes.push(`Deload strategy: ${periodization.deloadStrategy}`);

  // Step 5: Calculate volume distribution (with extra volume for lagging areas if provided)
  const volumePerMuscle = calculateVolumeDistributionWithLagging(split, daysPerWeek, profile.experience, profile.goal, recoveryFactors, laggingAreas);
  
  // Add note if lagging areas are being addressed
  if (laggingAreas && laggingAreas.length > 0) {
    programNotes.push(`🎯 Extra volume allocated for: ${laggingAreas.join(', ')}`);
  }

  // Step 6: Build session templates
  const sessionTemplates = buildSessionTemplates(split, daysPerWeek);

  // Step 7: Generate schedule
  const schedulePatterns: Record<number, string[]> = {
    2: ['Mon', 'Thu'],
    3: ['Mon', 'Wed', 'Fri'],
    4: ['Mon', 'Tue', 'Thu', 'Fri'],
    5: ['Mon', 'Tue', 'Wed', 'Fri', 'Sat'],
    6: ['Mon', 'Tue', 'Wed', 'Fri', 'Sat', 'Sun'],
  };
  const schedule = schedulePatterns[daysPerWeek] || schedulePatterns[4];

  // Step 8: Build full mesocycle with week-by-week progression
  const mesocycleWeeks: MesocycleWeek[] = [];

  for (let weekNum = 1; weekNum <= periodization.mesocycleWeeks; weekNum++) {
    const weekProgression = periodization.weeklyProgression[weekNum - 1];
    const isDeload = weekNum === periodization.mesocycleWeeks;

    // Fresh weekly tracker each week
    const weeklyTracker = new WeeklyFatigueTracker(profile);
    const weekSessions: DetailedSessionWithFatigue[] = [];

    // DUP rotation
    const dupRotation: DUPDayType[] = ['hypertrophy', 'strength', 'power'];
    let dupIndex = 0;
    let dayCounter = 0;

    for (const template of sessionTemplates) {
      let session: DetailedSessionWithFatigue;

      const deloadBudget = isDeload
        ? { ...fatigueBudgetConfig, systemicLimit: fatigueBudgetConfig.systemicLimit * 0.5 }
        : fatigueBudgetConfig;

      if (periodization.model === 'daily_undulating' && !isDeload) {
        // DUP: rotate through hypertrophy/strength/power
        session = buildDUPSession(
          template,
          volumePerMuscle,
          profile,
          deloadBudget,
          weeklyTracker,
          dayCounter,
          dupRotation[dupIndex % 3],
          weekNum,
          periodization.mesocycleWeeks
        );
        dupIndex++;
      } else {
        session = buildDetailedSessionWithFatigue(
          template,
          volumePerMuscle,
          profile,
          deloadBudget,
          weeklyTracker,
          dayCounter,
          weekNum,
          periodization.mesocycleWeeks,
          periodization.model,
          weekProgression
        );
      }

      weekSessions.push(session);
      dayCounter++;
    }

    mesocycleWeeks.push({
      weekNumber: weekNum,
      focus: weekProgression.focus,
      intensityModifier: weekProgression.intensityModifier,
      volumeModifier: weekProgression.volumeModifier,
      rpeTarget: weekProgression.rpeTarget,
      sessions: weekSessions,
      isDeload,
    });
  }

  // Step 9: Use first week's sessions for backward compatibility
  const sessions = mesocycleWeeks[0].sessions;

  // Step 10: Validate and warn
  const avgSessionTime = sessions.reduce((sum, s) => sum + s.estimatedMinutes, 0) / sessions.length;
  if (avgSessionTime > sessionMinutes * 1.2) {
    warnings.push(`Sessions averaging ${Math.round(avgSessionTime)} min may exceed your ${sessionMinutes} min target.`);
  }

  const avgSFR = sessions.reduce((sum, s) => sum + s.fatigueSummary.averageSFR, 0) / sessions.length;
  if (avgSFR < 0.8) {
    warnings.push(`Average SFR (${avgSFR.toFixed(2)}) is below optimal. Consider switching to more efficient exercises.`);
  }

  const avgCapacityUsed = sessions.reduce((sum, s) => sum + s.fatigueSummary.systemicCapacityUsed, 0) / sessions.length;
  if (avgCapacityUsed < 60) {
    programNotes.push(`Sessions using ~${Math.round(avgCapacityUsed)}% capacity - room to add volume if desired.`);
  }

  // Convert DetailedSessionWithFatigue to DetailedSession for backward compatibility
  const legacySessions = sessions.map((s) => ({
    day: s.day,
    focus: s.focus,
    exercises: s.exercises.map((e) => ({
      exercise: e.exercise,
      sets: e.sets,
      repRange: `${e.reps.min}-${e.reps.max}`,
      restSeconds: e.restSeconds,
      notes: e.notes,
    })),
    totalSets: s.totalSets,
    estimatedMinutes: s.estimatedMinutes,
    warmup: s.warmup,
  }));

  return {
    split,
    schedule,
    periodization,
    recoveryProfile: recoveryFactors,
    fatigueBudget: fatigueBudgetConfig,
    volumePerMuscle,
    sessions: legacySessions,
    mesocycleWeeks,
    warnings,
    programNotes,
  };
}

// ============================================================
// PROGRAM DISPLAY HELPERS
// ============================================================

/**
 * Format a session for display
 */
export function formatSessionForDisplay(session: DetailedSessionWithFatigue): string {
  let output = '';

  output += `=== ${session.day} (${session.focus}) ===\n`;
  output += `Duration: ~${session.estimatedMinutes} min | ${session.totalSets} total sets\n`;
  output += `Fatigue: ${session.fatigueSummary.systemicCapacityUsed}% capacity | Avg SFR: ${session.fatigueSummary.averageSFR.toFixed(2)}\n\n`;

  output += 'WARMUP:\n';
  session.warmup.forEach((w) => (output += `  • ${w}\n`));
  output += '\n';

  output += 'EXERCISES:\n';
  session.exercises.forEach((ex, i) => {
    output += `${i + 1}. ${ex.exercise.name}\n`;
    output += `   ${ex.sets} sets x ${ex.reps.min}-${ex.reps.max} reps @ ${ex.reps.targetRIR} RIR\n`;
    output += `   Rest: ${ex.restSeconds}s | Tempo: ${ex.reps.tempoRecommendation}\n`;
    output += `   SFR: ${ex.fatigueProfile.sfr.toFixed(2)} (${ex.fatigueProfile.efficiency})\n`;
    if (ex.notes) output += `   Note: ${ex.notes}\n`;
    output += '\n';
  });

  return output;
}

/**
 * Format a full mesocycle for display
 */
export function formatMesocycleForDisplay(program: FullProgramRecommendation): string {
  let output = '';

  output += '═══════════════════════════════════════════════════════════\n';
  output += '                    MESOCYCLE OVERVIEW\n';
  output += '═══════════════════════════════════════════════════════════\n\n';

  output += `Split: ${program.split}\n`;
  output += `Schedule: ${program.schedule.join(' → ')}\n`;
  output += `Periodization: ${program.periodization.model}\n`;
  output += `Duration: ${program.periodization.mesocycleWeeks} weeks\n\n`;

  output += '─── RECOVERY PROFILE ───\n';
  output += `Volume modifier: ${(program.recoveryProfile.volumeMultiplier * 100).toFixed(0)}%\n`;
  output += `Deload every: ${program.recoveryProfile.deloadFrequencyWeeks} weeks\n`;
  if (program.recoveryProfile.warnings.length > 0) {
    output += `Warnings:\n`;
    program.recoveryProfile.warnings.forEach((w) => (output += `  ⚠️ ${w}\n`));
  }
  output += '\n';

  if (program.fatigueBudget) {
    output += '─── FATIGUE BUDGET ───\n';
    output += `Systemic limit: ${program.fatigueBudget.systemicLimit}/session\n`;
    output += `Local limit: ${program.fatigueBudget.localLimit}/muscle\n`;
    output += `Min SFR threshold: ${program.fatigueBudget.minSFRThreshold}\n\n`;
  }

  output += '─── WEEKLY VOLUME TARGETS ───\n';
  const entries = Object.entries(program.volumePerMuscle);
  for (const [muscle, vol] of entries) {
    output += `${muscle}: ${vol.sets} sets/week @ ${vol.frequency}x frequency\n`;
  }
  output += '\n';

  if (program.mesocycleWeeks) {
    output += '═══════════════════════════════════════════════════════════\n';
    output += '                 WEEK-BY-WEEK BREAKDOWN\n';
    output += '═══════════════════════════════════════════════════════════\n\n';

    for (const week of program.mesocycleWeeks) {
      output += `\n━━━ WEEK ${week.weekNumber}${week.isDeload ? ' (DELOAD)' : ''}: ${week.focus} ━━━\n`;
      output += `Intensity: ${(week.intensityModifier * 100).toFixed(0)}% | `;
      output += `Volume: ${(week.volumeModifier * 100).toFixed(0)}% | `;
      output += `RPE: ${week.rpeTarget.min}-${week.rpeTarget.max}\n\n`;

      for (const session of week.sessions) {
        output += formatSessionForDisplay(session);
        output += '\n';
      }
    }
  }

  if (program.warnings.length > 0) {
    output += '\n─── WARNINGS ───\n';
    program.warnings.forEach((w) => (output += `⚠️ ${w}\n`));
  }

  if (program.programNotes.length > 0) {
    output += '\n─── NOTES ───\n';
    program.programNotes.forEach((n) => (output += `• ${n}\n`));
  }

  return output;
}

