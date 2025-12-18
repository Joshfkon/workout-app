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

import { filterExercisesByEquipment } from './equipmentFilter';

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

import { calculateRecoveryFactors, buildPeriodizationPlan, calculateVolumeDistribution as calculateVolumeDistributionWithLagging, generateWarmup } from './mesocycleBuilder';
import { getExercisesSync, type Exercise as ServiceExercise } from './exerciseService';

// NOTE: generateWarmup imported from mesocycleBuilder.ts

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
// TIME ESTIMATION
// ============================================================

/**
 * Estimate time for an exercise including all sets and rest
 * Returns time in minutes
 */
function estimateExerciseTime(
  isCompound: boolean,
  goal: Goal,
  setsCount: number,
  includeWarmup: boolean
): number {
  const restSeconds = isCompound
    ? (goal === 'bulk' ? 180 : goal === 'cut' ? 120 : 150)
    : (goal === 'bulk' ? 90 : goal === 'cut' ? 60 : 75);
  
  const setDuration = isCompound ? 50 : 35; // seconds per working set
  
  // Working sets time: (set duration + rest) * sets, minus rest after last set
  const workingTime = (setDuration + restSeconds) * setsCount - restSeconds;
  
  // Warmup time: typically 3 sets taking about 3-4 minutes total
  const warmupTime = includeWarmup && isCompound ? 4 * 60 : 0;
  
  // Transition time between exercises
  const transitionTime = 60; // 1 minute
  
  return (workingTime + warmupTime + transitionTime) / 60;
}

/**
 * Calculate how many exercises fit in a given time budget
 */
function getMaxExercisesForTime(
  sessionMinutes: number,
  goal: Goal
): { compounds: number; isolations: number; total: number } {
  // Average time per exercise type (with warmup for first compound per muscle)
  const compoundWithWarmup = estimateExerciseTime(true, goal, 3, true);
  const compoundNoWarmup = estimateExerciseTime(true, goal, 3, false);
  const isolation = estimateExerciseTime(false, goal, 3, false);
  
  // Average exercise time (accounting for mix - assume 1 warmup per 3 exercises)
  const avgCompoundTime = (compoundWithWarmup + compoundNoWarmup * 2) / 3;
  const avgIsolationTime = isolation;
  
  // 50/50 compound/isolation split
  const avgExerciseTime = avgCompoundTime * 0.5 + avgIsolationTime * 0.5;
  
  const maxExercises = Math.floor(sessionMinutes / avgExerciseTime);
  
  // Split between compounds and isolations
  const compounds = Math.ceil(maxExercises * 0.5);
  const isolations = maxExercises - compounds;
  
  return {
    compounds: Math.max(1, compounds),
    isolations: Math.max(0, isolations),
    total: Math.max(1, maxExercises)
  };
}

// ============================================================
// EXERCISE SELECTION WITH FATIGUE AWARENESS
// ============================================================

/**
 * Hypertrophy tier ranking for sorting (S = best = 0, F = worst = 5)
 */
const HYPERTROPHY_TIER_RANK: Record<string, number> = {
  'S': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'F': 5
};

/**
 * Select exercises for a muscle group considering equipment, experience, injury, SFR,
 * and hypertrophy effectiveness (Nippard methodology)
 * 
 * @param quickWorkoutMode - When true, only S and A tier exercises are selected (for time-constrained workouts)
 * @param unavailableEquipmentIds - Equipment IDs the user doesn't have access to (from gym equipment settings)
 */
