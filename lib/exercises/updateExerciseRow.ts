/**
 * updateExerciseRow — the ONE write path for editing an `exercises` catalog
 * row from the app (workout-page edit form + library-page edit modal).
 *
 * Why it exists: RLS only allows UPDATE on rows where
 * `is_custom = TRUE AND created_by = auth.uid()` (20241212000001). For a
 * stock catalog row, PostgREST filters the row out of the update set and
 * returns SUCCESS WITH ZERO ROWS — supabase-js reports no error, so a bare
 * `.update().eq()` cannot tell "saved" from "silently discarded". Both edit
 * surfaces shipped exactly that bug (false "Exercise updated successfully!"
 * on stock exercises). This helper chains `.select('id')` so zero written
 * rows is a detectable, reportable outcome — never a fake success.
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
}

export type UpdateExerciseOutcome =
  /** The row was written and read back. */
  | 'updated'
  /**
   * The update matched ZERO rows: the exercise is a stock catalog row (or
   * someone else's custom row / a non-existent id), so RLS excluded it from
   * the update set. Nothing was saved.
   */
  | 'blocked'
  /** The request itself failed (constraint violation, network, …). */
  | 'error';

export interface UpdateExerciseResult {
  ok: boolean;
  outcome: UpdateExerciseOutcome;
  /** Human-readable reason when not ok. */
  message?: string;
}

/**
 * Update an exercises row and VERIFY the write landed. `ok: false` with
 * outcome `'blocked'` means the DB accepted the request but wrote nothing —
 * the caller must surface that as a visible failure, never as success.
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
  if (!data || data.length === 0) {
    return {
      ok: false,
      outcome: 'blocked',
      message:
        'Nothing was saved: this is a built-in catalog exercise (shared by every user), and only custom exercises you created can be edited.',
    };
  }
  return { ok: true, outcome: 'updated' };
}
