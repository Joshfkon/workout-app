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

import { calculateRecoveryFactors, buildPeriodizationPlan, calculateVolumeDistribution as calculateVolumeDistributionWithLagging, generateWarmup, isMuscleExcludedByInjury, applyIndirectAwareAllocation, type VolumeAdjustmentInput } from './mesocycleBuilder';
import { getEffectiveBand, type CoarseMuscle } from './volumeBands';
import { perSetGroupCredits } from './shared/volumeCredit';
import { getExercisesSync, type Exercise as ServiceExercise } from './exerciseService';
import { estimatePlannedSessionMinutes } from './workoutDurationEstimator';

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

// ============================================================
// PER-SESSION SET ALLOCATION
// ============================================================

/**
 * Hard working sets one muscle gets in ONE session. Past ~10–12 the extra
 * sets are junk volume: the muscle needs another day, not a longer session.
 * (The local fatigue budget already stops a single head near 10.)
 */
export const MAX_SETS_PER_MUSCLE_PER_SESSION = 12;

/**
 * The effort (RIR) the per-session fatigue budget is checked at, every week
 * of the block. The budget is a ceiling on how much work one session holds;
 * checked at each week's own RIR it tightened as the block pushed RIR down
 * (local cost is sets x 8 x (1 + (3 - RIR) x 0.15)), so a once-a-week muscle
 * fit 11 sets in week 1 and 8 in week 4 and the plan's volume FELL while the
 * ramp said it climbed (UX panel, round 19). Lower RIR across the block is
 * the planned overreach the deload clears; it must not also shrink the
 * session. 3 RIR is where the intensity factor is 1.
 */
export const FATIGUE_GATE_RIR = 3;

/** Every recovered muscle a session plans gets at least this many sets. */
export const MIN_SETS_PER_PLANNED_MUSCLE = 2;

/** Minutes the session warm-up takes before the first working set. */
const SESSION_WARMUP_MINUTES = 4;

/**
 * Working sets a session of `sessionMinutes` holds, on the SAME time model
 * the build loop checks against (estimateExerciseTime): one warm-up block,
 * then an even mix of compound and isolation sets. Pure.
 */
export function sessionSetCapacity(sessionMinutes: number, goal: Goal): number {
  const perSet =
    (estimateExerciseTime(true, goal, 3, false) + estimateExerciseTime(false, goal, 3, false)) / 6;
  return Math.max(MIN_SETS_PER_PLANNED_MUSCLE, Math.floor((sessionMinutes - SESSION_WARMUP_MINUTES) / perSet));
}

/**
 * Share a session's set capacity between the muscles it plans. Requests that
 * fit are returned unchanged; otherwise every muscle keeps a floor
 * (MIN_SETS_PER_PLANNED_MUSCLE, or its whole request if smaller) and the rest
 * of the capacity is split in proportion to what each still wants (largest
 * remainder, ties to the earlier muscle). Pure.
 *
 * This replaces first-come-first-served filling, where the muscles a
 * template listed first consumed the whole session and the ones after them
 * (arms on an Upper day, calves and abs on a Lower day) got 0 sets.
 */
