/**
 * suggestedWorkout
 *
 * Pure builder for the "AI suggested workout" launcher (Train tab + /dashboard/log).
 * Data in (recovery + weekly volume per muscle, the exercise library slice,
 * the user's recent exercise ids, injury flags, equipment), plan out.
 * NO database calls, NO randomness — the same inputs always produce the same
 * plan, so regenerating without new data never changes the suggestion.
 *
 * Selection logic:
 *   1. Drop injury-flagged muscles (the mesocycle generator's exclusion rule,
 *      reused via isMuscleExcludedByInjury) and exercises needing unavailable
 *      equipment (filterExercisesByEquipment).
 *   2. Rank muscles: ready first, then largest volume deficit
 *      (targetSets - weeklySets). Sore muscles and muscles already at/over
 *      target are skipped entirely.
 *   3. Take the top 3-4 muscles; for each pick 1-2 exercises, preferring
 *      recently used, then staples, compounds before isolations.
 *   4. Every pick carries set/rep/RIR targets:
 *        - sets sized to the session length, hard-capped so the muscle's
 *          weekly total never passes MRV;
 *        - RIR floored by the joint-stress safety tier (getRIRFloor — natural
 *          values regardless of Enhanced Athlete Mode, by construction).
 *   5. When every under-target muscle is out of MRV headroom, emit a light
 *      technique session (2 sets, high RIR) instead — and say so in the focus.
 *   6. Fallback: with no usable recovery/volume data, build a balanced
 *      full-body pick from staples instead.
 */

import {
  muscleMatchesGroup,
  resolveMuscleToStandard,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type StandardMuscleGroup,
} from '@/types/schema';
import { computeStapleExerciseIds } from '@/services/exerciseStaples';
import { isMuscleExcludedByInjury } from '@/services/shared/injuryExclusion';
import { getRIRFloor } from '@/services/exerciseSafety';
import { filterExercisesByEquipment } from '@/services/equipmentFilter';

// ============================================================
// Types
// ============================================================

export type SuggestedRecoveryStatus = 'ready' | 'recovering' | 'sore';

export interface SuggestedMuscleInput {
  muscle: StandardMuscleGroup;
  recoveryStatus: SuggestedRecoveryStatus;
  /** Working sets logged for this muscle in the current week. */
  weeklySets: number;
  /** Weekly set target for this muscle (e.g. MAV landmark). */
  targetSets: number;
  /**
   * Weekly ceiling (MRV landmark). Suggested sets never push weeklySets past
   * this. Omitted = no cap data (legacy callers); pass it whenever known.
   */
  mrvSets?: number;
}

export interface SuggestedExerciseInput {
  id: string;
  name: string;
  /** Primary muscle in any taxonomy (legacy, standard, or detailed). */
  primaryMuscle: string | null;
  /** Hypertrophy tier S-F (missing treated as C). */
  tier: string | null;
  mechanic: 'compound' | 'isolation' | null;
  /** Library defaults used for the pick's rep/RIR targets. */
  defaultRepRange?: [number, number] | null;
  defaultRir?: number | null;
  /** Equipment tag for the availability filter (optional). */
  equipment?: string | null;
}

export interface BuildSuggestedWorkoutInput {
  muscles: SuggestedMuscleInput[];
  exercises: SuggestedExerciseInput[];
  /** Exercise ids the user has done recently, most recent first. */
  recentExerciseIds: string[];
  /** Total exercise cap (default 6). */
  maxExercises?: number;
  /** Session length the set targets are sized for (default 60). */
  sessionMinutes?: number;
  /**
   * Injury-flagged muscle groups (users.injury_history, legacy taxonomy).
   * Excluded exactly like the mesocycle generator excludes them.
   */
  injuredMuscles?: string[];
  /** Equipment the user's gym lacks (user_equipment ids). */
  unavailableEquipmentIds?: string[];
}

export interface SuggestedWorkoutPick {
  exerciseId: string;
  muscle: StandardMuscleGroup;
  /** Human-readable reason this exercise made the plan. */
  reason: string;
  /** Working-set target (session-length sized, MRV-capped). */
  sets: number;
  repRange: [number, number];
  /** Target RIR, never below the exercise's joint-stress RIR floor. */
  targetRir: number;
}

