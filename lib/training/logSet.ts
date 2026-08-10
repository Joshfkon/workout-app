/**
 * Set writes — the canonical log / edit / delete path for a working set.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * This logic used to live inside `handleSetComplete` / `handleSetEdit` /
 * `handleDeleteSet` in the 7k-line workout page, tangled with rest timers,
 * toasts, dropset chaining and motion capture. That made it unreachable from
 * anything but a mounted React tree — so a headless simulated user could not
 * log a set at all without reimplementing the rules, which is exactly what a
 * state-integrity harness must never do.
 *
 * The cut is: DOMAIN here, CHOREOGRAPHY in the component.
 *
 *   here  — set quality, set-number resolution, set-role inference, row and
 *           SetLog construction, and persistence (direct insert, offline
 *           outbox, migration-lag retry, rollback signalling).
 *   there — rest timers, dropset/superset advance, toasts, motion capture,
 *           sanity-check display, AMRAP calibration, timing instrumentation.
 *
 * The UI and the headless driver call the SAME functions here; the component
 * layers its choreography on top. Optimistic local state stays a component
 * concern, but its ORDERING is domain-relevant (local state must land before
 * any network work, and unwind on a real rejection), so `logSet` invokes it
 * through callbacks at the right moments — the pattern `submitFinishOptimistic`
 * already established in this codebase.
 */
import type { SetLog, SetType, SetQuality, SetFeedback, BodyweightData, RepsInTank } from '@/types/schema';
import { rirToRpe } from '@/types/schema';
import { inferSetRole, sessionTopSetWeightKg } from '@/services/suggestionEngine/setRoles';
import { SUGGESTION_ENGINE_VERSION } from '@/services/suggestionEngine/constants';
import {
  enqueueSetInsert,
  updateQueuedSet,
  removeQueuedSet,
  isNetworkError,
  isMissingColumnError,
  withoutOptionalSetLogColumns,
} from '@/lib/offline/setOutbox';
import { now as clockNow } from '@/lib/clock';

/**
 * The Supabase client these writes read/write through. Untyped by construction,
 * matching the convention in the sibling workout write modules
 * (`_lib/finishWorkout`, `_lib/adhocSession`) — the generated Database types
 * don't line up with the runtime shapes on insert/update.
 */
export type SetWriteClient = ReturnType<
  typeof import('@/lib/supabase/client').createUntypedClient
>;

export type SetSyncState = 'saving' | 'saved' | 'queued';

/**
 * Instrumentation checkpoints this module emits. Deliberately a subset of
 * `lib/debug/setLogTiming.SetLogPhase` (the page's marker takes that union),
 * naming only the phases the write path itself passes through — the phases
 * around it belong to the caller.
 */
export type LogSetPhase =
  | 'probe_sent'
  | 'probe_done'
  | 't1_local_commit'
  | 't2_outbox_enqueued'
  | 't3_insert_sent'
  | 't4_insert_done';

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

/**
 * Set quality from effort and form.
 *
 * Ugly form outranks RPE: a set ground out with breakdown is junk regardless
 * of how hard it felt. Otherwise this is the RPE banding documented in
 * types/schema — stimulative 7.5–9.5, junk at or below 5, effective between.
 */
export function classifySetQuality(input: {
  rpe: number;
  form?: SetFeedback['form'];
}): { quality: SetQuality; qualityReason: string } {
  const { rpe, form } = input;

  let quality: SetQuality;
  if (form === 'ugly') {
    quality = 'junk';
  } else if (rpe >= 7.5 && rpe <= 9.5) {
    quality = 'stimulative';
  } else if (rpe <= 5) {
    quality = 'junk';
  } else {
    quality = 'effective';
  }

  const qualityReason = form
    ? form === 'clean'
      ? 'Clean form'
      : form === 'some_breakdown'
        ? 'Some form breakdown'
        : 'Form breakdown'
    : '';

  return { quality, qualityReason };
}

/**
 * The set number to write.
 *
 * The database's max is preferred (it accounts for sets logged by another tab
 * or device), but it is FLOORED at the local number: a set still sitting in
 * the offline outbox has not reached the DB yet, so the max would hand back a
 * number that set already claimed and the insert would collide on
 * `UNIQUE(exercise_block_id, set_number)`.
 */
