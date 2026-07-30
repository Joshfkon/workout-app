/**
 * Persistence for motion captures. Two paths, deliberately different:
 *
 *  - Derived per-rep metrics (MotionCapture) go through the offline outbox —
 *    durable across tab closes, idempotent on retry, and enqueued after the
 *    set's own row so the set_id FK is satisfied at flush time.
 *  - Raw sample buffers are OPT-IN (users.motion_capture_raw_retention),
 *    best-effort direct inserts, and capped per workout session — they exist
 *    for offline analysis by one user and must not bloat the primary store.
 *
 * INVARIANT (constraint #3): a capture without a calibrationId is invalid
 * and is never persisted — enforced here before enqueue and again by the
 * NOT NULL FK in the database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImuSample, MotionCapture } from '@/types/motion';
import { enqueueRowUpsert, flushSetOutbox, type OutboxSupabase } from '@/lib/offline/setOutbox';

/** Max raw buffers persisted per workout session (storage-bloat guard). */
export const RAW_BUFFER_SESSION_CAP = 3;

function rawCountKey(workoutSessionId: string): string {
  return `motion-raw-count:${workoutSessionId}`;
}

/** Raw buffers already persisted for this workout session (this device). */
export function rawBuffersUsedForSession(workoutSessionId: string): number {
  try {
    return Number(sessionStorage.getItem(rawCountKey(workoutSessionId)) ?? '0') || 0;
  } catch {
    return RAW_BUFFER_SESSION_CAP; // storage unavailable → behave as capped
  }
}

function markRawBufferUsed(workoutSessionId: string): void {
  try {
    sessionStorage.setItem(
      rawCountKey(workoutSessionId),
      String(rawBuffersUsedForSession(workoutSessionId) + 1)
    );
  } catch {
    // Counting is best-effort; failure only means an earlier cap.
  }
}

/** snake_case row for the motion_captures table. */
export function toMotionCaptureRow(
  capture: MotionCapture,
  userId: string
): Record<string, unknown> {
  return {
    id: capture.id,
    user_id: userId,
    set_id: capture.setId,
    calibration_id: capture.calibrationId,
    side: capture.side,
    started_at: capture.startedAt,
    duration_ms: Math.round(capture.durationMs),
    sample_rate_hz_mean: Number(capture.sampleRateHz_mean.toFixed(2)),
    sample_rate_hz_stddev: Number(capture.sampleRateHz_stddev.toFixed(2)),
    dropped_sample_count: capture.droppedSampleCount,
    clip_detected: capture.clipDetected,
    reps: capture.reps,
    quality_flags: capture.qualityFlags,
    provenance: capture.provenance,
    schema_version: capture.schemaVersion,
  };
}

/**
 * Queue the capture's derived metrics for durable persistence and kick a
 * flush. Throws (without persisting anything) when the capture is missing
 * its calibration or set reference.
 */
export async function saveMotionCapture(
  supabase: OutboxSupabase,
  capture: MotionCapture,
  userId: string
): Promise<void> {
  if (!capture.calibrationId) {
    throw new Error('MotionCapture without a calibrationId is invalid and must not be persisted');
  }
  if (!capture.setId) {
    throw new Error('MotionCapture must reference a set');
  }
  await enqueueRowUpsert(capture.id, 'motion_captures', toMotionCaptureRow(capture, userId));
  // Best-effort immediate flush; on failure the outbox retries later.
  try {
    await flushSetOutbox(supabase);
  } catch {
    // Queued durably — connectivity flushes will pick it up.
  }
}

/** Rounded copy of a sample buffer (keeps raw rows a manageable size). */
export function compactSamples(samples: ImuSample[]): Array<{
  t: number;
  g: [number, number, number];
  a: [number, number, number];
}> {
  const r = (x: number, d: number) => Number(x.toFixed(d));
  return samples.map((s) => ({
    t: r(s.tMs, 1),
    g: [r(s.gyro.x, 5), r(s.gyro.y, 5), r(s.gyro.z, 5)],
    a: [r(s.accel.x, 3), r(s.accel.y, 3), r(s.accel.z, 3)],
  }));
}

export type RawBufferSaveResult = 'saved' | 'session-cap-reached' | 'failed';

/**
 * Opt-in raw buffer persistence. Direct (online) insert, best-effort: a
 * failure never blocks the metrics save. Enforces the per-session cap.
 */
export async function saveRawBufferIfAllowed(
  supabase: SupabaseClient,
  args: {
    captureId: string;
    userId: string;
    workoutSessionId: string;
    samples: ImuSample[];
  }
): Promise<RawBufferSaveResult> {
  if (rawBuffersUsedForSession(args.workoutSessionId) >= RAW_BUFFER_SESSION_CAP) {
    return 'session-cap-reached';
  }
  const { error } = await supabase.from('motion_capture_raw_buffers').insert({
    capture_id: args.captureId,
    user_id: args.userId,
    sample_count: args.samples.length,
    samples: compactSamples(args.samples),
  });
  if (error) return 'failed';
  markRawBufferUsed(args.workoutSessionId);
  return 'saved';
}