export interface SuggestedWorkoutPlan {
  exercises: SuggestedWorkoutPick[];
  /** One-sentence summary of what the session targets and why. */
  focus: string;
  /**
   * True when volume guardrails forced a technique day: every under-target
   * muscle was out of weekly MRV headroom.
   */
  isLightSession: boolean;
}

// ============================================================
// Internals
// ============================================================

const DEFAULT_MAX_EXERCISES = 6;
const DEFAULT_SESSION_MINUTES = 60;
const MAX_MUSCLES = 4;
const MAX_PER_MUSCLE = 2;
/** Fewer sets than this isn't a meaningful working pick. */
const MIN_PICK_SETS = 2;
/** RIR for technique-day sets (raised further by the joint-stress floor). */
const LIGHT_SESSION_RIR = 3;

/** Coarse groups used for the balanced full-body fallback. */
const FULL_BODY_GROUPS = [
  'chest',
  'back',
  'quads',
  'shoulders',
  'hamstrings',
  'biceps',
  'triceps',
  'glutes',
] as const;

const TIER_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, F: 5 };

function tierRank(tier: string | null): number {
  return TIER_RANK[(tier ?? 'C').toUpperCase()] ?? TIER_RANK.C;
}

function muscleLabel(muscle: StandardMuscleGroup): string {
  return STANDARD_MUSCLE_DISPLAY_NAMES[muscle] ?? muscle;
}

function setsNoun(n: number): string {
  return n === 1 ? 'set' : 'sets';
}

/** Per-exercise set target scaled to session length (full sets at 60+ min, never below 2). */
export function plannedSetsForDuration(
  mechanic: 'compound' | 'isolation' | null,
  minutes: number
): number {
  const base = mechanic === 'compound' ? 4 : 3;
  return Math.max(MIN_PICK_SETS, Math.round(base * Math.min(1, minutes / 60)));
}

/** Exercise budget for the session length (compound ≈ 12 min, isolation ≈ 8 min incl. rest). */
export function maxExercisesForDuration(minutes: number): number {
  if (minutes <= 20) return 2;
  if (minutes <= 30) return 3;
  if (minutes <= 45) return 4;
  if (minutes <= 60) return 5;
  if (minutes <= 75) return 6;
  return 7;
}

/** Rep range from library defaults, else the compound/isolation convention. */
function repRangeFor(exercise: SuggestedExerciseInput): [number, number] {
  const range = exercise.defaultRepRange;
  if (range && range.length >= 2) return [range[0], range[1]];
  return exercise.mechanic === 'compound' ? [6, 10] : [10, 15];
}

/**
 * Target RIR for a pick: the library default floored by the joint-stress
 * safety tier. getRIRFloor is name-only by design — the cap protects
 * connective tissue and stays at natural values regardless of Enhanced
 * Athlete Mode (see services/exerciseSafety.ts).
 */
function targetRirFor(exercise: SuggestedExerciseInput, baseRir: number): number {
  return Math.max(baseRir, getRIRFloor(exercise.name));
}

interface RankedMuscle extends SuggestedMuscleInput {
  deficit: number;
  /** Sets left before the weekly MRV ceiling (Infinity without cap data). */
  headroom: number;
}

/** Ready first, then largest deficit; sore and at/over-target muscles are dropped. */
function rankMuscles(muscles: SuggestedMuscleInput[], injuredMuscles: string[]): RankedMuscle[] {
  return muscles
    .filter((m) => m.recoveryStatus !== 'sore')
    .filter((m) => !isMuscleExcludedByInjury(m.muscle, injuredMuscles))
    .map((m) => ({
      ...m,
      deficit: m.targetSets - m.weeklySets,
      headroom: m.mrvSets != null ? m.mrvSets - m.weeklySets : Infinity,
    }))
    .filter((m) => m.deficit > 0)
    .sort((a, b) => {
      const readyDiff =
        (a.recoveryStatus === 'ready' ? 0 : 1) - (b.recoveryStatus === 'ready' ? 0 : 1);
      if (readyDiff !== 0) return readyDiff;
      if (b.deficit !== a.deficit) return b.deficit - a.deficit;
      return a.muscle.localeCompare(b.muscle);
    });
}

