/**
 * finishWorkout.ts — optimistic finish-workout orchestration.
 *
 * The old flow awaited two sequential Supabase round-trips (session
 * completion update + per-muscle feedback upsert) with no timeout and no
 * pending UI before navigating, so a slow network froze the "Save & Finish"
 * tap for 10-15s — and an offline finish LOST the completion entirely (the
 * catch navigated away with the session still in_progress server-side).
 *
 * New contract:
 *   1. The completion patch and feedback rows are queued in the IndexedDB
 *      outbox (a few ms, no network) — durable across a crash/kill.
 *   2. The UI responds immediately: navigate (or show the claim prompt).
 *   3. A background flush pushes the queued writes with a per-op timeout;
 *      failures stay queued and are retried by the existing outbox flushers
 *      (dashboard layout mount + 'online' events + workout-page poll).
 *   4. Post-processing that requires the completion to be visible in the DB
 *      (mesocycle week advance / deload check, calorie estimate) is recorded
 *      as a DURABLE work item (lib/offline/postFinishQueue) and settled by
 *      whichever flush path drains the completion — see `settlePostFinish`.
 *
 * WHY THE WORK ITEM IS DURABLE (B3). Step 4 used to be gated on whether THIS
 * call's `flushSetOutbox` result listed the finish entry. That is a fact about
 * which flush carried the write, not about whether the write landed: another
 * flush path can drain the completion first, and overlapping calls share one
 * in-flight promise whose result describes a different queue snapshot. Either
 * way the completion reached the database while its caller concluded
 * `completionSynced = false` — and because nothing else was looking for the
 * work, it was skipped permanently. The invariant now is:
 *
 *     finish durably persisted → post-session work eventually runs
 *
 * regardless of which caller wins the race, and even if the original caller is
 * gone. At-least-once, over an idempotent body (see `runPostFinishWork`).
 *
 * Timing instrumentation: every stage is marked with performance.now() and
 * one `[finish-timing]` breakdown is logged per finish so tap-to-response
 * regressions are visible in the console.
 */

import {
  enqueueRowUpdate,
  enqueueRowUpsert,
  flushSetOutbox,
  hasQueuedEntry,
  type FlushResult,
  type OutboxSupabase,
} from '@/lib/offline/setOutbox';
import {
  enqueuePostFinishWork,
  getPostFinishWork,
  listPostFinishWork,
  patchPostFinishWork,
  removePostFinishWork,
  type PostFinishWork,
} from '@/lib/offline/postFinishQueue';
import { runPostSessionMesoUpdates } from './postSessionMeso';
import { runPostSessionStandaloneUpdates } from './postSessionStandalone';
import { upsertSessionMuscleFeedback } from './muscleFeedbackWrites';
import type { SessionMuscleFeedbackEntry } from '@/components/workout/SessionSummary';
import type { WorkoutSession } from '@/types/schema';
import { now as clockNow } from '@/lib/clock';

type UntypedSupabase = ReturnType<typeof import('@/lib/supabase/client').createUntypedClient>;

export function sessionFinishEntryId(sessionId: string): string {
  return `finish:${sessionId}`;
}

