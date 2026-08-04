/**
 * Tiered stillness classification — replaces the old pass/fail still-period
 * gate that blocked any sweep without a near-perfect mount rest.
 *
 * Three tiers, evaluated on gyro magnitude over sliding windows:
 *
 *   mounted  : |gyro| < 0.05 rad/s sustained ≥ 0.5 s
 *   handheld : |gyro| < 0.25 rad/s sustained ≥ 0.4 s
 *              AND accel direction stable within a ~5° cone
 *   none     : no qualifying window
 *
 * ALL tiers proceed — the tier only affects what downstream display shows
 * and how it's labeled ('none' suppresses absolute ROM; reps and velocity
 * survive). The gravity reference comes from the BEST qualifying window,
 * never from averaging accel over the whole capture: during cyclic motion
 * that average lands tens of degrees off with a shrunken magnitude, which
 * is worse than admitting there is no reference.
 */

import type { ImuSample, Vec3 } from '@/types/motion';
import { angleBetweenUnit, meanUnit, norm, normalize } from './vec3';
import { RAD_TO_DEG } from './constants';

export type StillnessTier = 'mounted' | 'handheld' | 'none';

export const MOUNTED_GYRO_MAX_RADPS = 0.05;
export const MOUNTED_MIN_MS = 500;
export const HANDHELD_GYRO_MAX_RADPS = 0.25;
export const HANDHELD_MIN_MS = 400;
export const HANDHELD_CONE_MAX_DEG = 5;

export interface StillnessResult {
  tier: StillnessTier;
  /** Best qualifying window (inclusive sample indices); null for 'none'. */
  window: { startIdx: number; endIdx: number } | null;
  /** Mean gravity direction over the best window; null for 'none'. */
  gravityUnit: Vec3 | null;
  /** Mean |gyro| over the best window (rad/s); null for 'none'. */
  windowMeanGyro: number | null;
  /**
   * True when sub-mounted still-ish periods exist but none qualified even
   * as handheld (cone/duration failed). Display copy should say the phone
   * appears hand-held / unsteady — "hold still longer" does not fix this.
   */
  nearMissHandheld: boolean;
}

interface Run {
  startIdx: number;
  endIdx: number;
}

/** Contiguous runs where |gyro| stays below `maxRadps` for ≥ `minMs`. */
function quietRuns(samples: ImuSample[], maxRadps: number, minMs: number): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let i = 0; i <= samples.length; i++) {
    const ok = i < samples.length && norm(samples[i].gyro) < maxRadps;
    if (ok && start === -1) start = i;
    if (!ok && start !== -1) {
      if (samples[i - 1].tMs - samples[start].tMs >= minMs) runs.push({ startIdx: start, endIdx: i - 1 });
      start = -1;
    }
  }
  return runs;
}

function meanGyro(samples: ImuSample[], run: Run): number {
  let sum = 0;
  for (let i = run.startIdx; i <= run.endIdx; i++) sum += norm(samples[i].gyro);
  return sum / (run.endIdx - run.startIdx + 1);
}

/** Accel-direction cone: every sample within `maxDeg` of the window mean. */
function coneHolds(samples: ImuSample[], run: Run, maxDeg: number): Vec3 | null {
  const units: Vec3[] = [];
  for (let i = run.startIdx; i <= run.endIdx; i++) {
    const u = normalize(samples[i].accel);
    if (!u) return null;
    units.push(u);
  }
  const mean = meanUnit(units);
  if (!mean) return null;
  for (const u of units) {
    if (angleBetweenUnit(u, mean) * RAD_TO_DEG > maxDeg) return null;
  }
  return mean;
}

/**
 * Find the best handheld sub-window inside a quiet run: slide a minMs
 * window and take the first position where the accel cone holds. (The full
 * run can fail the cone from a single adjustment while a sub-window is
 * clean.)
 */
function bestHandheldWindow(samples: ImuSample[], run: Run): { run: Run; gravity: Vec3 } | null {
  // Whole run first — cheapest and usually sufficient.
  const whole = coneHolds(samples, run, HANDHELD_CONE_MAX_DEG);
  if (whole) return { run, gravity: whole };

  const stepMs = 100;
  for (let s = run.startIdx; s <= run.endIdx; ) {
    let e = s;
    while (e + 1 <= run.endIdx && samples[e + 1].tMs - samples[s].tMs <= HANDHELD_MIN_MS) e++;
    if (samples[e].tMs - samples[s].tMs >= HANDHELD_MIN_MS - 1) {
      const sub = { startIdx: s, endIdx: e };
      const g = coneHolds(samples, sub, HANDHELD_CONE_MAX_DEG);
      if (g) return { run: sub, gravity: g };
    }
    const sStart = samples[s].tMs;
    while (s <= run.endIdx && samples[s].tMs - sStart < stepMs) s++;
    if (e >= run.endIdx && samples[run.endIdx].tMs - sStart < HANDHELD_MIN_MS) break;
  }
  return null;
}

export function classifyStillness(samples: ImuSample[]): StillnessResult {
  // Mounted: strictest gyro bound, longest sustain. Best = stillest.
  const mountedRuns = quietRuns(samples, MOUNTED_GYRO_MAX_RADPS, MOUNTED_MIN_MS);
  if (mountedRuns.length > 0) {
    const best = mountedRuns.reduce((a, b) => (meanGyro(samples, b) < meanGyro(samples, a) ? b : a));
    const units: Vec3[] = [];
    for (let i = best.startIdx; i <= best.endIdx; i++) {
      const u = normalize(samples[i].accel);
      if (u) units.push(u);
    }
    return {
      tier: 'mounted',
      window: best,
      gravityUnit: meanUnit(units),
      windowMeanGyro: meanGyro(samples, best),
      nearMissHandheld: false,
    };
  }

  // Handheld: looser gyro bound, shorter sustain, but the accel direction
  // must hold a ~5° cone — that is what separates "held steady in a hand"
  // from "waving around slowly".
  const handheldRuns = quietRuns(samples, HANDHELD_GYRO_MAX_RADPS, HANDHELD_MIN_MS);
  let bestHandheld: { run: Run; gravity: Vec3; mean: number } | null = null;
  for (const run of handheldRuns) {
    const found = bestHandheldWindow(samples, run);
    if (!found) continue;
    const mean = meanGyro(samples, found.run);
    if (!bestHandheld || mean < bestHandheld.mean) {
      bestHandheld = { run: found.run, gravity: found.gravity, mean };
    }
  }
  if (bestHandheld) {
    return {
      tier: 'handheld',
      window: bestHandheld.run,
      gravityUnit: bestHandheld.gravity,
      windowMeanGyro: bestHandheld.mean,
      nearMissHandheld: false,
    };
  }

  return {
    tier: 'none',
    window: null,
    gravityUnit: null,
    windowMeanGyro: null,
    nearMissHandheld: handheldRuns.length > 0,
  };
}