/**
 * Candidate exercises for a standard muscle, best first: recently used, then
 * staples, then compounds before isolations, then tier, then name (stable).
 */
function candidatesForMuscle(
  muscle: StandardMuscleGroup,
  exercises: SuggestedExerciseInput[],
  recentIds: Set<string>,
  stapleIds: Set<string>
): SuggestedExerciseInput[] {
  return exercises
    .filter((ex) => ex.primaryMuscle && resolveMuscleToStandard(ex.primaryMuscle).includes(muscle))
    .sort((a, b) => {
      const recentDiff = (recentIds.has(a.id) ? 0 : 1) - (recentIds.has(b.id) ? 0 : 1);
      if (recentDiff !== 0) return recentDiff;
      const stapleDiff = (stapleIds.has(a.id) ? 0 : 1) - (stapleIds.has(b.id) ? 0 : 1);
      if (stapleDiff !== 0) return stapleDiff;
      const mechanicDiff =
        (a.mechanic === 'compound' ? 0 : 1) - (b.mechanic === 'compound' ? 0 : 1);
      if (mechanicDiff !== 0) return mechanicDiff;
      const tierDiff = tierRank(a.tier) - tierRank(b.tier);
      if (tierDiff !== 0) return tierDiff;
      return a.name.localeCompare(b.name);
    });
}

function reasonForPick(muscle: RankedMuscle): string {
  const label = muscleLabel(muscle.muscle);
  const deficitText = `${muscle.deficit} ${setsNoun(muscle.deficit)} below target this week`;
  return muscle.recoveryStatus === 'ready'
    ? `${label} — ${deficitText}`
    : `${label} — ${deficitText}, almost recovered`;
}

