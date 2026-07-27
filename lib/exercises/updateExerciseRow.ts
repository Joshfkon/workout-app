/**
 * updateExerciseRow — the ONE write path for editing an `exercises` catalog
 * row from the app (workout-page edit form + library-page edit modal).
 *
 * Why it exists: RLS only allows direct UPDATE on rows where
 * `is_custom = TRUE AND created_by = auth.uid()` (20241212000001). For a
 * stock catalog row, PostgREST filters the row out of the update set and
 * returns SUCCESS WITH ZERO ROWS — supabase-js reports no error, so a bare
 * `.update().eq()` cannot tell "saved" from "silently discarded". Both edit
 * surfaces shipped exactly that bug (false "Exercise updated successfully!"
 * on stock exercises). This helper chains `.select('id')` so zero written
 * rows is detectable, and routes stock rows through the audited
 * `update_catalog_exercise` RPC (20260727000004) — whitelisted columns,
 * old values recorded in exercise_catalog_edit_audit, applied to the shared
 * catalog row for every user. Whatever happens, the outcome is reportable —
 * never a fake success.
 *
 * Kept as a plain function that receives the Supabase client (the
 * mergeExercise.ts pattern) so it is unit-testable against a fake client.
 */

/** Minimal chainable shape of the Supabase client this module needs. */
export interface UpdateExerciseSupabase {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(
        column: string,
        value: string
      ): {
        select(columns: string): PromiseLike<{
          data: Array<Record<string, unknown>> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  /** Optional so lean fakes/tests can model a DB without the RPC deployed. */
  rpc?(
    fn: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type UpdateExerciseOutcome =
  /** The user's own custom row was written directly and read back. */
  | 'updated'
  /**
   * A stock catalog row was written through the audited
   * update_catalog_exercise RPC — the change applies to EVERY user and the
   * previous values are in exercise_catalog_edit_audit.
   */
  | 'updated_catalog'
  /**
   * Nothing was written and no write path applies: the direct update
   * matched zero rows and the catalog RPC is unavailable on this client.
   */
  | 'blocked'
  /** A request failed (constraint violation, RPC rejection, network, …). */
  | 'error';

export interface UpdateExerciseResult {
  ok: boolean;
  outcome: UpdateExerciseOutcome;
  /** Human-readable reason when not ok. */
  message?: string;
}

/**
 * Update an exercises row and VERIFY the write landed. Direct update first
 * (covers the user's own custom rows under RLS); on a zero-row result, fall
 * back to the audited catalog RPC (covers stock rows). `ok: false` means
 * nothing was written — the caller must surface that as a visible failure,
 * never as success.
 */
export async function updateExerciseRow(
  supabase: UpdateExerciseSupabase,
  exerciseId: string,
  payload: Record<string, unknown>
): Promise<UpdateExerciseResult> {
  const { data, error } = await supabase
    .from('exercises')
    .update(payload)
    .eq('id', exerciseId)
    .select('id');

  if (error) {
    return { ok: false, outcome: 'error', message: error.message };
  }
  if (data && data.length > 0) {
    return { ok: true, outcome: 'updated' };
  }

  // Zero rows: not one of the user's custom rows. Try the audited catalog
  // write path (stock rows). The RPC itself re-validates everything —
  // whitelisted columns, not-custom, not-soft-deleted — and raises a
  // descriptive error otherwise.
  if (!supabase.rpc) {
    return {
      ok: false,
      outcome: 'blocked',
      message:
        'Nothing was saved: the update matched no rows you can edit, and the audited catalog write path is unavailable.',
    };
  }

  const rpcResult = await supabase.rpc('update_catalog_exercise', {
    p_exercise_id: exerciseId,
    p_patch: payload,
  });
  if (rpcResult.error) {
    return {
      ok: false,
      outcome: 'error',
      message: `Nothing was saved — catalog update failed: ${rpcResult.error.message}`,
    };
  }
  return { ok: true, outcome: 'updated_catalog' };
}
