/**
 * Location-aware exercise substitution
 *
 * Pure pass over a suggested workout plan: given the training location's
 * equipment blocklist, replace picks the location can't support with the
 * best-matching available alternative — same primary muscle, closest
 * movement pattern (horizontal press → horizontal press), same mechanic
 * preferred — falling back to whatever same-muscle work IS available
 * (bodyweight/bands) rather than ever silently dropping a muscle group.
 *
 * Progression continuity by construction:
 *   - A substituted pick carries the substitute's OWN exercise id; nothing
 *     from the original (weights, e1RM, history) is grafted onto it. The
 *     caller seeds the substitute's working weight through the normal
 *     estimation path, which flags related-exercise seeds low-confidence.
 *   - Because the substitute shares the original's standard muscle group,
 *     weekly volume accounting credits the same muscles automatically.
 *
 * When no same-muscle alternative exists at all, the original pick is kept
 * and flagged `noSubstituteAvailable` so the UI can surface it instead of
 * quietly losing the muscle.
 */

import { resolveMuscleToStandard } from '@/types/schema';
import { exerciseRequiresUnavailableEquipment } from '@/services/equipmentFilter';
import { getRelatedPatterns } from '@/services/exerciseSwapper';
import { plannedSetsForDuration, type SuggestedWorkoutPick, type SuggestedWorkoutPlan } from '@/services/suggestedWorkout';
import type { MovementPattern } from '@/types/schema';

// ============================================================
// Types
// ============================================================

export interface LocationSubstitutionExercise {
  id: string;
  name: string;
  primaryMuscle: string | null;
  secondaryMuscles?: string[] | null;
  movementPattern?: string | null;
  mechanic: 'compound' | 'isolation' | null;
  /** Hypertrophy tier S-F (missing treated as C). */
  tier?: string | null;
  /** Equipment tag string for the availability filter. */
  equipment?: string | null;
}

export interface PickSubstitution {
  originalExerciseId: string;
  originalExerciseName: string;
  /** Set target the original pick carried (for revert). */
  originalSets: number;
  /**
   * Other available same-muscle alternatives, best first (for the
   * "choose other" affordance). Excludes the chosen substitute.
   */
  alternatives: string[];
}

export interface SubstitutedPick extends SuggestedWorkoutPick {
  /** Present when this pick was swapped for equipment reasons. */
  substitution?: PickSubstitution;
  /**
   * True when the location can't support this pick AND no same-muscle
   * alternative exists — the pick is kept so the muscle isn't silently
   * dropped, and the UI must surface "no substitute available".
   */
  noSubstituteAvailable?: boolean;
}

export interface SubstitutedWorkoutPlan {
  exercises: SubstitutedPick[];
  focus: string;
  isLightSession: boolean;
}

export interface ApplyLocationSubstitutionsInput {
  plan: SuggestedWorkoutPlan;
  /** Full exercise pool (available AND unavailable — candidates are filtered here). */
  exercises: LocationSubstitutionExercise[];
  /** Equipment the selected location lacks (user_equipment blocklist ids). */
  unavailableEquipmentIds: string[];
  /** Session length, for re-sizing sets when the substitute's mechanic differs. */
  sessionMinutes: number;
}

// ============================================================
// Internals
// ============================================================

const MAX_ALTERNATIVES = 3;

const TIER_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, F: 5 };

function tierRank(tier: string | null | undefined): number {
  return TIER_RANK[(tier ?? 'C').toUpperCase()] ?? TIER_RANK.C;
}

function isAvailable(
  exercise: LocationSubstitutionExercise,
  unavailableEquipmentIds: string[]
): boolean {
  return !exerciseRequiresUnavailableEquipment(
    { name: exercise.name, equipment: exercise.equipment ?? undefined },
    unavailableEquipmentIds
  );
}

function sharesStandardMuscle(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const standardsA = resolveMuscleToStandard(a);
  const standardsB = new Set(resolveMuscleToStandard(b));
  return standardsA.some((m) => standardsB.has(m));
}

function isBodyweightish(exercise: LocationSubstitutionExercise): boolean {
  const equipment = (exercise.equipment ?? '').toLowerCase();
  return equipment.includes('bodyweight') || equipment.includes('band') || equipment === '';
}

/**
 * Movement-pattern proximity: exact match beats related pattern beats
 * anything else. Patterns are free strings on exercises; unknowns score 0.
 */
function patternScore(
  original: LocationSubstitutionExercise,
  candidate: LocationSubstitutionExercise
): number {
  const a = original.movementPattern ?? null;
  const b = candidate.movementPattern ?? null;
  if (!a || !b) return 0;
  if (a === b) return 40;
  const related = getRelatedPatterns(a as MovementPattern);
  return related.includes(b as MovementPattern) ? 20 : 0;
}