function buildFocus(topMuscles: RankedMuscle[]): string {
  const names = topMuscles
    .slice(0, 3)
    .map((m) => muscleLabel(m.muscle).toLowerCase());
  const joined =
    names.length <= 1
      ? names.join('')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Focus: ${joined} — most recovered, furthest behind target this week.`;
}

/** Compounds first in the final session order (stable within mechanic). */
function orderCompoundsFirst(
  picks: SuggestedWorkoutPick[],
  exerciseById: Map<string, SuggestedExerciseInput>
): SuggestedWorkoutPick[] {
  return [...picks].sort((a, b) => {
    const mechA = exerciseById.get(a.exerciseId)?.mechanic === 'compound' ? 0 : 1;
    const mechB = exerciseById.get(b.exerciseId)?.mechanic === 'compound' ? 0 : 1;
    return mechA - mechB;
  });
}

/**
 * Light/technique session: every under-target muscle is out of MRV headroom,
 * so instead of adding stimulative volume, prescribe a couple of high-RIR
 * technique sets on the top-ranked muscles that still have ANY headroom.
 */
function buildLightSession(
  ranked: RankedMuscle[],
  exercises: SuggestedExerciseInput[],
  recentIds: Set<string>,
  stapleIds: Set<string>,
  exerciseById: Map<string, SuggestedExerciseInput>
): SuggestedWorkoutPlan {
  const picks: SuggestedWorkoutPick[] = [];
  const pickedIds = new Set<string>();

  for (const muscle of ranked.slice(0, MAX_MUSCLES)) {
    if (muscle.headroom < 1) continue;
    const next = candidatesForMuscle(muscle.muscle, exercises, recentIds, stapleIds).find(
      (ex) => !pickedIds.has(ex.id)
    );
    if (!next) continue;
    pickedIds.add(next.id);
    picks.push({
      exerciseId: next.id,
      muscle: muscle.muscle,
      reason: `${muscleLabel(muscle.muscle)} — near weekly max, light technique work only`,
      sets: Math.min(MIN_PICK_SETS, Math.floor(muscle.headroom)),
      repRange: repRangeFor(next),
      targetRir: targetRirFor(next, LIGHT_SESSION_RIR),
    });
  }

  return {
    exercises: orderCompoundsFirst(picks, exerciseById),
    focus:
      picks.length > 0
        ? 'Light technique session — every under-target muscle is close to its weekly recoverable maximum (MRV), so today stays easy on purpose.'
        : 'All under-target muscles are at their weekly recoverable maximum (MRV) — rest, mobility, or light cardio today.',
    isLightSession: true,
  };
}

/** Balanced full-body pick from staples (no recovery/volume data to go on). */
function buildFullBodyFallback(
  exercises: SuggestedExerciseInput[],
  stapleIds: Set<string>,
  maxExercises: number,
  sessionMinutes: number,
  injuredMuscles: string[],
  headroomByMuscle: Map<StandardMuscleGroup, number>
): SuggestedWorkoutPlan {
  const byGroup = new Map<string, SuggestedExerciseInput[]>();
  for (const group of FULL_BODY_GROUPS) {
    if (isMuscleExcludedByInjury(group, injuredMuscles)) continue;
    const candidates = exercises
      .filter(
        (ex) =>
          stapleIds.has(ex.id) &&
          ex.primaryMuscle &&
          muscleMatchesGroup(ex.primaryMuscle, group)
      )
      .sort((a, b) => {
        const mechanicDiff =
          (a.mechanic === 'compound' ? 0 : 1) - (b.mechanic === 'compound' ? 0 : 1);
        if (mechanicDiff !== 0) return mechanicDiff;
        const tierDiff = tierRank(a.tier) - tierRank(b.tier);
        if (tierDiff !== 0) return tierDiff;
        return a.name.localeCompare(b.name);
      });
    byGroup.set(group, candidates);
  }

  /** Remaining MRV headroom for a standard muscle (Infinity without data). */
  const headroomFor = (muscle: StandardMuscleGroup): number =>
    headroomByMuscle.get(muscle) ?? Infinity;

  const picks: SuggestedWorkoutPick[] = [];
  const pickedIds = new Set<string>();
  let added = true;
  while (picks.length < maxExercises && added) {
    added = false;
    for (const group of FULL_BODY_GROUPS) {
      if (picks.length >= maxExercises) break;
      const next = byGroup.get(group)?.find((ex) => !pickedIds.has(ex.id));
      if (!next || !next.primaryMuscle) continue;
      const standard = resolveMuscleToStandard(next.primaryMuscle)[0];
      if (!standard) continue;

      // Even with no ranking data, never push a muscle we DO have volume
      // data for past its weekly MRV.
      const headroom = headroomFor(standard);
      const baseSets = plannedSetsForDuration(next.mechanic, sessionMinutes);
      const sets = Math.min(baseSets, Math.floor(headroom));
      if (sets < MIN_PICK_SETS) continue;

      pickedIds.add(next.id);
      headroomByMuscle.set(standard, headroom - sets);
      picks.push({
        exerciseId: next.id,
        muscle: standard,
        reason: `${muscleLabel(standard)} — balanced full-body pick`,
        sets,
        repRange: repRangeFor(next),
        targetRir: targetRirFor(next, next.defaultRir ?? 2),
      });
      added = true;
    }
  }

  return {
    exercises: picks,
    focus:
      picks.length > 0
        ? 'Focus: full body — no recent training data yet, starting with a balanced session.'
        : 'No exercises available to suggest.',
    isLightSession: false,
  };
}

// ============================================================
// Public API
// ============================================================

/**
 * Build a suggested workout plan from recovery + weekly-volume state.
 * Pure and deterministic: no database calls, no randomness; returns a plan
 * the caller can preview and materialize (nothing is created here).
 */
export function buildSuggestedWorkout(input: BuildSuggestedWorkoutInput): SuggestedWorkoutPlan {
  const maxExercises = Math.max(1, input.maxExercises ?? DEFAULT_MAX_EXERCISES);
  const sessionMinutes = input.sessionMinutes ?? DEFAULT_SESSION_MINUTES;
  const injuredMuscles = input.injuredMuscles ?? [];

  // Guardrail filters first: equipment (reused machine-level filter), then
  // the mesocycle generator's muscle-level injury exclusion applied to each
  // exercise's primary muscle.
  const usableExercises = filterExercisesByEquipment(
    input.exercises.map((ex) => ({ ...ex, equipment: ex.equipment ?? undefined })),
    input.unavailableEquipmentIds ?? []
  ).filter(
    (ex) => !ex.primaryMuscle || !isMuscleExcludedByInjury(ex.primaryMuscle, injuredMuscles)
  );

  const stapleIds = computeStapleExerciseIds(
    usableExercises.map((ex) => ({ id: ex.id, muscle: ex.primaryMuscle, tier: ex.tier }))
  );
  const exerciseById = new Map(usableExercises.map((ex) => [ex.id, ex]));
  const recentIds = new Set(input.recentExerciseIds);

  // Live per-muscle MRV headroom, consumed as picks accumulate.
  const headroomByMuscle = new Map<StandardMuscleGroup, number>();
  input.muscles.forEach((m) => {
    if (m.mrvSets != null) headroomByMuscle.set(m.muscle, m.mrvSets - m.weeklySets);
  });

  const ranked = rankMuscles(input.muscles, injuredMuscles);
  if (ranked.length === 0) {
    // No recovery/volume data (or nothing trainable) — balanced full body.
    return buildFullBodyFallback(
      usableExercises,
      stapleIds,
      maxExercises,
      sessionMinutes,
      injuredMuscles,
      headroomByMuscle
    );
  }

  // Every under-target muscle out of MRV headroom → technique day, not volume.
  if (ranked.every((m) => m.headroom < MIN_PICK_SETS)) {
    return buildLightSession(ranked, usableExercises, recentIds, stapleIds, exerciseById);
  }

  const topMuscles = ranked.slice(0, MAX_MUSCLES);
  const remaining = new Map<StandardMuscleGroup, SuggestedExerciseInput[]>(
    topMuscles.map((m) => [
      m.muscle,
      candidatesForMuscle(m.muscle, usableExercises, recentIds, stapleIds),
    ])
  );

  const picks: SuggestedWorkoutPick[] = [];
  const pickedIds = new Set<string>();
  const takeOne = (muscle: RankedMuscle): boolean => {
    const headroom = headroomByMuscle.get(muscle.muscle) ?? Infinity;
    const next = remaining.get(muscle.muscle)?.find((ex) => !pickedIds.has(ex.id));
    if (!next) return false;

    // Cap this pick's sets by the muscle's remaining weekly MRV headroom;
    // when there isn't room for a meaningful pick, skip the muscle.
    const baseSets = plannedSetsForDuration(next.mechanic, sessionMinutes);
    const sets = Math.min(baseSets, Math.floor(headroom));
    if (sets < MIN_PICK_SETS) return false;

    pickedIds.add(next.id);
    headroomByMuscle.set(muscle.muscle, headroom - sets);
    picks.push({
      exerciseId: next.id,
      muscle: muscle.muscle,
      reason: reasonForPick(muscle),
      sets,
      repRange: repRangeFor(next),
      targetRir: targetRirFor(next, next.defaultRir ?? 2),
    });
    return true;
  };

  // Pass 1: one exercise per ranked muscle; pass 2: a second exercise per
  // muscle (in rank order) until the cap.
  for (let pass = 0; pass < MAX_PER_MUSCLE; pass++) {
    for (const muscle of topMuscles) {
      if (picks.length >= maxExercises) break;
      takeOne(muscle);
    }
  }

  if (picks.length === 0) {
    // Ranked muscles had no matching exercises — fall back to full body.
    return buildFullBodyFallback(
      usableExercises,
      stapleIds,
      maxExercises,
      sessionMinutes,
      injuredMuscles,
      headroomByMuscle
    );
  }

  return {
    exercises: orderCompoundsFirst(picks, exerciseById),
    focus: buildFocus(topMuscles),
    isLightSession: false,
  };
}
