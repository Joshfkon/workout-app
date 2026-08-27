/**
 * jointPainWrites.ts
 *
 * Persistence for user-initiated joint pain events (joint_pain_events).
 * Events feed:
 *   - deload advisor signal 5 (severity-weighted trailing-2-week count)
 *   - the exercise-level pattern notice (≥3 events on one exercise in 6 weeks)
 *
 * Writes are best-effort fire-and-forget: a failed insert must never block
 * or slow set logging (the same event is also embedded in the set's feedback
 * JSONB, so nothing is unrecoverable).
 */

import { bodyPartToJoint } from '@/services/discomfortTracker';
import type { DiscomfortSeverity, JointPainJoint, SetDiscomfort } from '@/types/schema';
import { isMissingColumnError } from '@/lib/offline/setOutbox';
import type { ReadinessSnapshot } from './readinessSnapshot';

type UntypedClient = ReturnType<
  typeof import('@/lib/supabase/client').createUntypedClient
>;

export interface JointPainEventWrite {
  userId: string;
  sessionId: string;
  exerciseId?: string | null;
  setLogId?: string | null;
  joint: JointPainJoint;
  severity: DiscomfortSeverity;
  /**
   * Full readiness state at report time (the injury/tweak tag's
   * moment-capture, migration 20260825000004). Optional — a caller without
   * recovery history in hand still records the bare event.
   */
  readinessSnapshot?: ReadinessSnapshot | null;
}

export async function insertJointPainEvent(
  supabase: UntypedClient,
  write: JointPainEventWrite
): Promise<void> {
  try {
    const row: Record<string, unknown> = {
      user_id: write.userId,
      session_id: write.sessionId,
      exercise_id: write.exerciseId ?? null,
      set_log_id: write.setLogId ?? null,
      joint: write.joint,
      severity: write.severity,
      readiness_snapshot: write.readinessSnapshot ?? null,
    };
    let { error } = await supabase.from('joint_pain_events').insert(row);
    // Migration lag (readiness_snapshot column not applied yet): strip it and
    // retry so the pain event itself still lands — the OPTIONAL_SET_LOG_COLUMNS
    // pattern.
    if (error && isMissingColumnError(error)) {
      const { readiness_snapshot: _dropped, ...bare } = row;
      ({ error } = await supabase.from('joint_pain_events').insert(bare));
    }
    if (error) console.error('Failed to record joint pain event:', error.message);
  } catch (err) {
    console.error('Failed to record joint pain event:', err);
  }
}

/**
 * Event write derived from a set's discomfort feedback. `setLogId` must be
 * null unless the set row already exists in set_logs — the FK would reject
 * a reference to a set that is still queued in the offline outbox.
 */
export function eventFromSetDiscomfort(args: {
  userId: string;
  sessionId: string;
  exerciseId: string;
  setLogId: string | null;
  discomfort: SetDiscomfort;
}): JointPainEventWrite {
  return {
    userId: args.userId,
    sessionId: args.sessionId,
    exerciseId: args.exerciseId,
    setLogId: args.setLogId,
    joint: bodyPartToJoint(args.discomfort.bodyPart),
    severity: args.discomfort.severity,
  };
}

/** LocalStorage key for a dismissed exercise pain-pattern notice. */
export function painNoticeDismissKey(exerciseId: string): string {
  return `hypertrack:pain-notice-dismissed:${exerciseId}`;
}

export function getPainNoticeDismissedAt(exerciseId: string): Date | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(painNoticeDismissKey(exerciseId));
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

export function setPainNoticeDismissed(exerciseId: string, at: Date): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(painNoticeDismissKey(exerciseId), at.toISOString());
  } catch {
    // Storage unavailable (private mode) — the notice will just reappear.
  }
}
