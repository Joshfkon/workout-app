/**
 * suggestedWorkout
 *
 * Pure builder for the "AI suggested workout" launcher on /dashboard/log.
 * Data in (recovery + weekly volume per muscle, the exercise library slice,
 * the user's recent exercise ids), plan out. NO database calls.
 *
 * Selection logic:
 *   1. Rank muscles: ready first, then largest volume deficit
 *      (targetSets - weeklySets). Sore muscles and muscles already at/over
 *      target are skipped entirely.
 *   2. Take the top 3-4 muscles.
 *   3. For each muscle pick 1-2 exercises, preferring exercises the user has
 *      done recently, then staples (top hypertrophy tier per muscle via
 *      exerciseStaples), compounds before isolations.
 *   4. Cap at 4-6 exercises total; every pick carries a human-readable
 *      reason, and the plan carries a one-sentence focus summary.
 *   5. Fallback: with no usable recovery/volume data (or nothing rankable),
 *      build a balanced full-body pick from staples instead.
 */

import {
  muscleMatchesGroup,
  resolveMuscleToStandard,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type StandardMuscleGroup,
} from '@/types/schema';
import { computeStapleExerciseIds } from '@/services/exerciseStaples';

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
}

export interface SuggestedExerciseInput {
  id: string;
  name: string;
  /** Primary muscle in any taxonomy (legacy, standard, or detailed). */
  primaryMuscle: string | null;
  /** Hypertrophy tier S-F (missing treated as C). */
  tier: string | null;
  mechanic: 'compound' | 'isolation' | null;
}

export interface BuildSuggestedWorkoutInput {
  muscles: SuggestedMuscleInput[];
  exercises: SuggestedExerciseInput[];
  /** Exercise ids the user has done recently, most recent first. */
  recentExerciseIds: string[];
  /** Total exercise cap (default 6). */
  maxExercises?: number;
}

export interface SuggestedWorkoutPick {
  exerciseId: string;
  muscle: StandardMuscleGroup;
  /** Human-readable reason this exercise made the plan. */
  reason: string;
}

export interface SuggestedWorkoutPlan {
  exercises: SuggestedWorkoutPick[];
  /** One-sentence summary of what the session targets and why. */
  focus: string;
}

// ============================================================
// Internals
// ============================================================

const DEFAULT_MAX_EXERCISES = 6;
const MAX_MUSCLES = 4;
const MAX_PER_MUSCLE = 2;

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

interface RankedMuscle extends SuggestedMuscleInput {
  deficit: number;
}

/** Ready first, then largest deficit; sore and at/over-target muscles are dropped. */
function rankMuscles(muscles: SuggestedMuscleInput[]): RankedMuscle[] {
  return muscles
    .filter((m) => m.recoveryStatus !== 'sore')
    .map((m) => ({ ...m, deficit: m.targetSets - m.weeklySets }))
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

/** Balanced full-body pick from staples (no recovery/volume data to go on). */
function buildFullBodyFallback(
  exercises: SuggestedExerciseInput[],
  stapleIds: Set<string>,
  maxExercises: number
): SuggestedWorkoutPlan {
  const byGroup = new Map<string, SuggestedExerciseInput[]>();
  for (const group of FULL_BODY_GROUPS) {
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
      pickedIds.add(next.id);
      picks.push({
        exerciseId: next.id,
        muscle: standard,
        reason: `${muscleLabel(standard)} — balanced full-body pick`,
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
  };
}

// ============================================================
// Public API
// ============================================================

/**
 * Build a suggested workout plan from recovery + weekly-volume state.
 * Pure: no database calls; returns a plan the caller can preview and
 * materialize (nothing is created here).
 */
export function buildSuggestedWorkout(input: BuildSuggestedWorkoutInput): SuggestedWorkoutPlan {
  const maxExercises = Math.max(1, input.maxExercises ?? DEFAULT_MAX_EXERCISES);
  const stapleIds = computeStapleExerciseIds(
    input.exercises.map((ex) => ({ id: ex.id, muscle: ex.primaryMuscle, tier: ex.tier }))
  );

  const ranked = rankMuscles(input.muscles);
  if (ranked.length === 0) {
    // No recovery/volume data (or nothing trainable) — balanced full body.
    return buildFullBodyFallback(input.exercises, stapleIds, maxExercises);
  }

  const topMuscles = ranked.slice(0, MAX_MUSCLES);
  const recentIds = new Set(input.recentExerciseIds);
  const remaining = new Map<StandardMuscleGroup, SuggestedExerciseInput[]>(
    topMuscles.map((m) => [
      m.muscle,
      candidatesForMuscle(m.muscle, input.exercises, recentIds, stapleIds),
    ])
  );

  const picks: SuggestedWorkoutPick[] = [];
  const pickedIds = new Set<string>();
  const takeOne = (muscle: RankedMuscle): boolean => {
    const next = remaining.get(muscle.muscle)?.find((ex) => !pickedIds.has(ex.id));
    if (!next) return false;
    pickedIds.add(next.id);
    picks.push({ exerciseId: next.id, muscle: muscle.muscle, reason: reasonForPick(muscle) });
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
    return buildFullBodyFallback(input.exercises, stapleIds, maxExercises);
  }

  // Compounds first in the final session order (stable within mechanic).
  const exerciseById = new Map(input.exercises.map((ex) => [ex.id, ex]));
  const ordered = [...picks].sort((a, b) => {
    const mechA = exerciseById.get(a.exerciseId)?.mechanic === 'compound' ? 0 : 1;
    const mechB = exerciseById.get(b.exerciseId)?.mechanic === 'compound' ? 0 : 1;
    return mechA - mechB;
  });

  return { exercises: ordered, focus: buildFocus(topMuscles) };
}
