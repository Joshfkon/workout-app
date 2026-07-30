/**
 * Persistence for motion captures. Two paths, deliberately different:
 *
 *  - Derived per-rep metrics (MotionCapture) go through the offline outbox —
 *    durable across tab closes, idempotent on retry, and enqueued after the
 *    set's own row so the set_id FK is satisfied at flush time. The flush
 *    RESULT is inspected: a server rejection (RLS, missing set/calibration)
 *    surfaces as an error instead of a phantom "saved".
 *  - Raw sample buffers are OPT-IN (users.motion_capture_raw_retention),
 *    best-effort direct inserts, and capped per workout session with the
 *    count taken from the SERVER (shared across tabs/devices) — they exist
 *    for offline analysis by one user and must not bloat the primary store.
 *
 * INVARIANT (constraint #3): a capture without a calibrationId is invalid
 * and is never persisted — enforced here before enqueue and again by the
 * NOT NULL FK in the database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImuSample, MotionCapture } from '@/types/motion';
import {
  enqueueRowUpsert,
  flushSetOutbox,
  removeQueuedSet,
  type OutboxSupabase,
} from '@/lib/offline/setOutbox';

/** Max raw buffers persisted per workout session (storage-bloat guard). */
export const RAW_BUFFER_SESSION_CAP = 3;

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

export type SaveMotionCaptureResult =
  /** The row is confirmed in the database. */
  | 'synced'
  /** The row is durably queued (offline / flaky network) and will sync. */
  | 'queued';

/**
 * Queue the capture's derived metrics and flush. Distinguishes the three
 * real outcomes instead of reporting success unconditionally:
 *  - flushed        → 'synced'
 *  - network-failed → 'queued' (outbox retries when connectivity returns)
 *  - server-REJECTED (RLS, deleted set/calibration, constraint) → the entry
 *    is dequeued and an error is thrown; retrying a rejection forever would
 *    only end in the outbox silently dropping it after the attempt cap.
 *
 * Throws (without persisting anything) when the capture is missing its
 * calibration or set reference.
 */
export async function saveMotionCapture(
  supabase: OutboxSupabase,
  capture: MotionCapture,
  userId: string
): Promise<SaveMotionCaptureResult> {
  if (!capture.calibrationId) {
    throw new Error('MotionCapture without a calibrationId is invalid and must not be persisted');
  }
  if (!capture.setId) {
    throw new Error('MotionCapture must reference a set');
  }
  await enqueueRowUpsert(capture.id, 'motion_captures', toMotionCaptureRow(capture, userId));

  let result: Awaited<ReturnType<typeof flushSetOutbox>> | null = null;
  try {
    result = await flushSetOutbox(supabase);
  } catch {
    // Flush machinery itself failed — entry is still queued durably.
    return 'queued';
  }

  if (result.rejectedIds.includes(capture.id)) {
    // The server answered and refused the row. Leaving it queued would just
    // burn retries and then vanish — remove it and tell the caller loudly.
    await removeQueuedSet(capture.id).catch(() => {});
    throw new Error(
      'The server rejected this capture (its set or calibration may no longer exist)'
    );
  }
  return result.flushedIds.includes(capture.id) ? 'synced' : 'queued';
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

export interface RawBufferSaveResult {
  status: 'saved' | 'session-cap-reached' | 'failed';
  /** Raw buffers now stored for this workout session (when known). */
  usedThisSession: number | null;
}

/**
 * Opt-in raw buffer persistence. Direct (online) insert, best-effort: a
 * failure never blocks the metrics save. The per-session cap is counted
 * against the server so extra tabs, reloads, or a second device share one
 * budget; if the count can't be read, no raw is uploaded (conservative).
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
  const { count, error: countError } = await supabase
    .from('motion_capture_raw_buffers')
    .select('capture_id', { count: 'exact', head: true })
    .eq('workout_session_id', args.workoutSessionId);
  if (countError || count === null) return { status: 'failed', usedThisSession: null };
  if (count >= RAW_BUFFER_SESSION_CAP) {
    return { status: 'session-cap-reached', usedThisSession: count };
  }

  const { error } = await supabase.from('motion_capture_raw_buffers').insert({
    capture_id: args.captureId,
    user_id: args.userId,
    workout_session_id: args.workoutSessionId,
    sample_count: args.samples.length,
    samples: compactSamples(args.samples),
  });
  if (error) return { status: 'failed', usedThisSession: count };
  return { status: 'saved', usedThisSession: count + 1 };
}