export function resolveSetNumber(localNext: number, dbMaxSetNumber: number | null): number {
  if (dbMaxSetNumber == null) return localNext;
  return Math.max(localNext, dbMaxSetNumber + 1);
}

export interface BuildSetLogInput {
  setId: string;
  exerciseBlockId: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  rpe: number;
  loggedAt: string;
  setType: SetType;
  /** Working sets already logged for this block — the set-role comparison pool. */
  blockWorkingSets: { weightKg: number }[];
  locationId?: string | null;
  parentSetId?: string | null;
  note?: string | null;
  feedback?: SetFeedback;
  bodyweightData?: BodyweightData;
}

/**
 * The DB row and the in-memory `SetLog` for one logged set, built together so
 * they cannot drift.
 *
 * The set ROLE (working vs ramp) is provisional at log time: a heavier set
 * later in the session can't retro-relabel this row live, and the set_roles
 * migration recomputes roles authoritatively once the session is complete.
 */
export function buildSetLog(input: BuildSetLogInput): {
  row: Record<string, unknown>;
  set: SetLog;
} {
  const { quality, qualityReason } = classifySetQuality({
    rpe: input.rpe,
    form: input.feedback?.form,
  });

  const blockTopKg = sessionTopSetWeightKg([
    ...input.blockWorkingSets,
    { weightKg: input.weightKg },
  ]);
  const setRole = input.weightKg > 0 ? inferSetRole(input.weightKg, blockTopKg) : 'working';

  const row: Record<string, unknown> = {
    id: input.setId,
    exercise_block_id: input.exerciseBlockId,
    set_number: input.setNumber,
    weight_kg: input.weightKg,
    reps: input.reps,
    set_type: input.setType,
    set_role: setRole,
    suggestion_engine_version: SUGGESTION_ENGINE_VERSION,
    location_id: input.locationId ?? null,
    parent_set_id: input.parentSetId ?? null,
    rpe: input.rpe,
    is_warmup: false,
    quality,
    quality_reason: qualityReason,
    note: input.note ?? null,
    logged_at: input.loggedAt,
    feedback: input.feedback ? JSON.stringify(input.feedback) : null,
    bodyweight_data: input.bodyweightData ? JSON.stringify(input.bodyweightData) : null,
  };

  const set: SetLog = {
    id: input.setId,
    exerciseBlockId: input.exerciseBlockId,
    setNumber: input.setNumber,
    weightKg: input.weightKg,
    reps: input.reps,
    rpe: input.rpe,
    restSeconds: null,
    isWarmup: false,
    setType: input.setType,
    setRole,
    suggestionEngineVersion: SUGGESTION_ENGINE_VERSION,
    parentSetId: input.parentSetId ?? null,
    quality,
    qualityReason,
    note: input.note ?? null,
    loggedAt: input.loggedAt,
    feedback: input.feedback,
    bodyweightData: input.bodyweightData,
  };

  return { row, set };
}

/**
 * The patch an edit applies, plus the feedback object to keep in local state.
 *
 * Keeping `feedback.repsInTank` consistent with the edited effort is fiddly on
 * purpose. An explicit RIR chip is stored exactly. Otherwise RIR is re-derived
 * from RPE ONLY when the new RPE disagrees with the stored RIR: the round trip
 * is lossy (RIR 2 → RPE 7.5 → round(2.5) = 3), so rewriting unconditionally
 * would mutate RIR on a weight-only or reps-only edit.
 */
export function buildSetEditPatch(
  existing: Pick<SetLog, 'feedback' | 'bodyweightData'> | undefined,
  data: {
    weightKg: number;
    reps: number;
    rpe: number;
    repsInTank?: RepsInTank;
    bodyweightData?: BodyweightData;
  }
): {
  patch: Record<string, unknown>;
  quality: SetQuality;
  feedback?: SetFeedback;
  bodyweightData?: BodyweightData;
} {
  const { quality } = classifySetQuality({ rpe: data.rpe });
  const bodyweightData = data.bodyweightData || existing?.bodyweightData;

  const feedback: SetFeedback | undefined =
    data.repsInTank !== undefined
      ? existing?.feedback && existing.feedback.repsInTank !== data.repsInTank
        ? { ...existing.feedback, repsInTank: data.repsInTank }
        : undefined
      : existing?.feedback && rirToRpe(existing.feedback.repsInTank) !== data.rpe
        ? {
            ...existing.feedback,
            repsInTank: Math.max(0, Math.min(4, Math.round(10 - data.rpe))) as RepsInTank,
          }
        : undefined;

  const patch: Record<string, unknown> = {
    weight_kg: data.weightKg,
    reps: data.reps,
    rpe: data.rpe,
    quality,
  };
  if (bodyweightData) patch.bodyweight_data = bodyweightData;
  if (feedback) patch.feedback = JSON.stringify(feedback);

  return { patch, quality, feedback, bodyweightData };
}

