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
 *      (mesocycle week advance / deload check, calorie estimate) runs only
 *      after the flush confirms the completion landed. If the app dies
 *      before that, the completion itself is still safe in the outbox, and
 *      the meso updates self-heal: they recount completed sessions on every
 *      subsequent finish (advance-only writes), so a missed run is caught up
 *      by the next one.
 *
 * Timing instrumentation: every stage is marked with performance.now() and
 * one `[finish-timing]` breakdown is logged per finish so tap-to-response
 * regressions are visible in the console.
 */

import {
  enqueueRowUpdate,
  enqueueRowUpsert,
  flushSetOutbox,
  type FlushResult,
  type OutboxSupabase,
} from '@/lib/offline/setOutbox';
import { runPostSessionMesoUpdates } from './postSessionMeso';
import { upsertSessionMuscleFeedback } from './muscleFeedbackWrites';
import type { SessionMuscleFeedbackEntry } from '@/components/workout/SessionSummary';
import type { WorkoutSession } from '@/types/schema';

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
  /** Test seam: overrides the background post-processing runner. */
  runMesoUpdates?: typeof runPostSessionMesoUpdates;
}

function completionPatch(data: FinishSummaryData): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    state: 'completed',
    completed_at: new Date().toISOString(),
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
  //    ms). After this a crash/kill cannot lose the finished workout.
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
      let completionSynced: boolean;
      if (queued) {
        const result = await flushIncluding(supabase, sessionFinishEntryId(sessionId));
        completionSynced = result.flushedIds.includes(sessionFinishEntryId(sessionId));
      } else {
        completionSynced = await directFinishWrites(supabase, sessionId, session, data);
      }
      timer.mark(completionSynced ? 'synced' : 'sync-pending(queued for retry)');

      if (completionSynced) {
        await runFinishPostProcessing(deps, data.sessionRpe, timer);
      }
    } catch (err) {
      // Queued entries survive for the next flush; nothing is lost.
      console.error('Background finish sync failed (will retry from outbox):', err);
    }
    timer.report();
  })();
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

/**
 * Work that must only run once the completion is visible in the DB (it
 * recounts completed sessions / reads the completed row).
 */
async function runFinishPostProcessing(
  deps: FinishFlowDeps,
  sessionRpe: number,
  timer: FinishTimer
): Promise<void> {
  const { supabase, sessionId, session } = deps;

  // Deload trigger check + week advance from the completed-session count.
  if (session.mesocycleId) {
    const runMeso = deps.runMesoUpdates ?? runPostSessionMesoUpdates;
    await runMeso(supabase, {
      mesocycleId: session.mesocycleId,
      userId: session.userId,
      sessionRpe,
      checkIn: session.preWorkoutCheckIn ?? null,
    });
    timer.mark('meso-updates');
  }

  // Workout calorie estimate (several sequential DB round-trips) — the
  // result is dashboard garnish, so it stays fire-and-forget.
  if (session.plannedDate) {
    const plannedDate = session.plannedDate;
    import('@/lib/actions/workout-calories')
      .then(({ calculateAndSaveWorkoutCalories }) =>
        calculateAndSaveWorkoutCalories(sessionId, plannedDate)
      )
      .catch((err) => console.error('Workout calorie calculation failed:', err));
  }
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
  } catch (err) {
    queued = false;
    console.error('Claim outbox enqueue failed, falling back to direct write:', err);
  }

  void (async () => {
    try {
      let claimSynced: boolean;
      let completionSynced = true;
      if (queued) {
        const result = await flushIncluding(supabase, sessionClaimEntryId(sessionId));
        claimSynced = result.flushedIds.includes(sessionClaimEntryId(sessionId));
        // If the finish entry was still queued, it must have gone through in
        // the same flush for the session to count as completed.
        completionSynced = !result.failedIds.includes(sessionFinishEntryId(sessionId));
      } else {
        const { error } = await supabase
          .from('workout_sessions')
          .update({ mesocycle_id: mesocycleId })
          .eq('id', sessionId);
        claimSynced = !error;
        if (error) console.error('Failed to count workout toward mesocycle:', error);
      }

      if (claimSynced && completionSynced) {
        const runMeso = deps.runMesoUpdates ?? runPostSessionMesoUpdates;
        await runMeso(supabase, {
          mesocycleId,
          userId: session.userId,
          sessionRpe: deps.sessionRpe,
          checkIn: session.preWorkoutCheckIn ?? null,
        });
      }
    } catch (err) {
      // Non-fatal: the workout is already saved; the claim entry (if queued)
      // is retried by the next outbox flush, and the meso updates self-heal
      // on the next completed session.
      console.error('Background claim sync failed:', err);
    }
  })();
}
