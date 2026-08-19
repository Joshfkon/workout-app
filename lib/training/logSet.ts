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

/** A set whose `set_number` must move, and where it must move to. */
export interface SetNumberChange {
  id: string;
  setNumber: number;
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
    if (set.exerciseBlockId === blockId && !set.isWarmup && set.setType !== 'warmup') {
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
 * findings fiction (Codex review on #602 caught exactly that drift).
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
 *    `UNIQUE (exercise_block_id, set_number)`. The outbox's `ignoreDuplicates`
 *    is keyed on `id` and does not cover that, so the write was refused,
 *    retried, and finally dropped: a logged set silently lost.
 *
 * The fix is to make the two sides agree, not to tolerate the disagreement —
 * so this writes the new numbers rather than teaching the insert path to route
 * around them.
 *
 * A set still sitting in the outbox is patched IN THE QUEUE: its row has not
 * reached the database, so an UPDATE would match nothing and the eventual
 * insert would carry the stale number.
 *
 * `changes` must arrive in ascending-new-number order (`planBlockRenumber`
 * guarantees it) or an update will collide with a row that has not moved yet.
 */
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
 * renumbering: compacting around a row that is still there would collide.
 */
export async function persistSetDeletion(
  deps: { supabase: SetWriteClient },
  args: { setId: string; changes: SetNumberChange[] }
): Promise<{ queued: boolean; error?: { message: string } }> {
  const deleted = await persistSetDelete(deps, args.setId);
  if (deleted.error) return deleted;

  const { error } = await persistSetRenumber(deps, args.changes);
  return { queued: deleted.queued, ...(error ? { error } : {}) };
}

export async function persistSetRenumber(
  deps: { supabase: SetWriteClient },
  changes: SetNumberChange[]
): Promise<{ error?: { message: string } }> {
  for (const change of changes) {
    if (await updateQueuedSet(change.id, { set_number: change.setNumber })) continue;
    const { error } = await deps.supabase
      .from('set_logs')
      .update({ set_number: change.setNumber })
      .eq('id', change.id);
    // Stop at the first failure: the remaining moves assume this one landed,
    // and pressing on would write numbers that collide. The caller surfaces
    // the error; a reload re-reads the authoritative numbering.
    if (error) return { error };
  }
  return {};
}