/**
 * Renumber a block's working sets to a dense 1..n after a deletion.
 *
 * KNOWN DIVERGENCE (audit finding B1, tracked separately — deliberately NOT
 * fixed here): production applies this to LOCAL state only. No `set_number`
 * UPDATE is issued, so the database keeps its gaps and in-memory numbering
 * disagrees with persisted numbering until the session is reloaded. This
 * function reproduces the existing behaviour exactly; changing it is a
 * behaviour change and belongs in its own fix.
 */
export function renumberBlockSets(sets: SetLog[], blockId: string): SetLog[] {
  let n = 1;
  return sets.map((set) => {
    if (set.exerciseBlockId === blockId && !set.isWarmup && set.setType !== 'warmup') {
      return { ...set, setNumber: n++ };
    }
    return set;
  });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Highest existing working-set number for a block, or null when unknown. */
export async function probeMaxSetNumber(
  supabase: SetWriteClient,
  exerciseBlockId: string
): Promise<number | null> {
  try {
    const { data } = await supabase
      .from('set_logs')
      .select('set_number')
      .eq('exercise_block_id', exerciseBlockId)
      .eq('is_warmup', false)
      .order('set_number', { ascending: false })
      .limit(1)
      .single();
    return data?.set_number ?? null;
  } catch {
    // Numbering probe failed (flaky network) — local numbering is fine.
    return null;
  }
}

export interface LogSetDeps {
  supabase: SetWriteClient;
  /**
   * Connectivity. Defaults to `navigator.onLine` where a navigator exists and
   * to `true` otherwise, so a headless run is online unless it says otherwise.
   */
  online?: boolean;
  /**
   * Apply the set to local state. Called BEFORE any network work — the UI must
   * never wait on the write, and Zustand-persist recovery must not depend on
   * it landing.
   */
  applyOptimistic?: (set: SetLog) => void;
  /** Undo `applyOptimistic`. Called only on a real server rejection. */
  rollbackOptimistic?: (set: SetLog) => void;
  /** Sync-status transitions for the per-set indicator. */
  onSyncState?: (setId: string, state: SetSyncState) => void;
  /** Instrumentation hook (setLogTiming marks). Never affects behaviour. */
  onPhase?: (phase: LogSetPhase) => void;
}

export interface LogSetInput extends Omit<BuildSetLogInput, 'setId' | 'setNumber' | 'loggedAt'> {
  /**
   * Client-generated id — also the IDEMPOTENCY KEY. Supplying it is what makes
   * a retry safe: the outbox upserts on `id` with `ignoreDuplicates`, so a
   * re-send of the same operation is a no-op rather than a duplicate set. A
   * caller that omits it gets a fresh uuid and therefore a fresh operation.
   */
  setId?: string;
  /** Next set number per local state; the DB max floors at this (resolveSetNumber). */
  localNextSetNumber: number;
  /** Defaults to the application clock. */
  loggedAt?: string;
}

export type LogSetResult =
  | { status: 'saved' | 'queued'; set: SetLog; row: Record<string, unknown> }
  | { status: 'rejected'; set: SetLog; error: { message: string; code?: string } };

function defaultOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/**
 * Log one working set: resolve its number, build it, apply it optimistically,
 * then persist it (or queue it when offline).
 *
 * `status`:
 *   'saved'    — the row is in the database.
 *   'queued'   — the row is durably in the outbox and will flush later. The
 *                optimistic state STAYS; this is a success for the caller.
 *   'rejected' — the server refused the row. The optimistic state has already
 *                been rolled back via `rollbackOptimistic`.
 */
export async function logSet(deps: LogSetDeps, input: LogSetInput): Promise<LogSetResult> {
  const { supabase } = deps;
  const online = deps.online ?? defaultOnline();
  const setId = input.setId ?? crypto.randomUUID();
  const loggedAt = input.loggedAt ?? clockNow().toISOString();

  let setNumber = input.localNextSetNumber;
  if (online) {
    deps.onPhase?.('probe_sent');
    setNumber = resolveSetNumber(
      input.localNextSetNumber,
      await probeMaxSetNumber(supabase, input.exerciseBlockId)
    );
    deps.onPhase?.('probe_done');
  }

  const { row, set } = buildSetLog({ ...input, setId, setNumber, loggedAt });

  deps.applyOptimistic?.(set);
  deps.onSyncState?.(setId, 'saving');
  deps.onPhase?.('t1_local_commit');

  if (!online) {
    await enqueueSetInsert(setId, row);
    deps.onPhase?.('t2_outbox_enqueued');
    deps.onSyncState?.(setId, 'queued');
    return { status: 'queued', set, row };
  }

  let insertError: { message: string; code?: string } | null = null;
  deps.onPhase?.('t3_insert_sent');
  try {
    const result = await supabase.from('set_logs').insert(row);
    insertError = result.error;
    // Schema-cache column miss (a migration not yet applied to this database):
    // drop the optional columns and retry once, so migration lag can't block
    // set logging mid-workout.
    if (insertError && isMissingColumnError(insertError)) {
      const retry = await supabase.from('set_logs').insert(withoutOptionalSetLogColumns(row));
      insertError = retry.error;
    }
  } catch (e) {
    insertError = { message: e instanceof Error ? e.message : String(e) };
  }
  deps.onPhase?.('t4_insert_done');

  if (insertError && isNetworkError(insertError)) {
    // Connectivity died mid-write: queue it and keep the optimistic state.
    await enqueueSetInsert(setId, row);
    deps.onPhase?.('t2_outbox_enqueued');
    deps.onSyncState?.(setId, 'queued');
    return { status: 'queued', set, row };
  }

  if (insertError) {
    deps.rollbackOptimistic?.(set);
    return { status: 'rejected', set, error: insertError };
  }

  deps.onSyncState?.(setId, 'saved');
  return { status: 'saved', set, row };
}

export interface EditSetResult {
  /** True when the edit was merged into a still-queued insert instead of sent. */
  queued: boolean;
  error?: { message: string };
}

/**
 * Persist an edit to an already-logged set.
 *
 * A set that never left the outbox is patched in place (edit-before-sync), so
 * the eventual insert carries the edited values rather than the original ones
 * followed by an update that may never land.
 *
 * The `edited_at` stamp is a SEPARATE statement, matching production: it is
 * dormant until the migration adding the column is applied, and a failure to
 * stamp must not fail the edit. (Audit finding B4 notes the non-atomicity —
 * a lost stamp means the stale-target recalc prompt is skipped. Preserved
 * as-is here; fixing it is its own change.)
 */
export async function persistSetEdit(
  deps: { supabase: SetWriteClient },
  args: { setId: string; patch: Record<string, unknown>; editedAt?: string }
): Promise<EditSetResult> {
  const { supabase } = deps;

  if (await updateQueuedSet(args.setId, args.patch)) {
    return { queued: true };
  }

  const { error } = await supabase.from('set_logs').update(args.patch).eq('id', args.setId);
  if (error) return { queued: false, error };

  const editedAt = args.editedAt ?? clockNow().toISOString();
  try {
    await supabase.from('set_logs').update({ edited_at: editedAt }).eq('id', args.setId);
  } catch {
    // Column not present yet — the edit itself already landed.
  }
  return { queued: false };
}

/**
 * Delete a logged set. A set still in the outbox is simply dropped from the
 * queue; anything else is a HARD delete — `set_logs` has no soft-delete column
 * and never has (audit finding H3), so callers must not assume one.
 */
export async function persistSetDelete(
  deps: { supabase: SetWriteClient },
  setId: string
): Promise<{ queued: boolean; error?: { message: string } }> {
  if (await removeQueuedSet(setId)) return { queued: true };

  const { error } = await deps.supabase.from('set_logs').delete().eq('id', setId);
  return { queued: false, ...(error ? { error } : {}) };
}
