/**
 * planReviewWrites — persist the setup flow's AI review decisions
 * (workout_plan_review_events) at Start. Routed through the offline outbox
 * like stabilizer warning events: client-generated ids make the upsert
 * idempotent, and a background flush drains it. Best-effort telemetry —
 * never blocks or fails the workout.
 */

import {
  enqueueRowUpsert,
  flushSetOutbox,
  type OutboxSupabase,
} from '@/lib/offline/setOutbox';
import { now as clockNow } from '@/lib/clock';
import type { ReviewDecision } from '@/services/workoutSetup/aiReview';

/** Row payloads for a session's decisions (pure; exported for tests). */
export function reviewDecisionRows(
  decisions: readonly ReviewDecision[],
  userId: string,
  sessionId: string,
  newId: () => string
): Record<string, unknown>[] {
  const createdAt = clockNow().toISOString();
  return decisions.map((d) => ({
    id: newId(),
    user_id: userId,
    session_id: sessionId,
    suggestion_id: d.suggestionId,
    suggestion_type: d.type,
    reason: d.reason.slice(0, 200),
    severity: d.severity,
    decision: d.decision,
    applied: d.applied,
    exercise_id: d.exerciseId,
    replacement_exercise_id: d.replacementExerciseId,
    plan_hash: d.planHash,
    created_at: createdAt,
  }));
}

export async function enqueuePlanReviewDecisions(
  supabase: OutboxSupabase,
  args: { userId: string; sessionId: string; decisions: readonly ReviewDecision[] }
): Promise<void> {
  if (args.decisions.length === 0) return;
  try {
    const rows = reviewDecisionRows(args.decisions, args.userId, args.sessionId, () =>
      crypto.randomUUID()
    );
    for (const row of rows) {
      await enqueueRowUpsert(row.id as string, 'workout_plan_review_events', row);
    }
    void flushSetOutbox(supabase);
  } catch (err) {
    console.error('Failed to queue plan review decisions:', err);
  }
}
