/**
 * Session Builder with Fatigue Integration
 * Builds detailed workout sessions using the rep range engine, fatigue budget system,
 * and weekly recovery tracking.
 */

import type {
  Goal,
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
import { muscleMatchesGroup, toLegacyMuscleGroup } from '@/types/schema';

import { filterExercisesByEquipment } from './equipmentFilter';
import type { ExerciseVarietyPreferences } from '@/types/user-exercise-preferences';

import {
  calculateRepRange,
  durationRepRangeConfig,
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
  BASE_SFR,
} from './fatigueBudgetEngine';
import {
  PlannedWeekRecovery,
  plannedSetScale,
  PLANNED_SKIP_READINESS,
  PLANNED_TRIM_READINESS,
} from './plannedRecovery';
import { requiredStabilizersFor } from './muscleRecovery';
import { resolveMuscleToStandard, type StandardMuscleGroup } from '@/types/schema';

import { calculateRecoveryFactors, buildPeriodizationPlan, calculateVolumeDistribution as calculateVolumeDistributionWithLagging, generateWarmup, isMuscleExcludedByInjury, applyIndirectAwareAllocation } from './mesocycleBuilder';
import { getEffectiveBand, type CoarseMuscle } from './volumeBands';
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
  const isAbExercise = toLegacyMuscleGroup(exercise.primaryMuscle) === 'abs';

  // Ab exercises need shorter rest periods (recover faster)
  if (isAbExercise) {
    return goal === 'cut' ? 30 : 45;
  }

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
 * hypertrophy effectiveness (Nippard methodology), and exercise variety preferences.
 *
 * @param quickWorkoutMode - When true, only S and A tier exercises are selected (for time-constrained workouts)
 * @param unavailableEquipmentIds - Equipment IDs the user doesn't have access to (from gym equipment settings)
 * @param varietyPrefs - Optional variety preferences to apply exercise rotation
 * @param recentlyUsedExerciseIds - Set of exercise IDs recently used (for variety filtering)
 * @param fatiguedStabilizers - Stabilizer-tracked muscles whose stabilizer
 *   channel is under-recovered on this planned day (PlannedWeekRecovery).
 *   Candidates REQUIRING one are deprioritized within their hypertrophy tier
 *   (never below a worse tier) — the planning-side counterpart of the live
 *   pre-set stabilizer warning.
 * @param standardReadiness - Per-standard-muscle readiness behind the coarse
 *   gate (PlannedMuscleReadiness.byStandard). The coarse mean deliberately
 *   lets one fatigued head through so it can't veto the whole group — but
 *   the head's own detail must then gate INDIVIDUAL candidates: a candidate
 *   whose PRIMARY standard sits below the skip line is dropped (unless that
 *   would empty the pool — the existing fallback-ladder convention), and one
 *   inside the trim band is deprioritized within its tier.
 */
function selectExercisesWithFatigue(
  muscle: MuscleGroup,
  setsNeeded: number,
  profile: ExtendedUserProfile,
  fatigueManager: SessionFatigueManager,
  startingPosition: number,
  prioritizeHypertrophy: boolean = true,
  quickWorkoutMode: boolean = false,
  unavailableEquipmentIds: string[] = [],
  varietyPrefs?: ExerciseVarietyPreferences | null,
  recentlyUsedExerciseIds?: Set<string>,
  fatiguedStabilizers?: ReadonlySet<StandardMuscleGroup>,
  standardReadiness?: Partial<Record<StandardMuscleGroup, number>>
): { exercise: ExerciseEntry; sets: number }[] {
  // Get exercises from unified service (DB-backed with fallback)
  const allExercises = getExercisesSync();

  // Filter available exercises (overlap-aware so precisely-tagged exercises
  // like 'lateral_delts' still match a legacy 'shoulders' target)
  let candidates = allExercises.filter(
    (e) =>
      muscleMatchesGroup(e.primaryMuscle, muscle) &&
      profile.availableEquipment.includes(e.equipment) &&
      !isMuscleExcludedByInjury(muscle, profile.injuryHistory)
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
      (e) => muscleMatchesGroup(e.primaryMuscle, muscle) && profile.availableEquipment.includes(e.equipment)
    );
  }

  if (candidates.length === 0) {
    candidates = allExercises.filter((e) => muscleMatchesGroup(e.primaryMuscle, muscle));
  }

  // Readiness of a candidate's own PRIMARY muscle (worst resolved standard).
  // Secondary movers are deliberately not gated here: their 0.5-weighted dose
  // already shaped the coarse gate, and every press carries a front-delt
  // secondary — gating on them would block whole sessions.
  const primaryReadiness = (e: ExerciseEntry): number => {
    if (!standardReadiness) return 1;
    const ratios = resolveMuscleToStandard(e.primaryMuscle)
      .map((standard) => standardReadiness[standard])
      .filter((v): v is number => typeof v === 'number');
    return ratios.length > 0 ? Math.min(...ratios) : 1;
  };

  // Drop candidates whose primary standard is below the SKIP line — the
  // fatigued head the coarse mean let through must not be trained at full
  // volume through the side door. Fallback-ladder convention: if that empties
  // the pool (every candidate hits the fatigued head), keep the originals —
  // the coarse gate has already trimmed the session's set count.
  const restedCandidates = candidates.filter(
    (e) => primaryReadiness(e) >= PLANNED_SKIP_READINESS
  );
  if (restedCandidates.length > 0) {
    candidates = restedCandidates;
  }

  // True when a candidate REQUIRES a stabilizer that is under-recovered on
  // this planned day (its `stabilizers` tags, never secondary mover tags —
  // same predicate as the live warning).
  const demandsFatiguedStabilizer = (e: ExerciseEntry): boolean => {
    if (!fatiguedStabilizers || fatiguedStabilizers.size === 0) return false;
    const required = requiredStabilizersFor({
      stabilizers: (e as { stabilizers?: string[] }).stabilizers,
    });
    return required.some((m) => fatiguedStabilizers.has(m));
  };

  // Sort by: 1) Hypertrophy tier (S > A > B > C > D > F), 2) stabilizer
  // availability within the tier, 3) Compound/isolation, 4) SFR
  candidates.sort((a, b) => {
    // ALWAYS sort by hypertrophy tier first - S-tier exercises should come first
    const aTier = HYPERTROPHY_TIER_RANK[a.hypertrophyScore?.tier || 'C'] ?? 3;
    const bTier = HYPERTROPHY_TIER_RANK[b.hypertrophyScore?.tier || 'C'] ?? 3;
    if (aTier !== bTier) return aTier - bTier;

    // Within a tier, prefer candidates whose own primary head is outside the
    // trim band (fresh lateral/rear work over front-delt pressing the day
    // after a heavy press session). AFTER the tier key on purpose: fatigue
    // buys a same-tier substitution, never a worse exercise.
    const aPrimaryTired = primaryReadiness(a) < PLANNED_TRIM_READINESS ? 1 : 0;
    const bPrimaryTired = primaryReadiness(b) < PLANNED_TRIM_READINESS ? 1 : 0;
    if (aPrimaryTired !== bPrimaryTired) return aPrimaryTired - bPrimaryTired;

    // Then prefer candidates that don't lean on a run-down stabilizer
    // (chest-supported row over barbell row the day after heavy hinges).
    const aStab = demandsFatiguedStabilizer(a) ? 1 : 0;
    const bStab = demandsFatiguedStabilizer(b) ? 1 : 0;
    if (aStab !== bStab) return aStab - bStab;

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

  // Apply variety filtering if preferences are provided
  if (varietyPrefs && recentlyUsedExerciseIds && recentlyUsedExerciseIds.size > 0) {
    // Only apply variety if not on 'low' with no rotation
    if (!(varietyPrefs.varietyLevel === 'low' && varietyPrefs.rotationFrequency === 0)) {
      // Separate recently used from not recently used
      const notRecentlyUsed = candidates.filter((e) => !recentlyUsedExerciseIds.has(e.id));
      const recentlyUsed = candidates.filter((e) => recentlyUsedExerciseIds.has(e.id));

      // If prioritizing top tier within variety, ensure S/A tier exercises still come first
      // but within each tier group, prefer non-recently-used
      if (varietyPrefs.prioritizeTopTier) {
        const topTierNotRecent = notRecentlyUsed.filter(
          (e) => ['S', 'A'].includes(e.hypertrophyScore?.tier || '')
        );
        const topTierRecent = recentlyUsed.filter(
          (e) => ['S', 'A'].includes(e.hypertrophyScore?.tier || '')
        );
        const otherTierNotRecent = notRecentlyUsed.filter(
          (e) => !['S', 'A'].includes(e.hypertrophyScore?.tier || '')
        );
        const otherTierRecent = recentlyUsed.filter(
          (e) => !['S', 'A'].includes(e.hypertrophyScore?.tier || '')
        );

        // Order: Top tier non-recent -> Top tier recent -> Other non-recent -> Other recent
        candidates = [
          ...topTierNotRecent,
          ...topTierRecent,
          ...otherTierNotRecent,
          ...otherTierRecent,
        ];
      } else {
        // Simple variety: non-recently-used first
        candidates = [...notRecentlyUsed, ...recentlyUsed];
      }
    }
  }

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

  // Second pass: distribute any leftover sets onto already-selected exercises
  // that are still under their per-exercise cap (3 isolation / 4 compound),
  // instead of silently dropping them and under-delivering target volume.
  while (remainingSets > 0 && selected.length > 0) {
    let addedThisPass = false;
    for (let i = 0; i < selected.length && remainingSets > 0; i++) {
      const maxSetsForExercise = selected[i].exercise.pattern === 'isolation' ? 3 : 4;
      if (selected[i].sets >= maxSetsForExercise) continue;
      selected[i].sets++;
      remainingSets--;
      addedThisPass = true;
    }
    // If every selected exercise is at its cap, accept the shortfall rather
    // than looping forever (no more room without exceeding per-exercise caps).
    if (!addedThisPass) break;
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
  const loadGuidance = buildLoadGuidance(
    reps,
    weeklyProgression.focus,
    (exercise as { exerciseType?: string }).exerciseType === 'duration_based'
  );

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
  weeklyRecovery: PlannedWeekRecovery,
  currentDay: number,
  weekInMesocycle: number,
  totalMesocycleWeeks: number,
  periodizationModel: PeriodizationModel,
  weeklyProgression: WeeklyProgression,
  quickWorkoutMode: boolean = false,
  unavailableEquipmentIds: string[] = [],
  sessionMinutes: number = 60,
  varietyPrefs?: ExerciseVarietyPreferences | null,
  recentlyUsedByMuscle?: Map<string, Set<string>>
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

  // Stabilizer state for this planned day (from the shared recovery model) —
  // exercise selection deprioritizes candidates requiring a run-down one.
  const fatiguedStabilizers = weeklyRecovery.fatiguedStabilizers(currentDay);

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
    // Readiness on this planned day, from the SAME recovery model the
    // readiness sheet runs (via PlannedWeekRecovery's virtual history).
    const readiness = weeklyRecovery.readiness(muscle, currentDay);

    if (readiness.readinessRatio < PLANNED_SKIP_READINESS) {
      // Skip this muscle entirely if severely under-recovered
      continue;
    }

    const muscleVolume = volumePerMuscle[muscle];
    if (!muscleVolume) continue;

    let setsThisSession = Math.ceil(muscleVolume.sets / muscleVolume.frequency);

    // Apply weekly volume modifier
    setsThisSession = Math.round(setsThisSession * weeklyProgression.volumeModifier);
    setsThisSession = Math.max(1, setsThisSession);

    // Trim volume while the muscle is still inside its recovery window
    const recoveryScale = plannedSetScale(readiness.readinessRatio);
    if (recoveryScale < 1) {
      setsThisSession = Math.max(1, Math.round(setsThisSession * recoveryScale));
    }

    // Select exercises with fatigue awareness (prioritize S-tier in quick workout mode)
    // Also apply variety preferences if provided
    const recentlyUsedIds = recentlyUsedByMuscle?.get(muscle.toLowerCase());
    const selectedExercises = selectExercisesWithFatigue(
      muscle,
      setsThisSession,
      profile,
      fatigueManager,
      exercisePosition,
      true,
      quickWorkoutMode,
      unavailableEquipmentIds,
      varietyPrefs,
      recentlyUsedIds,
      fatiguedStabilizers,
      readiness.byStandard
    );

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

      // Calculate rep range. Duration exercises bypass calculateRepRange —
      // its rep-count bounds check would clamp a seconds range — and keep
      // their own time range instead.
      const isDurationExercise =
        (selection.exercise as { exerciseType?: string }).exerciseType === 'duration_based';
      const repConfig = isDurationExercise
        ? durationRepRangeConfig(selection.exercise)
        : calculateRepRange({
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

      // Record the planned exercise into the week's virtual history so later
      // planned days see its recovery debt (the shared model reads primary +
      // secondary + stabilizer tags itself — no local cost math here).
      weeklyRecovery.record(currentDay, {
        primaryMuscle: selection.exercise.primaryMuscle,
        secondaryMuscles: selection.exercise.secondaryMuscles ?? [],
        stabilizers: (selection.exercise as { stabilizers?: string[] }).stabilizers,
        sets: selection.sets,
        targetRir: adjustedRIR,
      });

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
  weeklyRecovery: PlannedWeekRecovery,
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

  // Stabilizer state for this planned day (shared recovery model).
  const fatiguedStabilizers = weeklyRecovery.fatiguedStabilizers(currentDay);

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
    // Skip only when severely under-recovered (parity with the old DUP gate,
    // which never trimmed sets — the DUP day-type modifier owns volume shape).
    const readiness = weeklyRecovery.readiness(muscle, currentDay);
    if (readiness.readinessRatio < PLANNED_SKIP_READINESS) continue;

    const muscleVolume = volumePerMuscle[muscle];
    if (!muscleVolume) continue;

    let setsThisSession = Math.ceil(muscleVolume.sets / muscleVolume.frequency);
    setsThisSession = Math.round(setsThisSession * volumeModifiers[dupDayType]);
    setsThisSession = Math.max(1, setsThisSession);

    const selectedExercises = selectExercisesWithFatigue(
      muscle,
      setsThisSession,
      profile,
      fatigueManager,
      exercisePosition,
      true,
      quickWorkoutMode,
      unavailableEquipmentIds,
      undefined,
      undefined,
      fatiguedStabilizers,
      readiness.byStandard
    );

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

      // Get DUP-specific rep range. Duration exercises keep their own time
      // range — DUP's heavy/moderate/light rep schemes have no seconds analogue.
      const dupIsDuration =
        (selection.exercise as { exerciseType?: string }).exerciseType === 'duration_based';
      const dupRepRange = getDUPRepRange(dupDayType, isCompound, muscle);
      const targetRIR = getDUPTargetRIR(dupDayType);

      const repConfig: RepRangeConfig = dupIsDuration
        ? durationRepRangeConfig(selection.exercise)
        : {
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
        loadGuidance: dupIsDuration
          ? `${repConfig.min}-${repConfig.max}s hold @ ${repConfig.targetRIR} RIR`
          : `${repConfig.min}-${repConfig.max} reps @ ${repConfig.targetRIR} RIR`,
        notes: repConfig.notes,
        fatigueProfile: {
          systemicCost: exerciseFatigue.systemicCost,
          localCost: localCostRecord,
          sfr: exerciseFatigue.stimulusPerFatigue,
          efficiency: canAdd.efficiency,
        },
      });

      // Record into the week's virtual history so later planned days see
      // this session's recovery debt (shared model, no local cost math).
      weeklyRecovery.record(currentDay, {
        primaryMuscle: selection.exercise.primaryMuscle,
        secondaryMuscles: selection.exercise.secondaryMuscles ?? [],
        stabilizers: (selection.exercise as { stabilizers?: string[] }).stabilizers,
        sets: selection.sets,
        targetRir: repConfig.targetRIR,
      });

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

  // Adjust number of templates based on days per week. 6-day PPL doubles the
  // rotation ('Push 1' ... 'Legs 2'); above 6 sessions/week (daily training or
  // two-a-day, up to 14) every split repeats its rotation the same way so the
  // planned week really contains daysPerWeek sessions.
  if ((split === 'PPL' && daysPerWeek >= 6) || daysPerWeek > 6) {
    const rounds = Math.max(2, Math.ceil(daysPerWeek / baseTemplates.length));
    const repeated: SessionTemplate[] = [];
    for (let round = 1; round <= rounds; round++) {
      repeated.push(...baseTemplates.map((t) => ({ ...t, day: `${t.day} ${round}` })));
    }
    return repeated.slice(0, daysPerWeek);
  }

  return baseTemplates.slice(0, daysPerWeek);
}

/**
 * Generate a complete mesocycle with fatigue-integrated sessions
 */
export function generateFullMesocycleWithFatigue(
  daysPerWeek: number,
  profile: ExtendedUserProfile,
  sessionMinutes: number = 60,
  laggingAreas?: string[],
  unavailableEquipmentIds: string[] = [],
  /**
   * Sessions on each training day (1 or 2). `daysPerWeek` always counts
   * SESSIONS per week, so a 7-day two-a-day plan passes daysPerWeek=14,
   * sessionsPerDay=2 — the split rotation advances every session while the
   * recovery model sees both sessions landing on the same calendar day.
   */
  sessionsPerDay: number = 1
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

  if (profile.enhancedAthleteMode) {
    programNotes.push(
      'Enhanced Athlete Mode: recoverable-volume ceiling raised 15-35% by muscle ' +
      '(more for smaller muscles, less for axial ones), optimal-zone top up 10%, minimums unchanged; ' +
      'accumulation extended by 1 week. Joint-stress limits unchanged to protect connective tissue.'
    );
  }

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
  const baseVolumePerMuscle = calculateVolumeDistributionWithLagging(
    split,
    daysPerWeek,
    profile.experience,
    profile.goal,
    recoveryFactors,
    laggingAreas,
    undefined,
    profile.enhancedAthleteMode
  );
  
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
    7: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  };
  const safeSessionsPerDay = Math.max(1, Math.min(2, Math.round(sessionsPerDay)));
  // daysPerWeek counts sessions; the pattern lookup wants calendar days.
  const calendarDays = Math.max(1, Math.min(7, Math.ceil(daysPerWeek / safeSessionsPerDay)));
  const dayPattern = schedulePatterns[calendarDays] || schedulePatterns[4];
  // One schedule entry per SESSION: two-a-day repeats each calendar day.
  const schedule = dayPattern.flatMap((dayName) =>
    safeSessionsPerDay === 2 ? [`${dayName} AM`, `${dayName} PM`] : [dayName]
  ).slice(0, daysPerWeek);

  // Day OFFSETS within the planned week, from the actual schedule pattern.
  // The old tracker numbered sessions consecutively (0,1,2,…) regardless of
  // rest days, so a Mon/Wed/Fri plan recovered as if it were Mon/Tue/Wed;
  // the recovery model gets the real gaps. Two-a-day sessions share their
  // calendar day's offset, so the model sees a 0-day gap between them.
  const DAY_NAME_OFFSET: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  const scheduleDayOffsets = schedule.map(
    (dayName, index) => DAY_NAME_OFFSET[dayName.split(' ')[0]] ?? index
  );

  // PLANNED weekly frequency per standard muscle — the dose-normalization
  // denominator the live readiness model uses (sessionCapacityFor).
  const plannedFrequencyByMuscle: Partial<Record<StandardMuscleGroup, number>> = {};
  for (const [muscle, vol] of Object.entries(volumePerMuscle)) {
    for (const standard of resolveMuscleToStandard(muscle)) {
      plannedFrequencyByMuscle[standard] = Math.max(
        plannedFrequencyByMuscle[standard] ?? 0,
        vol.frequency
      );
    }
  }

  // Step 8: Build full mesocycle with week-by-week progression
  const bandContext = {
    recoveryProfile: profile.enhancedAthleteMode ? 'enhanced' : 'standard',
  } as const;
  const mesocycleWeeks: MesocycleWeek[] = [];

  for (let weekNum = 1; weekNum <= periodization.mesocycleWeeks; weekNum++) {
    const weekProgression = periodization.weeklyProgression[weekNum - 1];
    const isDeload = weekNum === periodization.mesocycleWeeks;

    // Fresh virtual recovery history each week (the shared model, adapted
    // for planning — see services/plannedRecovery).
    const weeklyRecovery = new PlannedWeekRecovery({
      enhancedAthleteMode: profile.enhancedAthleteMode,
      experience: profile.experience,
      sleepQuality: profile.sleepQuality,
      plannedSessionsPerWeekByMuscle: plannedFrequencyByMuscle,
    });
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

      // Real day offset within the week (Mon/Wed/Fri = 0/2/4), so recovery
      // windows see actual rest days rather than consecutive numbering.
      const plannedDayOffset = scheduleDayOffsets[dayCounter] ?? dayCounter;

      if (periodization.model === 'daily_undulating' && !isDeload) {
        // DUP: rotate through hypertrophy/strength/power
        session = buildDUPSession(
          template,
          volumePerMuscle,
          profile,
          deloadBudget,
          weeklyRecovery,
          plannedDayOffset,
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
          weeklyRecovery,
          plannedDayOffset,
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

    // Indirect-aware allocation — the SAME trim pass generateFullProgram
    // runs (Codex review on 48c5cbe: this path never trimmed, so credited
    // shoulders reached 30.5 vs the 26 ceiling on 4-day, 53 on 6-day PPL).
    // Targets are total-inclusive: the built week's credited totals (primary
    // splits + secondary credit, the currency the tracking card counts in)
    // are trimmed down to the week-scaled targets, clamped at the effective
    // MRV so no accumulation week starts past the ceiling the card flags.
    const weekTargets = Object.fromEntries(
      Object.entries(volumePerMuscle).map(([muscle, vol]) => [
        muscle,
        {
          sets: Math.min(
            Math.round(vol.sets * weekProgression.volumeModifier),
            getEffectiveBand(muscle as CoarseMuscle, bandContext)?.mrv ?? Number.MAX_SAFE_INTEGER
          ),
        },
      ])
    );
    const trimNotes = applyIndirectAwareAllocation(weekSessions, weekTargets);
    if (weekNum === 1) programNotes.push(...trimNotes);
    for (const session of weekSessions) {
      session.totalSets = session.exercises.reduce((sum, ex) => sum + ex.sets, 0);
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