export function sessionClaimEntryId(sessionId: string): string {
  return `claim:${sessionId}`;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export interface FinishTimer {
  mark(stage: string): void;
  report(): void;
}

export function createFinishTimer(label: string): FinishTimer {
  const t0 = now();
  const marks: string[] = [];
  return {
    mark(stage: string) {
      marks.push(`${stage} @ ${Math.round((now() - t0) * 10) / 10}ms`);
    },
    report() {
      console.info(`[finish-timing] ${label}: ${marks.join(' | ')}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Finish flow
// ---------------------------------------------------------------------------

export interface FinishSummaryData {
  sessionRpe: number;
  /**
   * Legacy global pump rating (1-5). The finish card no longer captures it —
   * pump moved to per-exercise in-workout prompts — so this is only set by
   * old callers; when absent the stored pump_rating is left untouched.
   */
  pumpRating?: number;
  notes: string;
  muscleFeedback: SessionMuscleFeedbackEntry[];
  /**
   * Active workout duration in seconds, snapshotted at finish (excludes paused
   * time). Persisted so history / read-only views show the same frozen value.
   * Null on legacy callers that don't pass it.
   */
  durationSeconds?: number | null;
  /**
   * Whether the user marked this as a deload session on the summary screen.
   * Persisted so the deload-exclusion consumers skip it. Omit on legacy callers
   * that don't surface the toggle (leaves the stored flag untouched).
   */
  isDeload?: boolean;
}

export interface FinishFlowDeps {
  supabase: UntypedSupabase;
  sessionId: string;
  session: WorkoutSession;
  /** Clear workout state and leave the page (endWorkoutSession + router.push). */
  navigate: () => void;
  /** Non-null when a mesocycle claim candidate is armed: shown INSTEAD of navigating. */
  showClaimPrompt?: (() => void) | null;
  /**
   * Called once the completion patch is confirmed visible in the DB. The
   * workout page uses this to invalidate the workout-derived React Query
   * caches (history list, exercise charts, analytics) — they cache completed
   * history with long stale times, so without this the History list keeps
   * showing the pre-workout snapshot while the calendar (which fetches fresh)
   * already has the new session. Best-effort: a throw here must never break
   * the finish flow.
   */
  onCompletionSynced?: () => void;
  /** Test seam: overrides the background post-processing runner. */
  runMesoUpdates?: typeof runPostSessionMesoUpdates;
  /** Test seam: overrides the standalone (no-mesocycle) post-processing runner. */
  runStandaloneUpdates?: typeof runPostSessionStandaloneUpdates;
}

function completionPatch(data: FinishSummaryData): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    state: 'completed',
    completed_at: clockNow().toISOString(),
    session_rpe: data.sessionRpe,
    session_notes: data.notes,
    completion_percent: 100,
  };
  if (typeof data.pumpRating === 'number') {
    patch.pump_rating = data.pumpRating;
  }
  if (typeof data.durationSeconds === 'number' && Number.isFinite(data.durationSeconds)) {
    patch.duration_seconds = Math.max(0, Math.round(data.durationSeconds));
  }
  if (typeof data.isDeload === 'boolean') {
    patch.is_deload = data.isDeload;
  }
  return patch;
}

function feedbackRows(userId: string, sessionId: string, data: FinishSummaryData) {
  return data.muscleFeedback.map((entry) => {
    const row: Record<string, unknown> = {
      user_id: userId,
      session_id: sessionId,
      muscle_group: entry.muscleGroup,
      workload: entry.workload,
    };
    // Pump only on legacy payloads — the finish card stopped capturing it.
    if (entry.pump !== undefined) row.pump = entry.pump;
    return row;
  });
}

/**
 * Optimistic "Save & Finish": queue the writes locally, respond in the UI
 * immediately, sync in the background. Resolves once the UI response has
 * happened (queue written + navigation/prompt triggered) — NOT when the
 * network work is done.
 */
export async function submitFinishOptimistic(
  deps: FinishFlowDeps,
  data: FinishSummaryData
): Promise<void> {
  const { supabase, sessionId, session } = deps;
  const timer = createFinishTimer(`session ${sessionId}`);
  timer.mark('tap');

  // 1. Durability first: persist the completion locally (IndexedDB, a few
  //    ms). After this a crash/kill cannot lose the finished workout — nor,
  //    thanks to the work item, the processing that has to follow it.
  let queued = true;
  try {
    await enqueueRowUpdate(
      sessionFinishEntryId(sessionId),
      'workout_sessions',
      sessionId,
      completionPatch(data)
    );
    for (const row of feedbackRows(session.userId, sessionId, data)) {
      await enqueueRowUpsert(
        `feedback:${sessionId}:${row.muscle_group}`,
        'session_muscle_feedback',
        row
      );
    }
    await enqueuePostFinishWork(workItemFor(sessionId, session, data.sessionRpe));
  } catch (err) {
    // Outbox unavailable (broken IndexedDB) — fall back to direct writes in
    // the background task below. The UI still responds immediately.
    queued = false;
    console.error('Finish outbox enqueue failed, falling back to direct write:', err);
  }
  timer.mark(queued ? 'queued-local' : 'queue-failed');

  // 2. Immediate UI response.
  if (deps.showClaimPrompt) deps.showClaimPrompt();
  else deps.navigate();
  timer.mark('ui-response');

  // 3. Background sync + post-processing. Keeps running after navigation
  //    (an SPA route change keeps the JS context alive); never blocks the
  //    user.
  void (async () => {
    try {
      if (queued) {
        await flushIncluding(supabase, sessionFinishEntryId(sessionId));
        // NOT gated on what that flush reported: `settlePostFinish` asks
        // whether the entry has left the queue and the row is completed.
        const outcome = await settlePostFinish(supabase, sessionId, {
          runMesoUpdates: deps.runMesoUpdates,
          runStandaloneUpdates: deps.runStandaloneUpdates,
          onCompletionSynced: deps.onCompletionSynced,
        });
        timer.mark(outcome === 'ran' ? 'synced' : `sync-${outcome}`);
      } else {
        // Outbox unusable (broken IndexedDB): no durable work item is
        // possible, so this caller does the work inline. The pre-existing
        // degraded path — if the tab dies here, the finish is lost anyway.
        const wrote = await directFinishWrites(supabase, sessionId, session, data);
        timer.mark(wrote ? 'synced' : 'sync-failed');
        if (wrote) {
          fireCompletionSynced(deps.onCompletionSynced);
          await runPostFinishWork(
            supabase,
            { ...workItemFor(sessionId, session, data.sessionRpe), id: '', enqueuedAt: 0 },
            deps.runMesoUpdates,
            deps.runStandaloneUpdates
          );
        }
      }
    } catch (err) {
      // Queued entries and the work item survive for the next flush/drain;
      // nothing is lost.
      console.error('Background finish sync failed (will retry from outbox):', err);
    }
    timer.report();
  })();
}

/** The durable work item for a session, from the data the finish already has. */
function workItemFor(
  sessionId: string,
  session: WorkoutSession,
  sessionRpe: number | null
): Omit<PostFinishWork, 'id' | 'enqueuedAt'> {
  return {
    sessionId,
    userId: session.userId,
    mesocycleId: session.mesocycleId ?? null,
    sessionRpe,
    checkIn: session.preWorkoutCheckIn ?? null,
    plannedDate: session.plannedDate || null,
  };
}

function fireCompletionSynced(hook: (() => void) | undefined): void {
  try {
    hook?.();
  } catch (err) {
    console.error('onCompletionSynced hook failed:', err);
  }
}

/**
 * Flush the outbox, making sure the flush actually covered `entryId`: a
 * flush already in flight (page poll / 'online' listener) snapshotted the
 * queue BEFORE our enqueue and is returned as-is by the in-flight dedupe —
 * in that case run one more flush that sees the new entry.
 */
async function flushIncluding(
  supabase: OutboxSupabase,
  entryId: string
): Promise<FlushResult> {
  let result = await flushSetOutbox(supabase);
  if (!result.flushedIds.includes(entryId) && !result.failedIds.includes(entryId)) {
    result = await flushSetOutbox(supabase);
  }
  return result;
}

/** Fallback path when the outbox itself is unusable: the old direct writes. */
async function directFinishWrites(
  supabase: UntypedSupabase,
  sessionId: string,
  session: WorkoutSession,
  data: FinishSummaryData
): Promise<boolean> {
  const { error } = await supabase
    .from('workout_sessions')
    .update(completionPatch(data))
    .eq('id', sessionId);
  if (error) {
    console.error('Failed to complete workout:', error);
    return false;
  }
  if (data.muscleFeedback.length > 0) {
    const { errors } = await upsertSessionMuscleFeedback(
      supabase,
      session.userId,
      data.muscleFeedback.map((entry) => ({
        sessionId,
        muscleGroup: entry.muscleGroup,
        pump: entry.pump,
        workload: entry.workload,
      }))
    );
    if (errors.length > 0) {
      console.error('Failed to save per-muscle feedback:', errors);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Post-finish settlement (B3)
// ---------------------------------------------------------------------------

/** Why a settle attempt ended. Only `ran` means the work was performed. */
export type PostFinishOutcome =
  /** The work ran and the item was cleared. */
  | 'ran'
  /** The completion has not landed yet (or we couldn't tell) — try again. */
  | 'pending'
  /** The write left the queue without completing; the item was dropped. */
  | 'abandoned'
  /** Nothing owed for this session. */
  | 'none';

/** Give-up bound, mirroring the outbox's own 5-attempt policy. */
const MAX_POST_FINISH_ATTEMPTS = 5;

export interface SettleOptions {
  /** Test seam: overrides the mesocycle post-processing runner. */
  runMesoUpdates?: typeof runPostSessionMesoUpdates;
  /** Test seam: overrides the standalone (no-mesocycle) post-processing runner. */
  runStandaloneUpdates?: typeof runPostSessionStandaloneUpdates;
  /** Fired once, immediately before the work runs. Best-effort. */
  onCompletionSynced?: () => void;
}

/**
 * Run the post-processing a session owes, if and only if its finish has
 * actually landed.
 *
 * THE POINT OF THIS FUNCTION is that it never asks "did my flush carry the
 * write". It asks the two questions that are actually decidable:
 *
 *   1. Is the finish (or claim) entry still in the outbox? Then the write has
 *      not landed — wait.
 *   2. It is gone. Did it leave because it succeeded, or because the flush
 *      gave up on it after five server rejections? Only the row itself can
 *      say, so read it.
 *
 * The item is cleared only AFTER the work completes, so a crash mid-work
 * leaves it for the next drain. That makes execution at-least-once by design —
 * safe because every operation in `runPostFinishWork` recomputes and
 * overwrites from persisted state rather than accumulating.
 */
export async function settlePostFinish(
  supabase: UntypedSupabase,
  sessionId: string,
  opts: SettleOptions = {}
): Promise<PostFinishOutcome> {
  const work = await getPostFinishWork(sessionId);
  if (!work) return 'none';

  // A claim writes to the same row; both must have landed before the meso
  // updates can count this session against its mesocycle.
  if (await hasQueuedEntry(sessionFinishEntryId(sessionId))) return 'pending';
  if (await hasQueuedEntry(sessionClaimEntryId(sessionId))) return 'pending';

  const row = await readSessionSettlement(supabase, sessionId);
  if (row === null) return 'pending'; // couldn't tell — next drain retries
  if (!row.completed) {
    console.error(
      `[finish] session ${sessionId} left the outbox without completing — ` +
        'dropping its post-processing.'
    );
    await removePostFinishWork(sessionId);
    return 'abandoned';
  }

  // The claim write can ALSO be dropped by the flush's give-up path, leaving
  // the session completed but never linked. Running the mesocycle updates off
  // the work item's requested id would then write fatigue and deload state
  // for a mesocycle this session does not belong to. The row is the authority
  // on membership, so a mismatch demotes the item to its session-scoped work.
  let effective = work;
  if (work.mesocycleId && row.mesocycleId !== work.mesocycleId) {
    console.error(
      `[finish] session ${sessionId} is not linked to mesocycle ${work.mesocycleId} ` +
        `(row has ${row.mesocycleId ?? 'none'}) — skipping the mesocycle updates.`
    );
    effective = { ...work, mesocycleId: null };
  }

  const attempts = (work.attempts ?? 0) + 1;
  if (attempts > MAX_POST_FINISH_ATTEMPTS) {
    console.error(
      `[finish] post-processing for session ${sessionId} failed ` +
        `${MAX_POST_FINISH_ATTEMPTS} times — dropping it.`
    );
    await removePostFinishWork(sessionId);
    return 'abandoned';
  }
  await patchPostFinishWork(sessionId, { attempts });

  fireCompletionSynced(opts.onCompletionSynced);
  const { ok } = await runPostFinishWork(
    supabase,
    effective,
    opts.runMesoUpdates,
    opts.runStandaloneUpdates
  );
  if (!ok) {
    // Something did not land. KEEP the item so a later drain retries it —
    // clearing it here is what would make the at-least-once guarantee
    // vacuous. The attempt counter above bounds how long this can repeat.
    console.error(
      `[finish] post-processing for session ${sessionId} did not complete ` +
        `(attempt ${attempts}/${MAX_POST_FINISH_ATTEMPTS}) — keeping the work item.`
    );
    return 'pending';
  }
  await removePostFinishWork(sessionId);
  return 'ran';
}

/**
 * Settle every session that still owes post-processing.
 *
 * Called from the same places that already flush the outbox, so the work is
 * driven by whoever is around rather than by whoever finished the workout.
 * Normally a no-op: with nothing pending it reads one empty object store and
 * touches the network zero times.
 */
export async function drainPostFinishWork(
  supabase: UntypedSupabase,
  opts: SettleOptions = {}
): Promise<PostFinishOutcome[]> {
  const pending = await listPostFinishWork();
  const outcomes: PostFinishOutcome[] = [];
  for (const work of pending) {
    try {
      outcomes.push(await settlePostFinish(supabase, work.sessionId, opts));
    } catch (err) {
      // One poisoned item must not stop the rest; the attempt counter above
      // bounds how long it can keep failing.
      console.error(`Post-finish drain failed for session ${work.sessionId}:`, err);
      outcomes.push('pending');
    }
  }
  return outcomes;
}

/**
 * What the session row itself says: has the completion landed, and which
 * mesocycle (if any) is it actually linked to?
 *
 * `null` means the question could not be answered (offline, query error) —
 * distinct from `completed: false`, which means the row is there and not
 * completed (or is gone entirely). Only the latter justifies dropping the work
 * item; a read error must never be read as evidence.
 */
async function readSessionSettlement(
  supabase: UntypedSupabase,
  sessionId: string
): Promise<{ completed: boolean; mesocycleId: string | null } | null> {
  try {
    const { data, error } = await supabase
      .from('workout_sessions')
      .select('state, mesocycle_id')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) return null;
    const row = data as { state?: string; mesocycle_id?: string | null } | null;
    return { completed: row?.state === 'completed', mesocycleId: row?.mesocycle_id ?? null };
  } catch {
    return null;
  }
}

/**
 * Work that must only run once the completion is visible in the DB (it
 * recounts completed sessions / reads the completed row).
 *
 * EVERY STEP HERE IS IDEMPOTENT, which is what makes at-least-once execution
 * the right guarantee:
 *  - `current_week` is an advance-only `.lt()` write off a recount;
 *  - the weekly fatigue log is a find-then-update/insert of derived values on
 *    (user, mesocycle, week);
 *  - the deload check re-derives from stored rows;
 *  - the calorie estimate recomputes and overwrites for the session.
 * Running twice converges on the same rows.
 */
async function runPostFinishWork(
  supabase: UntypedSupabase,
  work: PostFinishWork,
  runMesoUpdatesOverride?: typeof runPostSessionMesoUpdates,
  runStandaloneUpdatesOverride?: typeof runPostSessionStandaloneUpdates
): Promise<{ ok: boolean }> {
  // Both steps report rather than throw, and BOTH outcomes matter: the work
  // item is cleared only on a fully successful run, so a transient failure
  // here has to be visible or at-least-once degrades to at-most-once — the
  // item would be dropped after a run that did nothing. Neither step aborts
  // the other; they are independent, and a partial success still counts as
  // "try again" because every operation is idempotent.
  let ok = true;

  // Deload trigger check + week advance from the completed-session count.
  // Sessions outside a mesocycle get the standalone mirror instead: the same
  // weekly fatigue log (mesocycle_id NULL, epoch-week key) + deload check
  // stamped on the user row, so free-form training still accumulates a
  // multi-week fatigue trend. Same idempotence argument: both runners
  // recompute derived values and upsert/overwrite.
  if (work.mesocycleId) {
    const runMeso = runMesoUpdatesOverride ?? runPostSessionMesoUpdates;
    const result = await runMeso(supabase, {
      mesocycleId: work.mesocycleId,
      userId: work.userId,
      sessionRpe: work.sessionRpe,
      checkIn: work.checkIn,
    });
    if (!result?.ok) ok = false;
  } else {
    const runStandalone = runStandaloneUpdatesOverride ?? runPostSessionStandaloneUpdates;
    const result = await runStandalone(supabase, {
      userId: work.userId,
      sessionRpe: work.sessionRpe,
      checkIn: work.checkIn,
    });
    if (!result?.ok) ok = false;
  }

  // Workout calorie estimate (several sequential DB round-trips). Awaited
  // rather than fire-and-forget: the work item is only cleared afterwards, so
  // awaiting is what extends the guarantee to cover it.
  if (work.plannedDate) {
    const plannedDate = work.plannedDate;
    const result = await import('@/lib/actions/workout-calories')
      .then(({ calculateAndSaveWorkoutCalories }) =>
        calculateAndSaveWorkoutCalories(work.sessionId, plannedDate)
      )
      .catch((err) => {
        console.error('Workout calorie calculation failed:', err);
        return { success: false } as const;
      });
    if (!result?.success) {
      console.error('Workout calorie calculation did not complete for', work.sessionId);
      ok = false;
    }
  }

  return { ok };
}

// ---------------------------------------------------------------------------
// Claim flow (count an ad-hoc workout toward the mesocycle)
// ---------------------------------------------------------------------------

export interface ClaimFlowDeps {
  supabase: UntypedSupabase;
  sessionId: string;
  session: WorkoutSession;
  mesocycleId: string;
  sessionRpe: number | null;
  /** Test seam: overrides the background post-processing runner. */
  runMesoUpdates?: typeof runPostSessionMesoUpdates;
  /** Test seam: overrides the standalone (no-mesocycle) post-processing runner. */
  runStandaloneUpdates?: typeof runPostSessionStandaloneUpdates;
}

/**
 * Optimistic "Count it": queue the mesocycle link locally and sync in the
 * background. Resolves once the claim is durably queued (a few ms, no
 * network) — callers should await it before navigating so a tab/app kill
 * right after the tap cannot lose the claim; the network sync never blocks.
 * Ordering with the completion update doesn't matter (disjoint columns on
 * the same row), but the meso post-processing only runs once BOTH the
 * completion and the claim are confirmed synced, since it counts completed
 * sessions linked to the mesocycle.
 */
export async function confirmClaimOptimistic(deps: ClaimFlowDeps): Promise<void> {
  const { supabase, sessionId, session, mesocycleId } = deps;

  let queued = true;
  try {
    await enqueueRowUpdate(sessionClaimEntryId(sessionId), 'workout_sessions', sessionId, {
      mesocycle_id: mesocycleId,
    });
    // Durable BEFORE any background work starts, and for the same reason the
    // claim itself is: if the app dies here (or this sits queued offline for
    // days), the claim still syncs from the outbox later — and the work item
    // has to already know which mesocycle it belongs to, or the drain settles
    // it with mesocycleId: null and the mesocycle updates are skipped for
    // good. Patching after the flush would reintroduce exactly the
    // caller-must-survive dependency this change exists to remove.
    //
    // If the finish already settled (an ad-hoc session ran its processing with
    // no mesocycle) there is no item left to patch — write a fresh one so the
    // claim's own processing is just as recoverable as the finish's was.
    const patched = await patchPostFinishWork(sessionId, {
      mesocycleId,
      sessionRpe: deps.sessionRpe,
      attempts: 0,
    });
    if (!patched) {
      await enqueuePostFinishWork({
        sessionId,
        userId: session.userId,
        mesocycleId,
        sessionRpe: deps.sessionRpe,
        checkIn: session.preWorkoutCheckIn ?? null,
        plannedDate: session.plannedDate || null,
      });
    }
  } catch (err) {
    queued = false;
    console.error('Claim outbox enqueue failed, falling back to direct write:', err);
  }

  void (async () => {
    try {
      if (queued) {
        await flushIncluding(supabase, sessionClaimEntryId(sessionId));
        // Settles only when BOTH the finish and the claim have left the
        // queue — `settlePostFinish` checks each.
        await settlePostFinish(supabase, sessionId, {
          runMesoUpdates: deps.runMesoUpdates,
          runStandaloneUpdates: deps.runStandaloneUpdates,
        });
      } else {
        const { error } = await supabase
          .from('workout_sessions')
          .update({ mesocycle_id: mesocycleId })
          .eq('id', sessionId);
        if (error) {
          console.error('Failed to count workout toward mesocycle:', error);
        } else {
          const runMeso = deps.runMesoUpdates ?? runPostSessionMesoUpdates;
          await runMeso(supabase, {
            mesocycleId,
            userId: session.userId,
            sessionRpe: deps.sessionRpe,
            checkIn: session.preWorkoutCheckIn ?? null,
          });
        }
      }
    } catch (err) {
      // Non-fatal: the workout is already saved; the claim entry (if queued)
      // is retried by the next outbox flush, and the work item is settled by
      // the next drain.
      console.error('Background claim sync failed:', err);
    }
  })();
}
