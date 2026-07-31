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

/**
 * Per the W3C DeviceMotionEvent spec, `rotationRate` is reported in
 * DEGREES per second. The pure signal layer works exclusively in rad/s, and
 * this named constant at the single ingest boundary is the ONLY place the
 * conversion happens — nothing downstream may convert again.
 */
const ROTATION_RATE_DEG_PER_S_TO_RAD_PER_S = Math.PI / 180;

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
      gyro: {
        x: rr.beta * ROTATION_RATE_DEG_PER_S_TO_RAD_PER_S,
        y: rr.gamma * ROTATION_RATE_DEG_PER_S_TO_RAD_PER_S,
        z: rr.alpha * ROTATION_RATE_DEG_PER_S_TO_RAD_PER_S,
      },
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

