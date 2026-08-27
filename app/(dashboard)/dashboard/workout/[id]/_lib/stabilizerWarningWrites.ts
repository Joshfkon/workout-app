/**
 * stabilizerWarningWrites.ts
 *
 * Persistence for pre-set stabilizer warnings (stabilizer_warning_events).
 * Every fired warning is recorded with the ratios it fired on, and the user's
 * response ('dismissed' | 'proceeded') is patched onto the same row.
 *
 * Unlike joint_pain_events (direct fire-and-forget insert), these writes are
 * routed through the offline outbox per the approved spec: client-generated
 * ids make the upsert idempotent, the response lands as an op:'update' patch,
 * and the page's existing mount/online/post-log flushes drain the queue —
 * nothing here ever blocks the workout UI.
 */

import type { StandardMuscleGroup } from '@/types/schema';
import {
  enqueueRowUpsert,
  enqueueRowUpdate,
  flushSetOutbox,
  type OutboxSupabase,
} from '@/lib/offline/setOutbox';
import { now as clockNow } from '@/lib/clock';

export type StabilizerWarningResponse = 'dismissed' | 'proceeded';

/** The fired warning's numbers, as evaluated (structural subset of
 *  services/muscleRecovery.StabilizerWarning). */
export interface StabilizerWarningEventData {
  muscle: StandardMuscleGroup;
  readinessRatio: number;
  intensityRatio: number;
  plannedLoadKg: number;
  referenceLoadKg: number;
}

export interface StabilizerWarningEventWrite {
  eventId: string;
  userId: string;
  sessionId: string;
  exerciseId: string | null;
  warning: StabilizerWarningEventData;
}

/** Queue the 'shown' row for a fired warning and kick a background flush. */
export async function enqueueStabilizerWarningShown(
  supabase: OutboxSupabase,
  write: StabilizerWarningEventWrite
): Promise<void> {
  try {
    await enqueueRowUpsert(write.eventId, 'stabilizer_warning_events', {
      id: write.eventId,
      user_id: write.userId,
      session_id: write.sessionId,
      exercise_id: write.exerciseId,
      muscle_group: write.warning.muscle,
      readiness_ratio: round4(write.warning.readinessRatio),
      intensity_ratio: round4(write.warning.intensityRatio),
      planned_load_kg: write.warning.plannedLoadKg,
      reference_load_kg: write.warning.referenceLoadKg,
      response: 'shown',
      shown_at: clockNow().toISOString(),
    });
    void flushSetOutbox(supabase);
  } catch (err) {
    // Best-effort telemetry — never let a warning log block the workout.
    console.error('Failed to queue stabilizer warning event:', err);
  }
}

/** Patch the user's response onto a previously-shown warning row. */
export async function enqueueStabilizerWarningResponse(
  supabase: OutboxSupabase,
  eventId: string,
  response: StabilizerWarningResponse
): Promise<void> {
  try {
    await enqueueRowUpdate(`${eventId}:response`, 'stabilizer_warning_events', eventId, {
      response,
      responded_at: clockNow().toISOString(),
    });
    void flushSetOutbox(supabase);
  } catch (err) {
    console.error('Failed to queue stabilizer warning response:', err);
  }
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