export function fairShareSessionSets(requests: number[], capacity: number): number[] {
  const want = requests.map((r) => Math.max(0, Math.round(r)));
  const total = want.reduce((s, r) => s + r, 0);
  if (total <= capacity) return want;
  const floors = want.map((r) => Math.min(r, MIN_SETS_PER_PLANNED_MUSCLE));
  const room = capacity - floors.reduce((s, f) => s + f, 0);
  if (room <= 0) return floors;
  const extra = want.map((r, i) => r - floors[i]);
  const extraTotal = extra.reduce((s, e) => s + e, 0);
  const raw = extra.map((e) => (e * room) / extraTotal);
  const out = raw.map((x, i) => floors[i] + Math.floor(x));
  let left = room - raw.reduce((s, x) => s + Math.floor(x), 0);
  const byRemainder = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    if (out[i] >= want[i]) continue;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

type PlannedReadiness = ReturnType<PlannedWeekRecovery['readiness']>;

/**
 * The fatigue budget's verdict, except that a planned muscle's FIRST
 * exercise in a session is not refused on stimulus-to-fatigue alone. The SFR
 * check discounts every exercise by its position (−10% a slot), so the
 * muscles a template lists last (triceps on an Upper day) were refused
 * outright at slot 7+ for a novice (threshold 0.8) and got 0 sets all week.
 * The systemic and local limits still apply; the set is marked suboptimal.
 */
function admitExercise(
  manager: SessionFatigueManager,
  fatigue: ReturnType<typeof calculateExerciseFatigue>,
  firstForMuscle: boolean
): ReturnType<SessionFatigueManager['canAddExercise']> {
  const verdict = manager.canAddExercise(fatigue);
  if (verdict.allowed || !firstForMuscle || !verdict.reason?.startsWith('SFR')) return verdict;
  return { allowed: true, efficiency: 'suboptimal' };
}

/** Heads the lifter prioritized ('up') or de-prioritized ('down'). */
export type HeadEmphasis = ReadonlyMap<StandardMuscleGroup, 'up' | 'down'>;

/** Head-level priorities from the generator's volume adjustments. Pure. */
export function headEmphasisFrom(adjustments: readonly VolumeAdjustmentInput[] | undefined): HeadEmphasis {
  const out = new Map<StandardMuscleGroup, 'up' | 'down'>();
  for (const a of adjustments ?? []) {
    if (!a.head || a.volumeMultiplier === 1) continue;
    out.set(a.head, a.volumeMultiplier > 1 ? 'up' : 'down');
  }
  return out;
}

/** Big muscles (compound-led) first, then isolations. */
const SESSION_MUSCLE_ORDER: MuscleGroup[] = [
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

function orderSessionMuscles(targetMuscles: MuscleGroup[]): MuscleGroup[] {
  const rank = (m: MuscleGroup) => {
    const i = SESSION_MUSCLE_ORDER.indexOf(m);
    return i === -1 ? SESSION_MUSCLE_ORDER.length : i;
  };
  return [...targetMuscles].sort((a, b) => rank(a) - rank(b));
}

/**
 * Drop sets from a selected exercise until it fits `minutesLeft`; false when
 * not even one set fits. Mutates `selection.sets`.
 */
function fitSelectionToTime(
  selection: { sets: number },
  isCompound: boolean,
  needsWarmup: boolean,
  goal: Goal,
  minutesLeft: number
): boolean {
  while (selection.sets > 1 && estimateExerciseTime(isCompound, goal, selection.sets, needsWarmup) > minutesLeft) {
    selection.sets -= 1;
  }
  return estimateExerciseTime(isCompound, goal, selection.sets, needsWarmup) <= minutesLeft;
}

/**
 * Minutes to hold back for the muscles still to come, so the time check on
 * an early muscle cannot spend the floor a later one is owed. Pure.
 */
function reserveMinutesAfter(allotted: number[], index: number, goal: Goal): number {
  let minutes = 0;
  for (let j = index + 1; j < allotted.length; j++) {
    const floor = Math.min(allotted[j], MIN_SETS_PER_PLANNED_MUSCLE);
    if (floor > 0) minutes += estimateExerciseTime(false, goal, floor, false);
  }
  return minutes;
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
  standardReadiness?: Partial<Record<StandardMuscleGroup, number>>,
  headEmphasis?: HeadEmphasis
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
  // A head the lifter prioritized (Settings → Muscle priorities, e.g. side
  // delts) leads its group's exercise choice; a de-prioritized one trails.
  const emphasisRank = (e: ExerciseEntry): number => {
    if (!headEmphasis || headEmphasis.size === 0) return 1;
    const heads = resolveMuscleToStandard(e.primaryMuscle);
    if (heads.some((h) => headEmphasis.get(h) === 'up')) return 0;
    if (heads.some((h) => headEmphasis.get(h) === 'down')) return 2;
    return 1;
  };

  candidates.sort((a, b) => {
    const aEmph = emphasisRank(a);
    const bEmph = emphasisRank(b);
    if (aEmph !== bEmph) return aEmph - bEmph;

    // Then sort by hypertrophy tier - S-tier exercises should come first
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
      FATIGUE_GATE_RIR, // the budget's effort, same as the build loop's check
      startingPosition + selected.length
    );

    const canAdd = admitExercise(fatigueManager, testFatigue, selected.length === 0);
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
      // Leftovers may take an isolation to a 4th set (a 4-set leg curl is
      // ordinary) rather than leave the muscle short when no further
      // candidate passed the fatigue/SFR gate.
      const maxSetsForExercise = 4;
      if (selected[i].sets >= maxSetsForExercise) continue;
      selected[i].sets++;
      remainingSets--;
      addedThisPass = true;
    }
    // If every selected exercise is at its cap, accept the shortfall rather
    // than looping forever (no more room without exceeding per-exercise caps).
    if (!addedThisPass) break;
  }

  // Even the split out: 4 + 1 reads as a token set on the second exercise;
  // 3 + 2 is the same volume.
  for (;;) {
    const low = selected.findIndex((s) => s.sets === 1);
    if (low === -1) break;
    let donor = -1;
    selected.forEach((s, i) => {
      if (s.sets >= 3 && (donor === -1 || s.sets > selected[donor].sets)) donor = i;
    });
    if (donor === -1) break;
    selected[donor].sets -= 1;
    selected[low].sets += 1;
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
  recentlyUsedByMuscle?: Map<string, Set<string>>,
  /** Prioritized / de-prioritized heads (headEmphasisFrom). */
  headEmphasis?: HeadEmphasis,
  /** Share of the session's set capacity this week may use: the week's
   *  volume modifier over the block's peak modifier (1 = the full session). */
  capacityScale: number = 1
): DetailedSessionWithFatigue {
  const fatigueManager = new SessionFatigueManager(fatigueBudgetConfig);
  const exercises: DetailedExerciseWithFatigue[] = [];

  let estimatedTimeUsed = 0;
  const warmedUpMuscles = new Set<string>();

  const orderedMuscles = orderSessionMuscles(sessionTemplate.targetMuscles);

  // Stabilizer state for this planned day (from the shared recovery model) —
  // exercise selection deprioritizes candidates requiring a run-down one.
  const fatiguedStabilizers = weeklyRecovery.fatiguedStabilizers(currentDay);

  // Pass 1: what each planned muscle asks of THIS session: its weekly
  // target over the sessions that train it, scaled by the week's volume
  // modifier, trimmed while still inside its recovery window, and capped at
  // the per-session ceiling. Readiness reads only EARLIER days' planned work
  // (PlannedWeekRecovery.historyBefore), so reading it up front gives the
  // same answer the loop used to get muscle by muscle.
  const plans: { muscle: MuscleGroup; request: number; readiness: PlannedReadiness }[] = [];
  for (const muscle of orderedMuscles) {
    const readiness = weeklyRecovery.readiness(muscle, currentDay);
    // Skip this muscle entirely if severely under-recovered
    if (readiness.readinessRatio < PLANNED_SKIP_READINESS) continue;
    const muscleVolume = volumePerMuscle[muscle];
    if (!muscleVolume) continue;

    let setsThisSession = Math.ceil(muscleVolume.sets / Math.max(1, muscleVolume.frequency));
    // Apply weekly volume modifier
    setsThisSession = Math.max(1, Math.round(setsThisSession * weeklyProgression.volumeModifier));
    // Trim volume while the muscle is still inside its recovery window
    const recoveryScale = plannedSetScale(readiness.readinessRatio);
    if (recoveryScale < 1) {
      setsThisSession = Math.max(1, Math.round(setsThisSession * recoveryScale));
    }
    plans.push({ muscle, request: Math.min(MAX_SETS_PER_MUSCLE_PER_SESSION, setsThisSession), readiness });
  }

  // Pass 2: share the session's time between them, so a muscle listed last
  // still gets its share instead of whatever the first ones left. The
  // capacity scales with the week's place in the ramp (capacityScale), so a
  // time-bound plan still ramps: otherwise every week filled the same
  // session and the deload held as many sets as the peak.
  const allotted = fairShareSessionSets(
    plans.map((p) => p.request),
    Math.max(
      MIN_SETS_PER_PLANNED_MUSCLE,
      Math.round(sessionSetCapacity(sessionMinutes, profile.goal) * Math.min(1, Math.max(0, capacityScale)))
    )
  );

  let exercisePosition = 1;

  for (let planIndex = 0; planIndex < plans.length; planIndex++) {
    const { muscle, readiness } = plans[planIndex];
    const setsThisSession = allotted[planIndex];
    if (setsThisSession <= 0) continue;
    // Time held back for the muscles after this one.
    const reserve = reserveMinutesAfter(allotted, planIndex, profile.goal);

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
      readiness.byStandard,
      headEmphasis
    );

    let addedForMuscle = 0;
    for (const selection of selectedExercises) {
      // Estimate time for this exercise
      const isCompound = selection.exercise.pattern !== 'isolation';
      const needsWarmup = isCompound && !warmedUpMuscles.has(muscle);
      if (!fitSelectionToTime(selection, isCompound, needsWarmup, profile.goal, sessionMinutes + 5 - reserve - estimatedTimeUsed)) {
        continue; // Not even one set fits: skip this exercise
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

      // Apply weekly intensity modifier to RIR, then keep it inside the
      // week's own RPE window (RIR = 10 − RPE). Without the window a block's
      // deload (RPE 5–6) inherited the late-block rep-range RIR and was
      // prescribed at 1 RIR.
      let adjustedRIR = Math.max(
        0,
        Math.min(4, repConfig.targetRIR + Math.round((1 - weeklyProgression.intensityModifier) * 3))
      );
      if (weeklyProgression.rpeTarget) {
        const minRir = Math.max(0, 10 - weeklyProgression.rpeTarget.max);
        const maxRir = Math.min(4, 10 - weeklyProgression.rpeTarget.min);
        if (minRir <= maxRir) adjustedRIR = Math.min(maxRir, Math.max(minRir, adjustedRIR));
      }

      // Calculate fatigue for this exercise: the prescription's own (shown
      // on the exercise) and the budget's, which is checked at the block's
      // constant FATIGUE_GATE_RIR so the session ceiling is the same every
      // week (see FATIGUE_GATE_RIR).
      const avgReps = Math.round((repConfig.min + repConfig.max) / 2);
      const fatigueAt = (sets: number, rir: number) =>
        calculateExerciseFatigue(selection.exercise, sets, avgReps, rir, exercisePosition);
      const exerciseFatigue = fatigueAt(selection.sets, adjustedRIR);
      const gateFatigue = fatigueAt(selection.sets, FATIGUE_GATE_RIR);

      // Check if we can add this exercise
      const canAdd = admitExercise(fatigueManager, gateFatigue, addedForMuscle === 0);

      if (!canAdd.allowed) {
        // Try to reduce sets to fit
        const reducedSets = Math.max(1, selection.sets - 1);
        const reducedFatigue = fatigueAt(reducedSets, adjustedRIR);
        const reducedGate = fatigueAt(reducedSets, FATIGUE_GATE_RIR);

        const canAddReduced = admitExercise(fatigueManager, reducedGate, addedForMuscle === 0);
        if (!canAddReduced.allowed) {
          continue; // Skip this exercise entirely
        }

        selection.sets = reducedSets;
        fatigueManager.addExercise(reducedGate);

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
        fatigueManager.addExercise(gateFatigue);

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
      exercisePosition++;
      addedForMuscle++;
    }
  }

  // Get session fatigue summary
  const fatigueSummary = fatigueManager.getSessionSummary();

  // Same duration model as the live workout header and the workout builders
  // (services/workoutDurationEstimator), so this plan's promised length and
  // the session readout can't disagree.
  const totalSets = exercises.reduce((sum, e) => sum + e.sets, 0);
  const estimatedMinutes = estimatePlannedSessionMinutes(
    exercises.map((e) => ({
      sets: e.sets,
      restSeconds: e.restSeconds,
      mechanic: e.exercise.pattern === 'isolation' ? 'isolation' : 'compound',
      muscle: e.exercise.primaryMuscle,
    }))
  );

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
  sessionMinutes: number = 60,
  headEmphasis?: HeadEmphasis,
  /** The week's volume modifier (1 = the target). */
  weekVolumeModifier: number = 1,
  /** See buildDetailedSessionWithFatigue. */
  capacityScale: number = 1
): DetailedSessionWithFatigue {
  const fatigueManager = new SessionFatigueManager(fatigueBudgetConfig);
  const exercises: DetailedExerciseWithFatigue[] = [];

  let estimatedTimeUsed = 0;
  const warmedUpMuscles = new Set<string>();

  const orderedMuscles = orderSessionMuscles(sessionTemplate.targetMuscles);

  // Adjust volume based on DUP day type
  const volumeModifiers: Record<DUPDayType, number> = {
    hypertrophy: 1.1, // Higher volume
    strength: 0.85, // Moderate volume
    power: 0.7, // Lower volume, higher intensity
  };

  // Stabilizer state for this planned day (shared recovery model).
  const fatiguedStabilizers = weeklyRecovery.fatiguedStabilizers(currentDay);

  // Same two passes as the standard builder: per-muscle requests, then a
  // fair share of the session's time (see fairShareSessionSets).
  const plans: { muscle: MuscleGroup; request: number; readiness: PlannedReadiness }[] = [];
  for (const muscle of orderedMuscles) {
    // Skip only when severely under-recovered (parity with the old DUP gate,
    // which never trimmed sets — the DUP day-type modifier owns volume shape).
    const readiness = weeklyRecovery.readiness(muscle, currentDay);
    if (readiness.readinessRatio < PLANNED_SKIP_READINESS) continue;
    const muscleVolume = volumePerMuscle[muscle];
    if (!muscleVolume) continue;
    let setsThisSession = Math.ceil(muscleVolume.sets / Math.max(1, muscleVolume.frequency));
    // Day-type shape × the week's place in the block's ramp (the weekly
    // modifier only reached the trim targets before, so DUP weeks never
    // actually ramped).
    setsThisSession = Math.max(1, Math.round(setsThisSession * volumeModifiers[dupDayType] * weekVolumeModifier));
    plans.push({ muscle, request: Math.min(MAX_SETS_PER_MUSCLE_PER_SESSION, setsThisSession), readiness });
  }
  const allotted = fairShareSessionSets(
    plans.map((p) => p.request),
    Math.max(
      MIN_SETS_PER_PLANNED_MUSCLE,
      Math.round(sessionSetCapacity(sessionMinutes, profile.goal) * Math.min(1, Math.max(0, capacityScale)))
    )
  );

  let exercisePosition = 1;

  for (let planIndex = 0; planIndex < plans.length; planIndex++) {
    const { muscle, readiness } = plans[planIndex];
    const setsThisSession = allotted[planIndex];
    if (setsThisSession <= 0) continue;
    const reserve = reserveMinutesAfter(allotted, planIndex, profile.goal);

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
      readiness.byStandard,
      headEmphasis
    );

    let addedForMuscle = 0;
    for (const selection of selectedExercises) {
      const isCompound = selection.exercise.pattern !== 'isolation';

      // Fit into the time left after the later muscles' reserve.
      const needsWarmup = isCompound && !warmedUpMuscles.has(muscle);
      if (!fitSelectionToTime(selection, isCompound, needsWarmup, profile.goal, sessionMinutes + 5 - reserve - estimatedTimeUsed)) {
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
      // Over the fatigue budget at full sets: drop sets until it fits (a
      // heavy day's 2 sets beat skipping the movement), else skip it.
      let exerciseFatigue = calculateExerciseFatigue(
        selection.exercise,
        selection.sets,
        avgReps,
        repConfig.targetRIR,
        exercisePosition
      );
      let canAdd = admitExercise(fatigueManager, exerciseFatigue, addedForMuscle === 0);
      while (!canAdd.allowed && selection.sets > 1) {
        selection.sets -= 1;
        exerciseFatigue = calculateExerciseFatigue(
          selection.exercise,
          selection.sets,
          avgReps,
          repConfig.targetRIR,
          exercisePosition
        );
        canAdd = admitExercise(fatigueManager, exerciseFatigue, addedForMuscle === 0);
      }
      if (!canAdd.allowed) continue;
      addedForMuscle++;

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
      exercisePosition++;
    }
  }

  const fatigueSummary = fatigueManager.getSessionSummary();
  const totalSets = exercises.reduce((sum, e) => sum + e.sets, 0);

  return {
    day: sessionTemplate.day,
    focus: `${sessionTemplate.focus} - ${dupDayType.toUpperCase()} Day`,
    exercises,
    totalSets,
    // Shared duration model — see the non-DUP builder above.
    estimatedMinutes: estimatePlannedSessionMinutes(
      exercises.map((e) => ({
        sets: e.sets,
        restSeconds: e.restSeconds,
        mechanic: e.exercise.pattern === 'isolation' ? 'isolation' : 'compound',
        muscle: e.exercise.primaryMuscle,
      }))
    ),
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
 * CREDITED working sets per coarse muscle in a set of sessions (primary 1,
 * secondary 0.5, group-capped: services/shared/volumeCredit
 * perSetGroupCredits), the currency of the weekly targets and the MEV–MRV
 * bands. Rounded to 0.1. Pure.
 */
export function creditedSetsByGroup(
  sessions: readonly { exercises: readonly { exercise: { primaryMuscle: string; secondaryMuscles?: string[] }; sets: number }[] }[]
): Partial<Record<CoarseMuscle, number>> {
  const out: Partial<Record<CoarseMuscle, number>> = {};
  for (const session of sessions) {
    for (const ex of session.exercises) {
      for (const { group, credit } of perSetGroupCredits(ex.exercise.primaryMuscle, ex.exercise.secondaryMuscles ?? [])) {
        out[group] = (out[group] ?? 0) + ex.sets * credit;
      }
    }
  }
  for (const k of Object.keys(out) as CoarseMuscle[]) out[k] = Math.round((out[k] ?? 0) * 10) / 10;
  return out;
}

/**
 * Credited sets each coarse muscle receives from exercises it is NOT the
 * primary target of (secondary credit, plus a compound's primary credit to
 * another group). Pure.
 */
export function indirectCreditByGroup(
  sessions: readonly { exercises: readonly { exercise: { primaryMuscle: string; secondaryMuscles?: string[] }; sets: number }[] }[]
): Partial<Record<CoarseMuscle, number>> {
  const out: Partial<Record<CoarseMuscle, number>> = {};
  for (const session of sessions) {
    for (const ex of session.exercises) {
      const direct = new Map<CoarseMuscle, number>();
      for (const { group, credit } of perSetGroupCredits(ex.exercise.primaryMuscle, [])) direct.set(group, credit);
      // The group the exercise is FOR is its largest primary credit.
      let target: CoarseMuscle | null = null;
      direct.forEach((credit, group) => {
        if (target === null || credit > (direct.get(target) ?? 0)) target = group;
      });
      for (const { group, credit } of perSetGroupCredits(ex.exercise.primaryMuscle, ex.exercise.secondaryMuscles ?? [])) {
        if (group === target) continue;
        out[group] = (out[group] ?? 0) + ex.sets * credit;
      }
    }
  }
  return out;
}

type RampExercise = { exercise: { primaryMuscle: string; secondaryMuscles?: string[] }; sets: number };
type RampWeek = { isDeload: boolean; volumeModifier: number; sessions: { exercises: RampExercise[] }[] };

/**
 * Hold every muscle's credited sets non-decreasing across the accumulation
 * ramp: wherever a training week programs at least the volume share of the
 * week before it, the earlier week may not hold more sets of any muscle.
 * Each week picks its exercises afresh (recovery, fatigue gate, secondary
 * credit), so a muscle could drift a set or two DOWN while the ramp said it
 * climbed; this trims the earlier week (never adds work past what the
 * session's time and fatigue checks admitted). Weeks a model lowers on
 * purpose (block, weekly undulating) and the deload are left alone.
 * Mutates the weeks' exercises; returns how many sets it removed. Pure
 * otherwise.
 */
export function enforceNonDecreasingRamp(weeks: RampWeek[]): number {
  let removed = 0;
  const training = weeks.filter((w) => !w.isDeload);
  for (let k = training.length - 2; k >= 0; k--) {
    const week = training[k];
    const next = training[k + 1];
    if (week.volumeModifier > next.volumeModifier) continue;
    const ceiling = creditedSetsByGroup(next.sessions);
    // Bounded: every pass removes a set, and a week has finitely many.
    for (let guard = 0; guard < 500; guard++) {
      const now = creditedSetsByGroup(week.sessions);
      const over = (Object.keys(now) as CoarseMuscle[]).find((m) => (now[m] ?? 0) > (ceiling[m] ?? 0) + 1e-6);
      if (!over) break;
      // Take the set from the exercise that credits the muscle most (its
      // own direct work before another muscle's secondary), largest first.
      let best: { ex: RampExercise; credit: number } | null = null;
      for (const s of week.sessions) {
        for (const ex of s.exercises) {
          if (ex.sets <= 0) continue;
          const credit = perSetGroupCredits(ex.exercise.primaryMuscle, ex.exercise.secondaryMuscles ?? [])
            .filter((c) => c.group === over)
            .reduce((sum, c) => sum + c.credit, 0);
          if (credit <= 0) continue;
          if (!best || credit > best.credit || (credit === best.credit && ex.sets > best.ex.sets)) best = { ex, credit };
        }
      }
      if (!best) break;
      best.ex.sets -= 1;
      removed += 1;
    }
    for (const s of week.sessions) s.exercises = s.exercises.filter((ex) => ex.sets > 0);
  }
  return removed;
}

/** The accumulation week with the most volume (the later one on a tie). */
export function peakTrainingWeek<W extends { isDeload: boolean; volumeModifier: number }>(weeks: readonly W[]): W | null {
  const training = weeks.filter((w) => !w.isDeload);
  if (training.length === 0) return null;
  return training.reduce((best, w) => (w.volumeModifier >= best.volumeModifier ? w : best), training[0]);
}

/** Below this share of its target a planned muscle's target is capped. */
export const DELIVERED_SHARE_FLOOR = 0.85;

/**
 * The weekly targets the sessions cannot hold: every PLANNED muscle (one
 * some session template trains) whose peak-week credited sets fall under
 * DELIVERED_SHARE_FLOOR of its target, with `fits` = what the sessions do
 * hold. `volumePerMuscle` itself stays the plan's target (it still answers
 * to priorities and the recovery profile); the review shows `fits` as the
 * target and says what was wanted. Muscles no template trains (traps:
 * indirect credit only) are not capped; the review flags them against MEV.
 * Pure.
 */
export function capTargetsToDelivered(
  volumePerMuscle: Record<MuscleGroup, { sets: number; frequency: number }>,
  weeks: readonly MesocycleWeek[],
  templates: readonly SessionTemplate[]
): Partial<Record<MuscleGroup, { wanted: number; fits: number }>> {
  const caps: Partial<Record<MuscleGroup, { wanted: number; fits: number }>> = {};
  const peak = peakTrainingWeek(weeks);
  if (!peak) return caps;
  const planned = new Set<string>(templates.flatMap((t) => t.targetMuscles));
  const delivered = creditedSetsByGroup(peak.sessions);
  for (const [muscle, vol] of Object.entries(volumePerMuscle) as [MuscleGroup, { sets: number }][]) {
    if (!planned.has(muscle)) continue;
    const got = delivered[muscle as CoarseMuscle] ?? 0;
    if (got >= vol.sets * DELIVERED_SHARE_FLOOR) continue;
    caps[muscle] = { wanted: vol.sets, fits: Math.max(1, Math.floor(got)) };
  }
  return caps;
}

/** Sessions a split's rotation needs so no muscle group is skipped in a week. */
export function splitRotationLength(split: Split): number {
  return split === 'Bro Split' ? 5 : split === 'Upper/Lower' ? 4 : split === 'Full Body' ? 1 : 3;
}

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
    // Calves and abs ride on the upper days too: stacked only on Legs they
    // were the last of five muscles and got no sets (UX panel probe).
    PPL: [
      { day: 'Push', focus: 'Chest, shoulders, triceps', targetMuscles: ['chest', 'shoulders', 'triceps', 'calves'] },
      { day: 'Pull', focus: 'Back, biceps, rear delts', targetMuscles: ['back', 'biceps', 'shoulders', 'abs'] },
      { day: 'Legs', focus: 'Quads, hamstrings, glutes', targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    Arnold: [
      { day: 'Chest & Back', focus: 'Antagonist supersets', targetMuscles: ['chest', 'back'] },
      { day: 'Shoulders & Arms', focus: 'Upper body detail', targetMuscles: ['shoulders', 'biceps', 'triceps'] },
      { day: 'Legs', focus: 'Complete lower body', targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    // Abs had no day at all, and calves sat last on a Legs day that could
    // not hold quads, hamstrings and glutes already; the shorter single-
    // muscle days carry them twice a week instead.
    'Bro Split': [
      { day: 'Chest', focus: 'Chest, abs', targetMuscles: ['chest', 'abs'] },
      { day: 'Back', focus: 'Back, calves', targetMuscles: ['back', 'calves'] },
      { day: 'Shoulders', focus: 'All three heads, calves', targetMuscles: ['shoulders', 'calves'] },
      { day: 'Arms', focus: 'Biceps & Triceps, abs', targetMuscles: ['biceps', 'triceps', 'abs'] },
      { day: 'Legs', focus: 'Quads, hamstrings, glutes', targetMuscles: ['quads', 'hamstrings', 'glutes'] },
    ],
  };

  const baseTemplates = templates[split];

  // Adjust number of templates based on days per week. 6-day PPL doubles the
  // rotation ('Push 1' ... 'Legs 2'); above 6 sessions/week (daily training or
  // two-a-day, up to 14) every split repeats its rotation the same way so the
  // planned week really contains daysPerWeek sessions.
  if ((split === 'PPL' && daysPerWeek >= 6) || daysPerWeek > 6 || daysPerWeek > baseTemplates.length) {
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
  sessionsPerDay: number = 1,
  /**
   * The block length the user chose (training weeks + the final deload
   * week). Drives how many weeks are generated, so `mesocycleWeeks[N-1]` is
   * the deload for an N-week block. Omitted → the recovery-derived default.
   */
  totalWeeks?: number,
  /** Settings → Muscle priorities as volume adjustments (lib/training/
   *  builderDefaults priorityVolumeAdjustments). Optional; omitted = none. */
  volumeAdjustments?: VolumeAdjustmentInput[],
  /** The split the user chose in the builder. The builder's split menu used
   *  to be cosmetic — this function always recommended its own split from
   *  days per week, so "Upper/Lower" came back as Full Body (UX panel).
   *  Omitted → the recommendation. */
  splitOverride?: Split
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
  // A chosen split is honoured only when the week has room for its whole
  // rotation: a 5-day Bro Split in 4 sessions dropped Legs every week.
  const overrideFits = !!splitOverride && splitRotationLength(splitOverride) <= daysPerWeek;
  const split: Split = overrideFits ? splitOverride! : splitRec.split;

  if (splitOverride && !overrideFits) {
    warnings.push(
      `${splitOverride} needs ${splitRotationLength(splitOverride)} sessions a week; with ${daysPerWeek} it would skip muscle groups, so this plan uses ${split}.`
    );
  }
  programNotes.push(
    overrideFits && splitOverride !== splitRec.split
      ? `Split: ${split} (your choice)`
      : `Split: ${split} - ${splitRec.reason}`
  );

  // Step 4: Build periodization plan
  const periodization = buildPeriodizationPlan(profile, recoveryFactors, totalWeeks);
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
    volumeAdjustments,
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
  const prioritized = (volumeAdjustments ?? []).filter((a) => a.reason === 'user_priority' && a.volumeMultiplier > 1);
  if (prioritized.length > 0) {
    programNotes.push(`🎯 Extra volume for your priority muscles: ${prioritized.map((a) => a.head ?? a.muscleGroup).join(', ')}`);
  }
  
  if (timeVolumeModifier < 1.0) {
    programNotes.push(`📉 Volume reduced to ${Math.round(timeVolumeModifier * 100)}% to fit ${sessionMinutes}min sessions`);
  }

  // Step 6: Build session templates
  const sessionTemplates = buildSessionTemplates(split, daysPerWeek);

  // A muscle's per-session share is its weekly target over the sessions that
  // actually train it. The split's nominal frequency could disagree with the
  // templates (PPL calves sit on Push AND Legs), which over- or under-asked
  // every session.
  for (const [muscle, vol] of Object.entries(volumePerMuscle)) {
    const sessionsTraining = sessionTemplates.filter((t) => t.targetMuscles.includes(muscle as MuscleGroup)).length;
    if (sessionsTraining > 0) vol.frequency = sessionsTraining;
  }

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
  const headEmphasis = headEmphasisFrom(volumeAdjustments);
  // The block's highest accumulation-week modifier: the week that may use a
  // whole session. Lighter weeks use a matching share of it.
  const peakVolumeModifier = Math.max(
    0.1,
    ...periodization.weeklyProgression.slice(0, periodization.mesocycleWeeks - 1).map((w) => w.volumeModifier)
  );

  for (let weekNum = 1; weekNum <= periodization.mesocycleWeeks; weekNum++) {
    const weekProgression = periodization.weeklyProgression[weekNum - 1];
    const isDeload = weekNum === periodization.mesocycleWeeks;
    const capacityScale = Math.min(1, weekProgression.volumeModifier / peakVolumeModifier);

    const buildWeekSessions = (
      sessionVolume: Record<MuscleGroup, { sets: number; frequency: number }>
    ): DetailedSessionWithFatigue[] => {
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
          sessionVolume,
          profile,
          deloadBudget,
          weeklyRecovery,
          plannedDayOffset,
          dupRotation[dupIndex % 3],
          weekNum,
          periodization.mesocycleWeeks,
          quickWorkoutMode,
          unavailableEquipmentIds,
          sessionMinutes,
          headEmphasis,
          weekProgression.volumeModifier,
          capacityScale
        );
        dupIndex++;
      } else {
        session = buildDetailedSessionWithFatigue(
          template,
          sessionVolume,
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
          sessionMinutes,
          undefined,
          undefined,
          headEmphasis,
          capacityScale
        );
      }

      weekSessions.push(session);
      dayCounter++;
    }
    return weekSessions;
    };

    // Targets are CREDITED sets, but a session's request is filled with
    // DIRECT work. Pulldowns already credit biceps and rear delts, presses
    // triceps, so asking each muscle for its whole target spent the
    // session's time on muscles the week already fed and starved the ones
    // nothing else trains (flies-only chest, triceps). Build once, measure
    // each planned muscle's indirect inflow, and rebuild asking only for
    // the remainder (never under the per-session floor).
    const firstPass = buildWeekSessions(volumePerMuscle);
    const inflow = indirectCreditByGroup(firstPass);
    const modifier = Math.max(0.1, weekProgression.volumeModifier);
    let needsSecondPass = false;
    const directVolume = Object.fromEntries(
      Object.entries(volumePerMuscle).map(([muscle, vol]) => {
        const fed = (inflow[muscle as CoarseMuscle] ?? 0) / modifier;
        const sets = Math.max(MIN_SETS_PER_PLANNED_MUSCLE * vol.frequency, Math.round(vol.sets - fed));
        if (sets < vol.sets) needsSecondPass = true;
        return [muscle, { sets: Math.min(vol.sets, sets), frequency: vol.frequency }];
      })
    ) as Record<MuscleGroup, { sets: number; frequency: number }>;
      const weekSessions = needsSecondPass ? buildWeekSessions(directVolume) : firstPass;

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

  // A muscle's sets never fall while the ramp climbs (enforceNonDecreasingRamp).
  if (enforceNonDecreasingRamp(mesocycleWeeks) > 0) {
    for (const week of mesocycleWeeks) {
      for (const session of week.sessions) {
        session.totalSets = session.exercises.reduce((sum, ex) => sum + ex.sets, 0);
        session.estimatedMinutes = estimatePlannedSessionMinutes(
          session.exercises.map((e) => ({
            sets: e.sets,
            restSeconds: e.restSeconds,
            mechanic: e.exercise.pattern === 'isolation' ? 'isolation' : 'compound',
            muscle: e.exercise.primaryMuscle,
          }))
        );
      }
    }
  }

  // Step 8b: a weekly target the sessions cannot hold is capped at what they
  // do hold, and said so. Session time and the per-muscle per-session
  // ceiling bound what one day can carry, so a 22-set triceps target on two
  // 60-minute Upper days was a number the workouts never contained.
  const volumeCaps = capTargetsToDelivered(volumePerMuscle, mesocycleWeeks, sessionTemplates);
  const capped = Object.entries(volumeCaps) as [MuscleGroup, { wanted: number; fits: number }][];
  if (capped.length > 0) {
    warnings.push(
      `Your ${sessionMinutes}-minute sessions hold fewer weekly sets than the plan wants for ` +
        capped.map(([m, c]) => `${m} (${c.fits} of ${c.wanted})`).join(', ') +
        `. A session fits about ${sessionSetCapacity(sessionMinutes, profile.goal)} working sets, and one muscle ` +
        `gets at most ~${MAX_SETS_PER_MUSCLE_PER_SESSION} hard sets a day, so those targets are set to what fits. ` +
        `Longer sessions, or another day for those muscles, raise them.`
    );
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
    volumeCaps,
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

