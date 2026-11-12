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
  enqueueRowUpdate,
  enqueueRowDelete,
  getQueuedEntry,
  updateQueuedSet,
  removeQueuedSet,
  removeQueuedEntryIfUnchanged,
  isPermanentRejection,
  isMissingColumnError,
  withoutOptionalSetLogColumns,
  withTimeout,
  OP_TIMEOUT_MS,
  trackDirectWrite,
  directWriteInFlight,
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

  // A changed RIR is the lifter's own, never the sensor prefill any more.
  const withRir = (repsInTank: RepsInTank): SetFeedback => {
    const { rirSource: _sensor, ...rest } = existing!.feedback!;
    return { ...rest, repsInTank };
  };
  const feedback: SetFeedback | undefined =
    data.repsInTank !== undefined
      ? existing?.feedback && existing.feedback.repsInTank !== data.repsInTank
        ? withRir(data.repsInTank)
        : undefined
      : existing?.feedback && rirToRpe(existing.feedback.repsInTank) !== data.rpe
        ? withRir(Math.max(0, Math.min(4, Math.round(10 - data.rpe))) as RepsInTank)
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

/** A set whose `set_number` must move, and where it must move to. */
export interface SetNumberChange {
  id: string;
  setNumber: number;
}

/** Only working sets carry a 1..n `set_number`; warmups are numbered separately. */
function isWorkingSet(set: Pick<SetLog, 'isWarmup' | 'setType'>): boolean {
  return !set.isWarmup && set.setType !== 'warmup';
}

/**
 * The number the next set logged against `blockId` should take.
 *
 * A block's working sets are DENSE by construction — `planBlockRenumber`
 * compacts them to 1..n after every deletion — so the next number is one past
 * the COUNT, never one past the highest number previously handed out.
 *
 * That distinction is the whole point of this function. The workout page used
 * to feed the write path a running counter that only ever incremented, so a
 * deleted set's number stayed spent: log 1, log 2, delete 2, and the counter
 * still sitting at 3 gave the next set the number 3. The user saw "Set 1,
 * Set 3" and every later set inherited the offset. Counting live sets instead
 * makes the number self-correcting — there is no state to drift.
 */
export function nextSetNumberForBlock(sets: SetLog[], blockId: string): number {
  return sets.filter((s) => s.exerciseBlockId === blockId && isWorkingSet(s)).length + 1;
}

/**
 * Renumber a block's working sets to a dense 1..n after a deletion, and say
 * which rows actually moved.
 *
 * `changes` is ordered by ASCENDING new number, and that ordering is a
 * correctness requirement rather than tidiness. `set_logs` carries
 * `UNIQUE (exercise_block_id, set_number)`, so the updates cannot be applied in
 * arbitrary order — one would land on a slot still occupied by a row that has
 * not moved yet. Compaction only ever moves numbers DOWN into slots a deletion
 * vacated, so applying in ascending target order means every target is free by
 * the time it is written:
 *
 *   1,2,3,4  delete 2  →  3→2 (slot 2 freed by the delete),
 *                         4→3 (slot 3 freed by the previous move)
 *
 * Feed `changes` to `persistSetRenumber` in the order given.
 */
export function planBlockRenumber(
  sets: SetLog[],
  blockId: string
): { sets: SetLog[]; changes: SetNumberChange[] } {
  let n = 1;
  const changes: SetNumberChange[] = [];
  const renumbered = sets.map((set) => {
    if (set.exerciseBlockId === blockId && isWorkingSet(set)) {
      const setNumber = n++;
      if (setNumber !== set.setNumber) changes.push({ id: set.id, setNumber });
      return { ...set, setNumber };
    }
    return set;
  });
  return { sets: renumbered, changes };
}

/** The renumbered sets alone — see `planBlockRenumber` for the changes. */
export function renumberBlockSets(sets: SetLog[], blockId: string): SetLog[] {
  return planBlockRenumber(sets, blockId).sets;
}