/** Best-match score for a same-muscle candidate (higher is better). */
export function substitutionScore(
  original: LocationSubstitutionExercise,
  candidate: LocationSubstitutionExercise
): number {
  let score = patternScore(original, candidate);

  if (original.mechanic && candidate.mechanic === original.mechanic) score += 15;

  const originalSecondary = new Set(original.secondaryMuscles ?? []);
  const overlap = (candidate.secondaryMuscles ?? []).filter((m) => originalSecondary.has(m));
  score += Math.min(9, overlap.length * 3);

  score += (5 - tierRank(candidate.tier)) * 2;

  // Prefer keeping the loading style: a loaded original swaps to loaded
  // work when the location has any, before falling back to bodyweight/bands.
  if (isBodyweightish(original) === isBodyweightish(candidate)) score += 5;

  return score;
}

function rankCandidates(
  original: LocationSubstitutionExercise,
  pool: LocationSubstitutionExercise[],
  unavailableEquipmentIds: string[],
  excludedIds: Set<string>
): LocationSubstitutionExercise[] {
  return pool
    .filter(
      (ex) =>
        ex.id !== original.id &&
        !excludedIds.has(ex.id) &&
        sharesStandardMuscle(ex.primaryMuscle, original.primaryMuscle) &&
        isAvailable(ex, unavailableEquipmentIds)
    )
    .map((ex) => ({ ex, score: substitutionScore(original, ex) }))
    .sort((a, b) => b.score - a.score || a.ex.name.localeCompare(b.ex.name))
    .map((entry) => entry.ex);
}

/**
 * Build the pick for a chosen substitute. Sets are re-sized only when the
 * mechanic changes, and never above the original's target — the original
 * count was already capped against weekly MRV headroom, so substitution
 * must not push a muscle past it.
 */
export function buildSubstitutedPick(
  original: SuggestedWorkoutPick,
  originalExercise: LocationSubstitutionExercise,
  substitute: LocationSubstitutionExercise,
  sessionMinutes: number,
  alternatives: string[]
): SubstitutedPick {
  const sets =
    substitute.mechanic === originalExercise.mechanic
      ? original.sets
      : Math.min(original.sets, plannedSetsForDuration(substitute.mechanic, sessionMinutes));

  return {
    ...original,
    exerciseId: substitute.id,
    sets,
    substitution: {
      originalExerciseId: original.exerciseId,
      originalExerciseName: originalExercise.name,
      originalSets: original.sets,
      alternatives,
    },
  };
}

// ============================================================
// Public API
// ============================================================

/**
 * Substitute plan picks the location can't support. Pure and deterministic.
 * Picks that are available pass through untouched; unavailable picks get the
 * best-matching available same-muscle alternative, or are kept + flagged
 * when none exists (never silently dropped).
 */
export function applyLocationSubstitutions(
  input: ApplyLocationSubstitutionsInput
): SubstitutedWorkoutPlan {
  const { plan, exercises, unavailableEquipmentIds, sessionMinutes } = input;
  const exerciseById = new Map(exercises.map((ex) => [ex.id, ex]));

  // Ids already in the plan — a substitute must not duplicate another pick.
  const usedIds = new Set(plan.exercises.map((p) => p.exerciseId));

  const substituted: SubstitutedPick[] = plan.exercises.map((pick) => {
    const original = exerciseById.get(pick.exerciseId);
    if (!original || unavailableEquipmentIds.length === 0) return { ...pick };
    if (isAvailable(original, unavailableEquipmentIds)) return { ...pick };

    const candidates = rankCandidates(original, exercises, unavailableEquipmentIds, usedIds);
    if (candidates.length === 0) {
      // No same-muscle work possible here — keep the muscle visible and
      // let the UI surface "no substitute available".
      return { ...pick, noSubstituteAvailable: true };
    }

    const [best, ...rest] = candidates;
    usedIds.delete(pick.exerciseId);
    usedIds.add(best.id);
    return buildSubstitutedPick(
      pick,
      original,
      best,
      sessionMinutes,
      rest.slice(0, MAX_ALTERNATIVES).map((ex) => ex.id)
    );
  });

  return { exercises: substituted, focus: plan.focus, isLightSession: plan.isLightSession };
}

/** Count of picks that were swapped (for the sheet's summary line). */
export function countSubstitutions(plan: SubstitutedWorkoutPlan): number {
  return plan.exercises.filter((p) => p.substitution).length;
}