function selectExercisesWithFatigue(
  muscle: MuscleGroup,
  setsNeeded: number,
  profile: ExtendedUserProfile,
  fatigueManager: SessionFatigueManager,
  startingPosition: number,
  prioritizeHypertrophy: boolean = true,
  quickWorkoutMode: boolean = false,
  unavailableEquipmentIds: string[] = []
): { exercise: ExerciseEntry; sets: number }[] {
  // Get exercises from unified service (DB-backed with fallback)
  const allExercises = getExercisesSync();
  
  // Filter available exercises
  let candidates = allExercises.filter(
    (e) =>
      e.primaryMuscle === muscle &&
      profile.availableEquipment.includes(e.equipment) &&
      !profile.injuryHistory.includes(muscle)
  );
  
  // Filter by gym equipment preferences (machine-level filtering)
  if (unavailableEquipmentIds.length > 0) {
    candidates = filterExercisesByEquipment(candidates, unavailableEquipmentIds);
  }

  // QUICK WORKOUT MODE: Only S and A tier exercises (maximum efficiency)
  if (quickWorkoutMode) {
    const topTierCandidates = candidates.filter((e) => 
      ['S', 'A'].includes(e.hypertrophyScore?.tier || '')
    );
    // Use top tier if available, otherwise fall back to all
    if (topTierCandidates.length > 0) {
      candidates = topTierCandidates;
    }
  }

  // Filter by difficulty - but always allow S-tier and A-tier exercises regardless of difficulty
  // (these are the best exercises and should be available to everyone with proper coaching)
  if (profile.experience === 'novice') {
    candidates = candidates.filter((e) => 
      e.difficulty === 'beginner' || 
      (prioritizeHypertrophy && ['S', 'A'].includes(e.hypertrophyScore?.tier || ''))
    );
  } else if (profile.experience === 'intermediate') {
    candidates = candidates.filter((e) => 
      e.difficulty !== 'advanced' ||
      (prioritizeHypertrophy && ['S', 'A'].includes(e.hypertrophyScore?.tier || ''))
    );
  }

  if (candidates.length === 0) {
    candidates = allExercises.filter(
      (e) => e.primaryMuscle === muscle && profile.availableEquipment.includes(e.equipment)
    );
  }

  if (candidates.length === 0) {
    candidates = allExercises.filter((e) => e.primaryMuscle === muscle);
  }

  // Sort by: 1) Hypertrophy tier (S > A > B > C > D > F), 2) Compound/isolation, 3) SFR
  candidates.sort((a, b) => {
    // ALWAYS sort by hypertrophy tier first - S-tier exercises should come first
    const aTier = HYPERTROPHY_TIER_RANK[a.hypertrophyScore?.tier || 'C'] ?? 3;
    const bTier = HYPERTROPHY_TIER_RANK[b.hypertrophyScore?.tier || 'C'] ?? 3;
    if (aTier !== bTier) return aTier - bTier;
    
    // Second: Compounds first for early positions (when fresher)
    if (startingPosition <= 2) {
      const aCompound = a.pattern !== 'isolation' ? 0 : 1;
      const bCompound = b.pattern !== 'isolation' ? 0 : 1;
      if (aCompound !== bCompound) return aCompound - bCompound;
    }

    // Third: Higher SFR first (more stimulus per fatigue)
    const sfrA = BASE_SFR[a.pattern]?.[a.equipment] ?? 1.0;
    const sfrB = BASE_SFR[b.pattern]?.[b.equipment] ?? 1.0;
    return sfrB - sfrA;
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
  weeklyProgression: WeeklyProgression,
  quickWorkoutMode: boolean = false,
  unavailableEquipmentIds: string[] = [],
  sessionMinutes: number = 60
): DetailedSessionWithFatigue {
  const fatigueManager = new SessionFatigueManager(fatigueBudgetConfig);
  const exercises: DetailedExerciseWithFatigue[] = [];

  // Calculate exercise budget based on session time
  const exerciseBudget = getMaxExercisesForTime(sessionMinutes, profile.goal);
  let exercisesAdded = 0;
  let estimatedTimeUsed = 0;
  const warmedUpMuscles = new Set<string>();

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
    // Check if we've hit the exercise limit for this session time
    if (exercisesAdded >= exerciseBudget.total) {
      break;
    }
    
    // Check if we've exceeded time budget (with 5 min buffer)
    if (estimatedTimeUsed >= sessionMinutes - 5) {
      break;
    }
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

    // Select exercises with fatigue awareness (prioritize S-tier in quick workout mode)
    const selectedExercises = selectExercisesWithFatigue(muscle, setsThisSession, profile, fatigueManager, exercisePosition, true, quickWorkoutMode, unavailableEquipmentIds);

    for (const selection of selectedExercises) {
      // Check if we've hit limits
      if (exercisesAdded >= exerciseBudget.total || estimatedTimeUsed >= sessionMinutes - 5) {
        break;
      }
      
      // Estimate time for this exercise
      const isCompound = selection.exercise.pattern !== 'isolation';
      const needsWarmup = isCompound && !warmedUpMuscles.has(muscle);
      const exerciseTimeEstimate = estimateExerciseTime(isCompound, profile.goal, selection.sets, needsWarmup);
      
      // Check if adding this exercise would exceed time budget
      if (estimatedTimeUsed + exerciseTimeEstimate > sessionMinutes + 5) {
        // Try with fewer sets
        const reducedSets = Math.max(2, selection.sets - 1);
        const reducedTimeEstimate = estimateExerciseTime(isCompound, profile.goal, reducedSets, needsWarmup);
        if (estimatedTimeUsed + reducedTimeEstimate > sessionMinutes + 5) {
          continue; // Skip this exercise entirely
        }
        selection.sets = reducedSets;
      }
      
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

      // Track time and exercise count (reuse isCompound and needsWarmup from above)
      estimatedTimeUsed += estimateExerciseTime(isCompound, profile.goal, selection.sets, needsWarmup);
      if (needsWarmup) {
        warmedUpMuscles.add(muscle);
      }
      exercisesAdded++;
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
  totalMesocycleWeeks: number,
  quickWorkoutMode: boolean = false,
  unavailableEquipmentIds: string[] = [],
  sessionMinutes: number = 60
): DetailedSessionWithFatigue {
  const fatigueManager = new SessionFatigueManager(fatigueBudgetConfig);
  const exercises: DetailedExerciseWithFatigue[] = [];

  // Calculate exercise budget based on session time
  const exerciseBudget = getMaxExercisesForTime(sessionMinutes, profile.goal);
  let exercisesAdded = 0;
  let estimatedTimeUsed = 0;
  const warmedUpMuscles = new Set<string>();

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
    // Check if we've hit the exercise limit for this session time
    if (exercisesAdded >= exerciseBudget.total) {
      break;
    }
    
    // Check if we've exceeded time budget (with 5 min buffer)
    if (estimatedTimeUsed >= sessionMinutes - 5) {
      break;
    }
    const recoveryStatus = weeklyTracker.canTrainMuscle(muscle, currentDay, 0);
    if (!recoveryStatus.ready && recoveryStatus.currentFatigue > 50) continue;

    const muscleVolume = volumePerMuscle[muscle];
    if (!muscleVolume) continue;

    let setsThisSession = Math.ceil(muscleVolume.sets / muscleVolume.frequency);
    setsThisSession = Math.round(setsThisSession * volumeModifiers[dupDayType]);
    setsThisSession = Math.max(1, setsThisSession);

    const selectedExercises = selectExercisesWithFatigue(muscle, setsThisSession, profile, fatigueManager, exercisePosition, true, quickWorkoutMode, unavailableEquipmentIds);

    for (const selection of selectedExercises) {
      // Check if we've hit limits
      if (exercisesAdded >= exerciseBudget.total || estimatedTimeUsed >= sessionMinutes - 5) {
        break;
      }
      
      const isCompound = selection.exercise.pattern !== 'isolation';
      
      // Estimate time for this exercise
      const needsWarmup = isCompound && !warmedUpMuscles.has(muscle);
      const exerciseTimeEstimate = estimateExerciseTime(isCompound, profile.goal, selection.sets, needsWarmup);
      
      // Check if adding this exercise would exceed time budget
      if (estimatedTimeUsed + exerciseTimeEstimate > sessionMinutes + 5) {
        continue; // Skip this exercise
      }

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

      // Track time and exercise count
      const needsWarmupTrack = isCompound && !warmedUpMuscles.has(muscle);
      estimatedTimeUsed += estimateExerciseTime(isCompound, profile.goal, selection.sets, needsWarmupTrack);
      if (needsWarmupTrack) {
        warmedUpMuscles.add(muscle);
      }
      exercisesAdded++;
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
      adductors: Math.min(daysPerWeek, 2),
      forearms: Math.min(daysPerWeek, 2),
      traps: Math.min(daysPerWeek, 2),
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
      adductors: 2,
      forearms: 2,
      traps: 2,
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
      adductors: daysPerWeek >= 6 ? 2 : 1,
      forearms: daysPerWeek >= 6 ? 2 : 1,
      traps: daysPerWeek >= 6 ? 2 : 1,
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
      adductors: 2,
      forearms: 2,
      traps: 2,
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
      adductors: 1,
      forearms: 1,
      traps: 1,
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
  laggingAreas?: string[],
  unavailableEquipmentIds: string[] = []
): FullProgramRecommendation {
  const warnings: string[] = [];
  const programNotes: string[] = [];

  // Determine workout mode based on session duration
  const quickWorkoutMode = sessionMinutes <= 25;
  const shortWorkoutMode = sessionMinutes > 25 && sessionMinutes <= 45;
  
  // Calculate time-based volume modifier
  // Standard workout = 60 min, scale volume proportionally
  const timeVolumeModifier = Math.min(1.0, sessionMinutes / 60);
  
  if (quickWorkoutMode) {
    programNotes.push(`⚡ Quick Workout Mode (${sessionMinutes}min): Only S-tier and A-tier exercises, reduced volume`);
  } else if (shortWorkoutMode) {
    programNotes.push(`⏱️ Time-Efficient Mode (${sessionMinutes}min): Volume scaled to ${Math.round(timeVolumeModifier * 100)}%`);
  }

  // Step 1: Calculate recovery factors
  const recoveryFactors = calculateRecoveryFactors(profile);
  warnings.push(...recoveryFactors.warnings);

  // Step 2: Create fatigue budget (reduced for shorter workouts)
  const baseFatigueBudget = createFatigueBudget(profile);
  const fatigueBudgetConfig = quickWorkoutMode 
    ? { ...baseFatigueBudget, systemicLimit: baseFatigueBudget.systemicLimit * 0.5 }
    : shortWorkoutMode
    ? { ...baseFatigueBudget, systemicLimit: baseFatigueBudget.systemicLimit * timeVolumeModifier }
    : baseFatigueBudget;
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
  const baseVolumePerMuscle = calculateVolumeDistributionWithLagging(split, daysPerWeek, profile.experience, profile.goal, recoveryFactors, laggingAreas);
  
  // Scale volume based on available time (40min = ~67% volume of 60min)
  const volumePerMuscle = Object.fromEntries(
    Object.entries(baseVolumePerMuscle).map(([muscle, vol]) => [
      muscle,
      {
        sets: Math.max(2, Math.round(vol.sets * timeVolumeModifier)), // Minimum 2 sets per muscle
        frequency: vol.frequency,
      },
    ])
  ) as Record<MuscleGroup, { sets: number; frequency: number }>;
  
  // Add note if lagging areas are being addressed
  if (laggingAreas && laggingAreas.length > 0) {
    programNotes.push(`🎯 Extra volume allocated for: ${laggingAreas.join(', ')}`);
  }
  
  if (timeVolumeModifier < 1.0) {
    programNotes.push(`📉 Volume reduced to ${Math.round(timeVolumeModifier * 100)}% to fit ${sessionMinutes}min sessions`);
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
          periodization.mesocycleWeeks,
          quickWorkoutMode,
          unavailableEquipmentIds,
          sessionMinutes
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
          weekProgression,
          quickWorkoutMode,
          unavailableEquipmentIds,
          sessionMinutes
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