/** What a deletion does to a session's sets. Null when the set isn't there. */
export interface SetDeletionPlan {
  exerciseBlockId: string;
  /** All sets after removing the target and compacting its block. */
  sets: SetLog[];
  /** Rows whose `set_number` must move, in the order they must be written. */
  changes: SetNumberChange[];
}

/**
 * THE deletion rule: a set leaves, and its block compacts to a dense 1..n.
 *
 * Pure, and shared by every caller — the workout page and the headless driver
 * both plan a deletion through this rather than composing "filter, then
 * renumber" themselves. Two callers each assembling those steps is how the
 * harness ends up measuring different semantics from the app, which makes its
 * findings fiction.
 */
export function planSetDeletion(sets: SetLog[], setId: string): SetDeletionPlan | null {
  const target = sets.find((s) => s.id === setId);
  if (!target) return null;
  const plan = planBlockRenumber(
    sets.filter((s) => s.id !== setId),
    target.exerciseBlockId
  );
  return { exerciseBlockId: target.exerciseBlockId, ...plan };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Outbox entry id for a queued EDIT of a set whose row is already on the
 * server (the set's own id is reserved for its queued insert / delete).
 */
export function setEditEntryId(setId: string): string {
  return `set-edit:${setId}`;
}

/**
 * How long logging a set may wait on the numbering probe. The probe only
 * matters when another tab/device logged to the same block; local numbering
 * is correct otherwise, so on a slow connection it is not worth holding the
 * set out of local state — and out of the durable queue — for.
 */
export const SET_NUMBER_PROBE_TIMEOUT_MS = 1500;

/**
 * False only when the platform positively reports no connectivity. A runtime
 * with no `navigator`, or one whose `navigator.onLine` is undefined (Node),
 * is treated as online.
 */
function knownOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

type WriteError = { message: string; code?: string };

/** Run a direct write with the outbox's timeout; a thrown failure becomes an error value. */
async function directWrite(
  op: () => PromiseLike<{ error: WriteError | null }>
): Promise<WriteError | null> {
  try {
    const { error } = await withTimeout(op(), OP_TIMEOUT_MS);
    return error ?? null;
  } catch (e) {
    return { message: e instanceof Error ? e.message : String(e) };
  }
}

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
  /** Cap on the numbering probe. Defaults to SET_NUMBER_PROBE_TIMEOUT_MS. */
  probeTimeoutMs?: number;
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

/** The numbering probe, capped: a slow answer is treated as no answer. */
async function probeMaxSetNumberWithin(
  supabase: SetWriteClient,
  exerciseBlockId: string,
  timeoutMs: number
): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([probeMaxSetNumber(supabase, exerciseBlockId), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Log one working set: resolve its number, build it, apply it optimistically,
 * make it durable, then persist it.
 *
 * WRITE-AHEAD. The row goes into the outbox BEFORE the network insert and is
 * taken out again when the insert succeeds. A set therefore exists in durable
 * local storage from a few milliseconds after the tap, whatever happens to
 * the request — a webview killed mid-insert on one bar of signal reopens with
 * the set still queued. The only wait before that point is the numbering
 * probe, which is capped (`SET_NUMBER_PROBE_TIMEOUT_MS`).
 *
 * `status`:
 *   'saved'    — the row is in the database.
 *   'queued'   — the row is durably in the outbox and will flush later. The
 *                optimistic state STAYS; this is a success for the caller.
 *                Any failure that is not the server refusing the row —
 *                connectivity, a timeout, a 5xx, an expired token — lands
 *                here, never in 'rejected'.
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
      await probeMaxSetNumberWithin(
        supabase,
        input.exerciseBlockId,
        deps.probeTimeoutMs ?? SET_NUMBER_PROBE_TIMEOUT_MS
      )
    );
    deps.onPhase?.('probe_done');
  }

  const { row, set } = buildSetLog({ ...input, setId, setNumber, loggedAt });

  deps.applyOptimistic?.(set);
  deps.onSyncState?.(setId, 'saving');
  deps.onPhase?.('t1_local_commit');

  // Durability first. If the outbox itself is unusable (broken IndexedDB) an
  // online set still goes straight to the server; an offline one has nowhere
  // to live and is reported as not saved rather than shown as if it were.
  let enqueued = true;
  let enqueueError: unknown = null;
  try {
    await enqueueSetInsert(setId, row);
    deps.onPhase?.('t2_outbox_enqueued');
  } catch (e) {
    enqueued = false;
    enqueueError = e;
  }
  const notStored = (): LogSetResult => {
    deps.rollbackOptimistic?.(set);
    return {
      status: 'rejected',
      set,
      error: {
        message:
          enqueueError instanceof Error
            ? `Could not store the set on this device: ${enqueueError.message}`
            : 'Could not store the set on this device',
      },
    };
  };

  if (!online) {
    if (!enqueued) return notStored();
    deps.onSyncState?.(setId, 'queued');
    return { status: 'queued', set, row };
  }

  deps.onPhase?.('t3_insert_sent');
  // Registered as in flight so (a) the outbox flush does not send the same
  // row in parallel and (b) a delete of this set waits for the insert to
  // settle — otherwise the delete could reach the server BEFORE the insert it
  // is meant to undo, and the set would come back.
  const attempt = (async (): Promise<WriteError | null> => {
    let error = await directWrite(() => supabase.from('set_logs').insert(row));
    // Schema-cache column miss (a migration not yet applied to this database):
    // drop the optional columns and retry once, so migration lag can't block
    // set logging mid-workout.
    if (error && isMissingColumnError(error)) {
      error = await directWrite(() =>
        supabase.from('set_logs').insert(withoutOptionalSetLogColumns(row))
      );
    }
    return error;
  })();
  const insertError = await trackDirectWrite(setId, attempt);
  deps.onPhase?.('t4_insert_done');

  // The write-ahead entry can be delivered by an outbox flush (5 s poll, the
  // dashboard's reconnect flush, a motion-capture save) while this insert is
  // still on the wire. The insert then collides with its OWN row — which is
  // the set being saved, not the server refusing it.
  let landed = !insertError;
  if (insertError?.code === '23505') {
    landed =
      /pkey|\(id\)/i.test(insertError.message ?? '') ||
      (enqueued && !(await getQueuedEntry(setId)));
  }

  if (landed) {
    // Take the entry back out — unless it changed while the insert was in
    // flight (an edit patched it): that newer write still has to go out.
    const left = enqueued ? await removeQueuedEntryIfUnchanged(setId, row) : 'absent';
    if (left === 'kept') {
      deps.onSyncState?.(setId, 'queued');
      return { status: 'queued', set, row };
    }
    deps.onSyncState?.(setId, 'saved');
    return { status: 'saved', set, row };
  }

  if (insertError && isPermanentRejection(insertError)) {
    if (enqueued) await removeQueuedSet(setId);
    deps.rollbackOptimistic?.(set);
    return { status: 'rejected', set, error: insertError };
  }

  // Connectivity died mid-write, the request timed out, the server is having
  // a moment: the row is already queued — keep the optimistic state.
  if (!enqueued) {
    try {
      await enqueueSetInsert(setId, row);
      deps.onPhase?.('t2_outbox_enqueued');
    } catch (e) {
      enqueueError = e;
      return notStored();
    }
  }
  deps.onSyncState?.(setId, 'queued');
  return { status: 'queued', set, row };
}

export interface EditSetResult {
  /** True when the edit is waiting in the outbox instead of having been sent. */
  queued: boolean;
  error?: { message: string };
}

/**
 * Persist an edit to an already-logged set.
 *
 * Where the edit goes depends on where the set is:
 *
 *  - its INSERT is still queued → the queue entry is patched (and marked
 *    dirty, so the flush also UPDATEs the row in case the insert had already
 *    landed with the old values);
 *  - an earlier EDIT of it is still queued → merged into that entry, so a
 *    stale queued patch can never overwrite a newer direct write;
 *  - otherwise → sent. If it cannot be delivered right now (offline, timeout,
 *    5xx, expired token) it is QUEUED rather than dropped: local state has
 *    already changed and must not silently diverge from the server. Only a
 *    real server refusal comes back as `error`.
 *
 * The `edited_at` stamp is a SEPARATE statement, matching production: it is
 * dormant until the migration adding the column is applied, and a failure to
 * stamp must not fail the edit. (Audit finding B4 notes the non-atomicity —
 * a lost stamp means the stale-target recalc prompt is skipped. Preserved
 * as-is here; fixing it is its own change.) A queued edit is not stamped.
 */
export async function persistSetEdit(
  deps: { supabase: SetWriteClient; online?: boolean },
  args: {
    setId: string;
    patch: Record<string, unknown>;
    editedAt?: string;
    /** False for writes that are not a correction of the set (feedback added afterwards). */
    stampEdited?: boolean;
  }
): Promise<EditSetResult> {
  const { supabase } = deps;

  if (await updateQueuedSet(args.setId, args.patch)) {
    return { queued: true };
  }
  const editEntryId = setEditEntryId(args.setId);
  if (await updateQueuedSet(editEntryId, args.patch, { restamp: true })) {
    return { queued: true };
  }

  const online = deps.online ?? !knownOffline();
  const error = online
    ? await directWrite(() => supabase.from('set_logs').update(args.patch).eq('id', args.setId))
    : null;
  if (!online || (error && !isPermanentRejection(error))) {
    await enqueueRowUpdate(editEntryId, 'set_logs', args.setId, args.patch);
    return { queued: true };
  }
  if (error) return { queued: false, error };

  if (args.stampEdited === false) return { queued: false };
  const editedAt = args.editedAt ?? clockNow().toISOString();
  try {
    await supabase.from('set_logs').update({ edited_at: editedAt }).eq('id', args.setId);
  } catch {
    // Column not present yet — the edit itself already landed.
  }
  return { queued: false };
}

/**
 * Delete a logged set. This is a HARD delete — `set_logs` has no soft-delete
 * column and never has (audit finding H3), so callers must not assume one.
 *
 * A set whose insert is still in the outbox is NOT simply forgotten: "queued"
 * does not mean "never reached the server" — the insert may have landed with
 * its ack lost, or be on the wire right now. Its queue entry is replaced by a
 * tombstone (a queued delete under the same id), so the row is removed for
 * real whichever side of the wire it is on. Deleting a row that never arrived
 * matches nothing and costs nothing.
 *
 * A delete that cannot be delivered right now is queued the same way instead
 * of being dropped with an error.
 *
 * `queued`  — the set's insert was still in the outbox, or the delete itself
 *             is now waiting there.
 * `pending` — the delete has NOT been applied on the server yet. Renumbering
 *             that depends on the vacated slot must wait behind it.
 */
export async function persistSetDelete(
  deps: { supabase: SetWriteClient; online?: boolean },
  setId: string
): Promise<{ queued: boolean; pending?: boolean; error?: { message: string } }> {
  const inFlight = directWriteInFlight(setId);
  if (inFlight) await inFlight.catch(() => undefined);

  const entry = await getQueuedEntry(setId);
  const wasQueued = !!entry && entry.op !== 'delete';
  // A queued edit of a set that is going away is moot.
  await removeQueuedSet(setEditEntryId(setId));
  if (wasQueued) await enqueueRowDelete(setId, 'set_logs', setId);

  const online = deps.online ?? !knownOffline();
  if (!online) {
    if (!wasQueued) await enqueueRowDelete(setId, 'set_logs', setId);
    return { queued: true, pending: true };
  }

  const error = await directWrite(() => deps.supabase.from('set_logs').delete().eq('id', setId));
  if (!error) {
    await removeQueuedSet(setId); // the tombstone, if any, has been served
    return { queued: wasQueued };
  }
  if (isPermanentRejection(error)) {
    return { queued: wasQueued, error };
  }
  if (!wasQueued) await enqueueRowDelete(setId, 'set_logs', setId);
  return { queued: true, pending: true };
}

/**
 * Persist a deletion: remove the row, then write the compaction it implies.
 *
 * The ordering is the point of having one function for it — the renumbering
 * moves rows DOWN into the slot the delete just vacated, so it cannot run
 * first. A caller that composes `persistSetDelete` and `persistSetRenumber`
 * itself can get that wrong, or skip the second half entirely, which is the
 * shape B1 had. Both the workout page and the headless driver go through here.
 *
 * `changes` comes from `planSetDeletion`. A delete that fails skips the
 * renumbering: compacting around a row that is still there would collide. A
 * delete that is QUEUED queues the renumbering behind it, for the same reason.
 */
export async function persistSetDeletion(
  deps: { supabase: SetWriteClient; online?: boolean },
  args: { setId: string; changes: SetNumberChange[] }
): Promise<{ queued: boolean; error?: { message: string } }> {
  const deleted = await persistSetDelete(deps, args.setId);
  if (deleted.error) return { queued: deleted.queued, error: deleted.error };

  const renumber = await persistSetRenumber(deps, args.changes, { queueOnly: deleted.pending });
  return {
    queued: deleted.queued || !!renumber.queued,
    ...(renumber.error ? { error: renumber.error } : {}),
  };
}

/**
 * Persist a block's renumbering (audit finding B1).
 *
 * Deleting a set used to renumber LOCAL state only, leaving the database with
 * its gaps. Two things went wrong downstream, and only the second was loud:
 *
 *  - the two numberings simply disagreed — the row the user saw as set 2 was
 *    stored as set 3 — until the session was reloaded;
 *  - a set logged OFFLINE afterwards took its number from local state, so it
 *    could carry a `set_number` the database still had, and the flush hit
 *    `UNIQUE (exercise_block_id, set_number)`.
 *
 * The fix is to make the two sides agree, not to tolerate the disagreement —
 * so this writes the new numbers rather than teaching the insert path to route
 * around them.
 *
 * A set still sitting in the outbox is patched IN THE QUEUE: its row has not
 * (necessarily) reached the database, so an UPDATE would match nothing and the
 * eventual insert would carry the stale number.
 *
 * `changes` must arrive in ascending-new-number order (`planBlockRenumber`
 * guarantees it) or an update will collide with a row that has not moved yet.
 * That order has to survive queueing too: once ONE move goes through the
 * outbox — because its set is queued, because the delete it follows is
 * queued (`queueOnly`), or because connectivity dropped mid-way — every later
 * move is queued behind it rather than sent directly ahead of it.
 */
export async function persistSetRenumber(
  deps: { supabase: SetWriteClient; online?: boolean },
  changes: SetNumberChange[],
  opts?: { queueOnly?: boolean }
): Promise<{ queued?: boolean; error?: { message: string } }> {
  let queueOnly = (opts?.queueOnly ?? false) || !(deps.online ?? !knownOffline());
  let queued = false;

  for (const change of changes) {
    const patch = { set_number: change.setNumber };
    const editEntryId = setEditEntryId(change.id);
    if (
      (await updateQueuedSet(change.id, patch, { restamp: true })) ||
      (await updateQueuedSet(editEntryId, patch, { restamp: true }))
    ) {
      queued = true;
      queueOnly = true;
      continue;
    }

    if (!queueOnly) {
      const error = await directWrite(() =>
        deps.supabase.from('set_logs').update(patch).eq('id', change.id)
      );
      if (!error) continue;
      // Stop at a real refusal: the remaining moves assume this one landed,
      // and pressing on would write numbers that collide. The caller surfaces
      // the error; a reload re-reads the authoritative numbering.
      if (isPermanentRejection(error)) return { ...(queued ? { queued } : {}), error };
      queueOnly = true;
    }

    await enqueueRowUpdate(editEntryId, 'set_logs', change.id, patch);
    queued = true;
  }
  return queued ? { queued } : {};
}
