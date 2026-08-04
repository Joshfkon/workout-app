/**
 * Strict quasi-static gravity-reference capture.
 *
 * A gravity vector may ONLY be read off the accelerometer when the device
 * is provably still: | |a| − g | < 0.3 m/s² AND |ω| < 5 °/s, both holding
 * contiguously for ≥ 200 ms of MEASURED time. Every consumer that wants a
 * gravity reference — sweep-calibration endpoints, per-rep integrity
 * windows — must go through this validator; a dynamic sample silently
 * accepted as "gravity" corrupts every angle derived from it, so failure
 * is surfaced ("arm was still moving"), never papered over.
 */

import type { ImuSample, Vec3 } from '@/types/motion';
import { meanUnit, norm, normalize } from './vec3';
import {
  G_MPS2,
  GRAVITY_REF_ACCEL_TOL_MPS2,
  GRAVITY_REF_MIN_WINDOW_MS,
  GRAVITY_REF_OMEGA_MAX_RADPS,
} from './constants';

export interface GravityRef {
  /** Mean gravity direction (unit vector) over the validated window. */
  unit: Vec3;
  /** Length of the validated window, ms (measured dt). */
  windowMs: number;
  /** Inclusive sample-index bounds of the validated window. */
  startIdx: number;
  endIdx: number;
}

/** True when this single sample satisfies both stillness bounds. */
export function isGravityRefSample(s: ImuSample): boolean {
  return (
    Math.abs(norm(s.accel) - G_MPS2) < GRAVITY_REF_ACCEL_TOL_MPS2 &&
    norm(s.gyro) < GRAVITY_REF_OMEGA_MAX_RADPS
  );
}

/**
 * Find the longest contiguous run of samples in [startIdx, endIdx] where
 * both stillness bounds hold, and return its mean gravity direction —
 * or null when no run sustains ≥ 200 ms. Null means "arm was still
 * moving": the caller must reject, not fall back to a dynamic sample.
 */
export function findGravityRef(
  samples: ImuSample[],
  startIdx: number,
  endIdx: number
): GravityRef | null {
  let best: { s: number; e: number } | null = null;
  let runStart = -1;
  const close = (runEnd: number) => {
    if (runStart === -1) return;
    if (
      !best ||
      samples[runEnd].tMs - samples[runStart].tMs > samples[best.e].tMs - samples[best.s].tMs
    ) {
      best = { s: runStart, e: runEnd };
    }
    runStart = -1;
  };

  const lo = Math.max(0, startIdx);
  const hi = Math.min(samples.length - 1, endIdx);
  for (let i = lo; i <= hi; i++) {
    if (isGravityRefSample(samples[i])) {
      if (runStart === -1) runStart = i;
    } else {
      close(i - 1);
    }
  }
  close(hi);

  if (!best) return null;
  const { s, e } = best as { s: number; e: number };
  const windowMs = samples[e].tMs - samples[s].tMs;
  if (windowMs < GRAVITY_REF_MIN_WINDOW_MS) return null;

  const units: Vec3[] = [];
  for (let i = s; i <= e; i++) {
    const u = normalize(samples[i].accel);
    if (u) units.push(u);
  }
  const unit = meanUnit(units);
  if (!unit) return null;
  return { unit, windowMs, startIdx: s, endIdx: e };
}

/** The user-facing explanation for a null gravity reference. */
export const GRAVITY_REF_FAIL_HINT =
  'arm was still moving — hold briefly at the endpoint';
