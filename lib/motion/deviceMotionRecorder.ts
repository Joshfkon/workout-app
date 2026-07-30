/**
 * DeviceMotion sensor access for the motion-capture feature. This is the
 * ONLY layer that touches the sensors — everything downstream consumes
 * normalized ImuSample[] and lives in services/shared/motion (pure).
 *
 * Units: DeviceMotionEvent reports rotationRate in deg/s — converted to
 * rad/s here. accelerationIncludingGravity is already m/s². Timestamps are
 * performance.now() so the pipeline integrates over measured dt.
 */

import type { ImuSample } from '@/types/motion';

const DEG_TO_RAD = Math.PI / 180;

export type MotionPermission = 'granted' | 'denied' | 'unsupported';

/**
 * Request DeviceMotion permission. On iOS ≥13 this MUST be called from
 * inside a user-gesture handler (the ARM tap) — calling it elsewhere
 * silently rejects. Browsers without the permission gate just grant.
 */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') {
    return 'unsupported';
  }
  const ctor = DeviceMotionEvent as unknown as {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  };
  if (typeof ctor.requestPermission === 'function') {
    try {
      return (await ctor.requestPermission()) === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }
  return 'granted';
}

export interface MotionRecorderHandle {
  /** Stop listening and return everything captured so far. */
  stop(): ImuSample[];
  sampleCount(): number;
}

/**
 * Start collecting devicemotion samples immediately. Events missing either
 * channel (some Android WebViews emit partial events) are skipped — the
 * pipeline's dt-gap accounting reports them as dropped samples.
 */
export function startMotionRecorder(onSample?: (s: ImuSample) => void): MotionRecorderHandle {
  const samples: ImuSample[] = [];

  const handler = (e: DeviceMotionEvent) => {
    const rr = e.rotationRate;
    const acc = e.accelerationIncludingGravity;
    if (!rr || !acc) return;
    if (rr.alpha === null || rr.beta === null || rr.gamma === null) return;
    if (acc.x === null || acc.y === null || acc.z === null) return;
    const sample: ImuSample = {
      tMs: performance.now(),
      // rotationRate: alpha is about z, beta about x, gamma about y.
      gyro: { x: rr.beta * DEG_TO_RAD, y: rr.gamma * DEG_TO_RAD, z: rr.alpha * DEG_TO_RAD },
      accel: { x: acc.x, y: acc.y, z: acc.z },
    };
    samples.push(sample);
    onSample?.(sample);
  };

  window.addEventListener('devicemotion', handler);
  let stopped = false;
  return {
    stop() {
      if (!stopped) {
        stopped = true;
        window.removeEventListener('devicemotion', handler);
      }
      return samples;
    },
    sampleCount: () => samples.length,
  };
}

/**
 * Collect samples for a fixed window (calibration holds / transit sweeps).
 * Resolves with everything captured during the window.
 */
export function recordForDuration(durationMs: number): Promise<ImuSample[]> {
  return new Promise((resolve) => {
    const recorder = startMotionRecorder();
    window.setTimeout(() => resolve(recorder.stop()), durationMs);
  });
}
