/**
 * exerciseOrdering — deterministic "Auto-arrange" for a planned exercise list.
 *
 * A greedy ordering with hard constraints, NOT a rule chain:
 *
 *  1. HARD: compounds (multi-joint, high systemic load) come before isolation
 *     work — heavy systemic lifts get the freshest state.
 *  2. HARD: grip-intensive accessories (wrist curls, forearm work) come after
 *     every grip-dependent movement they would compromise (rows, pulldowns,
 *     hinges, shrugs, curls).
 *  3. GREEDY: among the eligible candidates, pick the exercise with the
 *     LARGEST muscle-overlap distance from the previous 1–2 picks, measured on
 *     the canonical per-set credit vectors (services/shared/volumeCredit) —
 *     the same attribution matrix the volume model counts with. This
 *     naturally interleaves muscle groups and pairs antagonists, so no muscle
 *     does back-to-back exercises while another waits.
 *  4. Ties break by descending "load" (credit mass — compounds touch more
 *     muscle, so this orders bigger lifts first), then name, then the
 *     original position. Every comparison is total, so the same input always
 *     produces the same output.
 *
 * This is a ONE-SHOT action: it returns a new ordering and owns nothing else.
 * Persisting it, previewing it, and preserving the user's later manual drags
 * are the caller's concern.
 *
 * Pure functions — no React, no Supabase, no randomness, no clock.
 */

import { perSetStandardCredit } from '@/services/shared/volumeCredit';
import { resolveMuscleToStandard } from '@/types/schema';
import { STANDARD_TO_COARSE, type CoarseMuscle } from '@/services/volumeBands';

/** The metadata auto-arrange reads off each planned exercise. All fields are
 *  tolerant of missing data (older rows, custom exercises): a null mechanic
 *  falls back to the movement pattern, and an untagged exercise simply scores
 *  zero overlap with everything. */
export interface OrderableExercise {
  id: string;
  name: string;
  primaryMuscle: string | null;
  secondaryMuscles?: string[] | null;
  /** exercises.mechanic — the authoritative compound/isolation flag. */
  mechanic?: 'compound' | 'isolation' | string | null;
  /** exercises.movement_pattern — fallback classification + grip semantics. */
  movementPattern?: string | null;
}

/** Movement patterns that read as multi-joint when `mechanic` is missing
 *  (covers both the legacy and canonical pattern taxonomies). */
const COMPOUND_PATTERNS = new Set([
  'horizontal_push',
  'horizontal_pull',
  'vertical_push',
  'vertical_pull',
  'hip_hinge',
  'hinge',
  'squat',
  'lunge',
  'horizontal_press',
  'vertical_press',
  'carry',
]);

/** Patterns whose performance a pre-fatigued grip would compromise. */
const GRIP_DEPENDENT_PATTERNS = new Set([
  'horizontal_pull',
  'vertical_pull',
  'hip_hinge',
  'hinge',
  'carry',
  'isolation_scapular_elevation', // shrugs
]);

/** Coarse groups whose primary work implies holding/pulling a loaded bar. */
const GRIP_DEPENDENT_GROUPS = new Set<CoarseMuscle>(['back', 'biceps', 'traps']);

/** The coarse group an exercise's PRIMARY tag lands on (null when untagged or
 *  unresolvable). */
function primaryCoarseGroup(ex: OrderableExercise): CoarseMuscle | null {
  if (!ex.primaryMuscle) return null;
  const standards = resolveMuscleToStandard(ex.primaryMuscle);
  for (const std of standards) {
    const coarse = STANDARD_TO_COARSE[std];
    if (coarse) return coarse;
  }
  return null;
}

/** Compound (multi-joint, high systemic load)? `mechanic` decides when
 *  present; otherwise the movement pattern; an untyped exercise reads as
 *  isolation (the safe default — it never displaces a known compound). */
export function isCompoundExercise(ex: OrderableExercise): boolean {
  if (ex.mechanic === 'compound') return true;
  if (ex.mechanic === 'isolation') return false;
  return ex.movementPattern != null && COMPOUND_PATTERNS.has(ex.movementPattern);
}

/** Grip-intensive accessory (wrist curls, forearm work): primary-tagged to the
 *  forearms group, or a wrist-flexion/extension isolation pattern. */
export function isGripIntensiveExercise(ex: OrderableExercise): boolean {
  if (primaryCoarseGroup(ex) === 'forearms') return true;
  return ex.movementPattern != null && ex.movementPattern.includes('wrist');
}

/** Would a pre-fatigued grip compromise this movement? (Rows, pulldowns,
 *  hinges, carries, shrugs, curls — pattern first, primary group fallback.)
 *  Grip-intensive work itself is excluded: it cannot block itself. */
export function isGripDependentExercise(ex: OrderableExercise): boolean {
  if (isGripIntensiveExercise(ex)) return false;
  if (ex.movementPattern != null && GRIP_DEPENDENT_PATTERNS.has(ex.movementPattern)) return true;
  const coarse = primaryCoarseGroup(ex);
  return coarse !== null && GRIP_DEPENDENT_GROUPS.has(coarse);
}

