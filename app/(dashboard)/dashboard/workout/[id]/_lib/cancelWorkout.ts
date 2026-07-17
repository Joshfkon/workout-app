/**
 * cancelWorkout.ts
 *
 * DB cleanup for cancelling an in-progress workout, extracted from the page's
 * handleCancelWorkout so it can be unit tested.
 *
 * Kept as a plain function that receives the supabase client so the page stays
 * 'use client'. It surfaces errors (returns them) rather than swallowing.
 */

type UntypedClient = ReturnType<
  typeof import('@/lib/supabase/client').createUntypedClient
>;

export interface CancelWorkoutArgs {
  sessionId: string;
  /** null for ad-hoc (blank/quick/AI) sessions. */
  mesocycleId: string | null;
  /** exercise_block ids belonging to this session. */
  blockIds: string[];
}

/**
 * A fetch that never settles (dead radio, hung proxy) must not wedge the
 * discard flow: without a cap, the awaiting UI stays on "Discarding..."
 * forever with its buttons disabled. Cap every operation and surface the
 * timeout (or a rejection) as an ordinary error so the caller resets and
 * offers a retry. Late server-side success is harmless — every operation
 * here is idempotent.
 */
const OP_TIMEOUT_MS = 10_000;

type OpResult = { error: { message: string } | null };

function settleWithTimeout(
  op: PromiseLike<OpResult>,
  ms: number
): Promise<OpResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ error: { message: `request timed out after ${ms}ms` } }),
      ms
    );
    op.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        resolve({
          error: { message: err instanceof Error ? err.message : String(err) },
        });
      }
    );
  });
}

/**
 * Discard an in-progress workout:
 *   - Ad-hoc session: delete set logs, blocks, and the session itself so it
 *     can't resurface as a pre-loaded "blank" workout later today.
 *   - Mesocycle session: delete set logs but keep the programmed plan
 *     restartable — reset the session back to planned with its blocks intact.
 *
 * In BOTH cases the session's amrap_calibrations rows are deleted first. Their
 * FKs (workout_session_id, set_log_id) are ON DELETE SET NULL, so without this
 * step a cancelled AMRAP-containing workout leaves calibration rows behind:
 * fully detached (both FKs null) on the ad-hoc path, or pointing at a planned
 * session whose sets no longer exist on the mesocycle path. Either way they
 * describe discarded sets and no in-app path could ever remove them.
 */
export async function cancelWorkoutSession(
  supabase: UntypedClient,
  args: CancelWorkoutArgs,
  opts?: { timeoutMs?: number }
): Promise<{ ok: boolean; errors: string[] }> {
  const { sessionId, mesocycleId, blockIds } = args;
  const timeoutMs = opts?.timeoutMs ?? OP_TIMEOUT_MS;
  const errors: string[] = [];

  // Must run BEFORE the set_logs / workout_sessions deletes below — once those
  // rows are gone the SET NULL FKs make these calibrations unreachable.
  {
    const { error } = await settleWithTimeout(
      supabase
        .from('amrap_calibrations')
        .delete()
        .eq('workout_session_id', sessionId),
      timeoutMs
    );
    if (error) errors.push(error.message);
  }

  if (blockIds.length > 0) {
    const { error } = await settleWithTimeout(
      supabase.from('set_logs').delete().in('exercise_block_id', blockIds),
      timeoutMs
    );
    if (error) errors.push(error.message);
  }

  if (!mesocycleId) {
    if (blockIds.length > 0) {
      const { error } = await settleWithTimeout(
        supabase.from('exercise_blocks').delete().in('id', blockIds),
        timeoutMs
      );
      if (error) errors.push(error.message);
    }
    const { error } = await settleWithTimeout(
      supabase.from('workout_sessions').delete().eq('id', sessionId),
      timeoutMs
    );
    if (error) errors.push(error.message);
  } else {
    const { error } = await settleWithTimeout(
      supabase
        .from('workout_sessions')
        .update({
          state: 'planned',
          started_at: null,
          pre_workout_check_in: null,
        })
        .eq('id', sessionId),
      timeoutMs
    );
    if (error) errors.push(error.message);
  }

  return { ok: errors.length === 0, errors };
}
