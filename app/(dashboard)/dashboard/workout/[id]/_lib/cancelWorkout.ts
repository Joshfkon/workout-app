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
 * forever with its buttons disabled. On timeout the in-flight request is
 * ABORTED (not just abandoned) — a delete left running here could otherwise
 * land much later and hit rows created after the discard flow moved on; see
 * the mesocycle-path gating below. A backstop timer still guarantees
 * settlement even if a custom fetch ignores the abort signal.
 */
const OP_TIMEOUT_MS = 10_000;
const ABORT_BACKSTOP_MS = 1_000;

type OpResult = { error: { message: string } | null };

interface AbortableOp extends PromiseLike<OpResult> {
  abortSignal(signal: AbortSignal): PromiseLike<OpResult>;
}

function settleWithTimeout(op: AbortableOp, ms: number): Promise<OpResult> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), ms);
    // Abort makes fetch reject immediately, so this backstop only fires if
    // the op's fetch doesn't honor the signal at all.
    const backstopTimer = setTimeout(
      () => resolve({ error: { message: `request timed out after ${ms}ms` } }),
      ms + ABORT_BACKSTOP_MS
    );
    const settle = (result: OpResult) => {
      clearTimeout(abortTimer);
      clearTimeout(backstopTimer);
      resolve(result);
    };
    op.abortSignal(controller.signal).then(
      (value) => settle(value),
      (err) =>
        settle({
          error: {
            message: controller.signal.aborted
              ? `request timed out after ${ms}ms`
              : err instanceof Error
                ? err.message
                : String(err),
          },
        })
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
    // Ad-hoc: blocks and the session itself are deleted, so even if an
    // earlier delete failed, finishing the teardown can't strand anything a
    // future workout would reuse (a restarted workout gets fresh ids).
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
  } else if (errors.length === 0) {
    // Mesocycle: only make the session restartable when the cleanup above
    // actually succeeded. The session KEEPS its id and exercise_blocks after
    // the reset, so if a delete above failed we must not invite a restart:
    // a delete that somehow still completes server-side later would match
    // the restarted workout's rows (same block/session ids) and destroy them.
    // Returning ok=false instead keeps the session in progress for a retry.
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