/** Per-set standard-muscle credit vector — the existing attribution matrix. */
function creditVector(ex: OrderableExercise): Record<string, number> {
  if (!ex.primaryMuscle) return {};
  return perSetStandardCredit(ex.primaryMuscle, ex.secondaryMuscles ?? []);
}

/** Muscle overlap between two credit vectors: Σ min(a[m], b[m]). 0 = fully
 *  disjoint (antagonists / different regions), higher = more shared work. */
export function muscleOverlap(
  a: Record<string, number>,
  b: Record<string, number>
): number {
  let sum = 0;
  for (const muscle of Object.keys(a)) {
    const other = b[muscle];
    if (other !== undefined) sum += Math.min(a[muscle], other);
  }
  return sum;
}

/** Total credit mass — a proxy for systemic load (a bench press credits ~2.0
 *  per set across chest/delts/triceps, a curl ~1.0–1.5). */
function creditMass(vector: Record<string, number>): number {
  let sum = 0;
  for (const muscle of Object.keys(vector)) sum += vector[muscle];
  return sum;
}

/** How strongly the SECOND-previous pick still counts against a candidate. */
const PREVIOUS_2_WEIGHT = 0.5;

/**
 * Auto-arrange a planned exercise list. Returns a NEW array of the same items
 * in the arranged order (never mutates the input). Deterministic for the same
 * input; unknown/missing metadata degrades gracefully (see OrderableExercise).
 *
 * @param items   the caller's own item type (template rows, exercise blocks…)
 * @param getMeta how to read ordering metadata off one item
 */
export function autoArrangeExercises<T>(
  items: readonly T[],
  getMeta: (item: T) => OrderableExercise
): T[] {
  interface Candidate {
    item: T;
    originalIndex: number;
    meta: OrderableExercise;
    vector: Record<string, number>;
    mass: number;
    compound: boolean;
    gripIntensive: boolean;
    gripDependent: boolean;
  }

  const remaining: Candidate[] = items.map((item, originalIndex) => {
    const meta = getMeta(item);
    const vector = creditVector(meta);
    return {
      item,
      originalIndex,
      meta,
      vector,
      mass: creditMass(vector),
      compound: isCompoundExercise(meta),
      gripIntensive: isGripIntensiveExercise(meta),
      gripDependent: isGripDependentExercise(meta),
    };
  });

  const result: Candidate[] = [];

  // Total tie-break: bigger load first, then name, then original position —
  // the final comparison makes every ordering decision deterministic.
  const tieBreak = (a: Candidate, b: Candidate): number => {
    if (a.mass !== b.mass) return b.mass - a.mass;
    if (a.meta.name !== b.meta.name) return a.meta.name < b.meta.name ? -1 : 1;
    return a.originalIndex - b.originalIndex;
  };

  while (remaining.length > 0) {
    // HARD 2: while any grip-dependent movement is still unplaced,
    // grip-intensive accessories are not eligible.
    const gripBlocked = remaining.some((c) => c.gripDependent);
    let eligible = gripBlocked ? remaining.filter((c) => !c.gripIntensive) : remaining;
    if (eligible.length === 0) eligible = remaining; // degenerate safety

    // HARD 1: all eligible compounds before any isolation.
    const compounds = eligible.filter((c) => c.compound);
    const pool = compounds.length > 0 ? compounds : eligible;

    // GREEDY 3: maximize muscle-overlap distance from the previous 1–2 picks
    // (= minimize weighted overlap). The first pick has no previous, so the
    // tie-break alone decides — the heaviest lift opens the session.
    const prev1 = result[result.length - 1];
    const prev2 = result[result.length - 2];
    let best: Candidate | null = null;
    let bestPenalty = Infinity;
    for (const candidate of pool) {
      const penalty =
        (prev1 ? muscleOverlap(candidate.vector, prev1.vector) : 0) +
        (prev2 ? muscleOverlap(candidate.vector, prev2.vector) * PREVIOUS_2_WEIGHT : 0);
      if (
        best === null ||
        penalty < bestPenalty - 1e-9 ||
        (Math.abs(penalty - bestPenalty) <= 1e-9 && tieBreak(candidate, best) < 0)
      ) {
        best = candidate;
        bestPenalty = penalty;
      }
    }

    result.push(best!);
    remaining.splice(remaining.indexOf(best!), 1);
  }

  return result.map((c) => c.item);
}

/** Whether an arrangement actually changed anything (same ids in the same
 *  positions = no-op; callers show "already well ordered" instead of a
 *  preview). */
export function orderChanged<T>(
  before: readonly T[],
  after: readonly T[],
  getId: (item: T) => string
): boolean {
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) {
    if (getId(before[i]) !== getId(after[i])) return true;
  }
  return false;
}
