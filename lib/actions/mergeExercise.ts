/**
 * mergeExercise — collapse duplicate exercises created to encode gym-specific
 * machine load ("Seated Calf Raise (ameri fit)") into ONE canonical exercise,
 * with the duplicate's history repointed and location-stamped so it becomes a
 * per-location calibration track instead of a second exercise.
 *
 * This is the location-scoped-calibration counterpart to a plain duplicate
 * merge. Where a true-duplicate merge folds two histories into one shared load
 * trend, `mergeAsLocationVariant` folds the duplicate's history into the
 * survivor's *at a specific location*, so the survivor's own-location trend is
 * never polluted by the other implement's loads.
 *
 * Kept as a plain function that receives the Supabase client (like
 * sessionWrites.ts) so it is unit-testable and can run from a server action or
 * an admin/migration tool.
 */

/** Minimal chainable shape of the Supabase client this module needs. */
export interface MergeSupabase {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: { message: string } | null;
      }>;
    };
    update(values: Record<string, unknown>): {
      in(
        column: string,
        values: string[]
      ): PromiseLike<{ error: { message: string } | null }>;
      eq(
        column: string,
        value: string
      ): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

export interface MergeAsLocationVariantInput {
  /** The canonical exercise that survives the merge. */
  survivorId: string;
  /** The implement-variant duplicate being collapsed and soft-deleted. */
  duplicateId: string;
  /** The location whose calibration track the duplicate's history becomes. */
  locationId: string;
}

export interface MergeAsLocationVariantResult {
  ok: boolean;
  /** exercise_blocks repointed from the duplicate to the survivor. */
  blocksRepointed: number;
  /** set_logs stamped with the location. */
  setsStamped: number;
  error?: string;
}

/**
 * Merge a duplicate exercise into a survivor AS a location variant:
 *   1. find the duplicate's exercise_blocks,
 *   2. stamp `locationId` on every set_log under those blocks (the calibration
 *      key — this is what keeps the loads on the survivor's *other*-location
 *      trend untouched),
 *   3. repoint those blocks to the survivor exercise,
 *   4. soft-delete the duplicate exercise (exercises.deleted_at).
 *
 * Idempotent-ish: re-running after step 3 finds no more duplicate blocks and
 * only re-soft-deletes (a no-op). Order matters — sets are stamped by block id
 * BEFORE the blocks are repointed, so stamping targets exactly the duplicate's
 * history.
 */
export async function mergeAsLocationVariant(
  supabase: MergeSupabase,
  input: MergeAsLocationVariantInput,
  now: string = new Date().toISOString()
): Promise<MergeAsLocationVariantResult> {
  const { survivorId, duplicateId, locationId } = input;
  const result: MergeAsLocationVariantResult = {
    ok: false,
    blocksRepointed: 0,
    setsStamped: 0,
  };

  if (survivorId === duplicateId) {
    return { ...result, error: 'survivor and duplicate must differ' };
  }

  // 1. The duplicate's exercise blocks.
  const { data: blockRows, error: blocksError } = await supabase
    .from('exercise_blocks')
    .select('id')
    .eq('exercise_id', duplicateId);
  if (blocksError) return { ...result, error: blocksError.message };

  const blockIds = (blockRows ?? []).map((b) => String(b.id));

  // 2. Stamp the location onto the duplicate's set logs (by block id, before
  //    the blocks are repointed).
  if (blockIds.length > 0) {
    const { error: stampError } = await supabase
      .from('set_logs')
      .update({ location_id: locationId })
      .in('exercise_block_id', blockIds);
    if (stampError) return { ...result, error: stampError.message };
    // We stamp per block; the caller can count sets if it needs an exact number.
    result.setsStamped = blockIds.length;

    // 3. Repoint the duplicate's blocks to the survivor exercise.
    const { error: repointError } = await supabase
      .from('exercise_blocks')
      .update({ exercise_id: survivorId })
      .eq('exercise_id', duplicateId);
    if (repointError) return { ...result, error: repointError.message };
    result.blocksRepointed = blockIds.length;
  }

  // 4. Soft-delete the duplicate so it leaves the library/pickers but its rows
  //    (and any not-yet-repointed references) survive.
  const { error: deleteError } = await supabase
    .from('exercises')
    .update({ deleted_at: now })
    .eq('id', duplicateId);
  if (deleteError) return { ...result, error: deleteError.message };

  result.ok = true;
  return result;
}
