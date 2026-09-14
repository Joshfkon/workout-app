/**
 * volumeDeficitSuggestions — a concrete remedy for each muscle the week
 * projection leaves under its band minimum.
 *
 * The workout volume strip's projection digest (services/plannedVolumeProjection)
 * can tell the user a muscle will end the week "Under min" — but stops at the
 * diagnosis. This module computes the prescription: the smallest concrete
 * action TODAY that lifts the projected total to the band minimum, so the UI
 * can offer a one-tap fix instead of a bare warning.
 *
 * Two remedies, in preference order:
 *  1. ADD SETS to an exercise already in today's session whose primary tag
 *     directly credits the deficit group — the cheapest fix (no new setup,
 *     no extra exercise). Only offered when the fix is small (≤
 *     MAX_ADD_SETS_TO_BLOCK extra sets) and fits the DB target-sets cap;
 *     piling 4+ extra sets onto one exercise concentrates fatigue and junk
 *     volume, at which point a second exercise is the better prescription.
 *  2. ADD AN EXERCISE for the muscle (the caller opens the add-exercise
 *     picker pre-filtered to it). `setsNeeded` assumes direct work: any
 *     exercise whose primary tag resolves within the group credits ~1.0
 *     per working set (see perSetGroupCredits — a within-group primary
 *     split still sums to 1.0 before the cap).
 *
 * HONESTY RULES (mirroring plannedVolumeProjection's lock split):
 *  - A LOCKED-IN deficit gets NO suggestion. Locked means recovery cannot
 *    produce more quality sets before the weekly window closes — suggesting
 *    sets the model says can't be quality work would contradict the red
 *    message right above it.
 *  - Sets-needed math uses the same canonical per-set group credit as the
 *    projection itself, so "add N sets" moves the projected number by
 *    exactly what the suggestion promised.
 *
 * Pure functions — no React, no Supabase, no clock.
 */

import { perSetGroupCredits } from '@/services/shared/volumeCredit';
import type { CoarseMuscle } from '@/services/volumeBands';

/** DB CHECK upper bound on exercise_blocks.target_sets (see the workout
 *  page's handleTargetSetsChange clamp — keep in sync). */
export const MAX_TARGET_SETS = 10;

/**
 * Largest add-sets fix worth offering on a single block. A deficit needing
 * more than this is better served by a second exercise (remedy 2).
 */
export const MAX_ADD_SETS_TO_BLOCK = 3;

/** Per-set group credit at/above which a block counts as DIRECT work for the
 *  group. Direct primaries credit 1.0 (within-group splits sum to 1.0);
 *  secondary-only credit tops out at 0.5 — deliberately excluded, because
 *  clearing a deficit through indirect half-credit sets doubles the set count
 *  and lands the fatigue on a different primary muscle. */
const DIRECT_CREDIT_THRESHOLD = 0.75;

/** Float-dust guard so a deficit of exactly N credited sets needs N sets, not N+1. */
const CREDIT_EPSILON = 1e-6;

/** Projection state for one coarse muscle row (from useWorkoutMuscleVolume). */
export interface DeficitMuscleRow {
  muscle: CoarseMuscle;
  displayName: string;
  /** Projected week total if today's plan is finished (rounded, credited sets). */
  projectedSets: number;
  /** The band minimum the projection is measured against. */
  mev: number;
  /** Whether the projected total sits below the band minimum. */
  projectedUnderMin: boolean;
  /** Recovery has already decided the deficit — see isDeficitLockedIn. */
  deficitLockedIn: boolean;
}

/** One non-skipped exercise block of today's session. */
export interface SuggestionBlock {
  blockId: string;
  exerciseName: string;
  primaryMuscle: string | null;
  secondaryMuscles: string[];
  targetSets: number;
}

/** Remedy 1: bump an existing block's target sets. */
export interface AddSetsAction {
  kind: 'add_sets';
  blockId: string;
  exerciseName: string;
  /** Extra working sets that lift the projected total to the band minimum. */
  addSets: number;
}

/** Remedy 2: add an exercise for the muscle (picker pre-filtered by caller). */
export interface AddExerciseAction {
  kind: 'add_exercise';
}

export interface DeficitSuggestion {
  muscle: CoarseMuscle;
  displayName: string;
  /** Direct working sets needed to clear the minimum (1.0 credit per set). */
  setsNeeded: number;
  action: AddSetsAction | AddExerciseAction;
}

/** A block's per-set credited contribution to one coarse group. */
function blockGroupCredit(block: SuggestionBlock, group: CoarseMuscle): number {
  if (!block.primaryMuscle) return 0;
  const entry = perSetGroupCredits(block.primaryMuscle, block.secondaryMuscles).find(
    (c) => c.group === group
  );
  return entry?.credit ?? 0;
}

/**
 * One suggestion per under-min, NOT-locked muscle row: the cheapest concrete
 * action that lifts its projected week total to the band minimum. Rows in
 * range, over, or locked produce nothing. Order follows the input rows, so
 * the caller's frozen strip order carries through to the suggestion list.
 */
export function buildDeficitSuggestions(
  rows: readonly DeficitMuscleRow[],
  blocks: readonly SuggestionBlock[]
): DeficitSuggestion[] {
  const out: DeficitSuggestion[] = [];

  for (const row of rows) {
    if (!row.projectedUnderMin || row.deficitLockedIn) continue;
    const deficit = row.mev - row.projectedSets;
    if (deficit <= 0) continue;

    const setsNeeded = Math.max(1, Math.ceil(deficit - CREDIT_EPSILON));

    // Best direct block: highest per-set credit to the group, then the most
    // target-sets headroom (a block with room for follow-ups beats one at the
    // cap's edge). Only fixes that BOTH stay small and fit the DB cap qualify.
    let best: { block: SuggestionBlock; credit: number; addSets: number } | null = null;
    for (const block of blocks) {
      const credit = blockGroupCredit(block, row.muscle);
      if (credit < DIRECT_CREDIT_THRESHOLD) continue;
      const addSets = Math.max(1, Math.ceil(deficit / credit - CREDIT_EPSILON));
      if (addSets > MAX_ADD_SETS_TO_BLOCK) continue;
      if (block.targetSets + addSets > MAX_TARGET_SETS) continue;
      if (
        !best ||
        credit > best.credit ||
        (credit === best.credit && block.targetSets < best.block.targetSets)
      ) {
        best = { block, credit, addSets };
      }
    }

    out.push({
      muscle: row.muscle,
      displayName: row.displayName,
      setsNeeded,
      action: best
        ? {
            kind: 'add_sets',
            blockId: best.block.blockId,
            exerciseName: best.block.exerciseName,
            addSets: best.addSets,
          }
        : { kind: 'add_exercise' },
    });
  }

  return out;
}
