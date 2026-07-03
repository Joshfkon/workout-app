/**
 * P1-3 recalc detection (detection A): a planned session's target derives from
 * "since-edited" history iff one of that exercise's completed-session sets was
 * edited (`set_logs.edited_at`) AFTER the planned block's target was computed
 * (`exercise_blocks.created_at`). Pure so it's unit-testable without the DB.
 *
 * Mitigation (a) note: there is no UI to manually override a block's target
 * weight (targets are always progression-engine output), so "recalc only
 * untouched blocks" is trivially ALL stale blocks — no per-block "manually
 * set" tracking is needed. The recalc still shows a confirm dialog listing
 * every old -> new change.
 */

export interface PlannedTargetBlock {
  id: string;
  exerciseId: string;
  exerciseName: string;
  /** ISO timestamp the block's target was computed (exercise_blocks.created_at). */
  createdAt: string;
  /** Current stored target weight (kg). */
  targetWeightKg: number;
}

/** True iff the exercise's latest historical edit postdates the block's target. */
export function isTargetStale(blockCreatedAt: string, latestEditedAtForExercise: string | null | undefined): boolean {
  if (!latestEditedAtForExercise) return false;
  const edited = new Date(latestEditedAtForExercise).getTime();
  const created = new Date(blockCreatedAt).getTime();
  if (Number.isNaN(edited) || Number.isNaN(created)) return false;
  return edited > created;
}

/**
 * Which planned blocks have targets derived from since-edited data.
 * `latestEditByExerciseId` maps exerciseId -> the most recent edited_at across
 * that exercise's completed-session sets (null/absent = no edits).
 */
export function findStaleTargetBlocks(
  blocks: PlannedTargetBlock[],
  latestEditByExerciseId: Record<string, string | null>
): PlannedTargetBlock[] {
  return blocks.filter((b) => isTargetStale(b.createdAt, latestEditByExerciseId[b.exerciseId]));
}

export interface RecalcChange {
  blockId: string;
  exerciseName: string;
  oldKg: number;
  newKg: number;
}

/**
 * Recompute targets for the stale blocks via the caller-supplied estimator
 * (the same progression/weight-estimation engine used at build time, now fed
 * the corrected history). Only meaningful changes are returned (>= 0.5kg) so
 * the confirm dialog isn't cluttered with no-ops. `estimate` returning 0 means
 * "no confident estimate" and is dropped.
 */
export function computeRecalcChanges(
  blocks: PlannedTargetBlock[],
  estimate: (block: PlannedTargetBlock) => number
): RecalcChange[] {
  return blocks
    .map((b) => ({ blockId: b.id, exerciseName: b.exerciseName, oldKg: b.targetWeightKg, newKg: estimate(b) }))
    .filter((c) => c.newKg > 0 && Math.abs(c.newKg - c.oldKg) >= 0.5);
}
