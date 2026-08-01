/**
 * Calibration-free capture analysis: raw IMU samples → rep segmentation,
 * per-rep metrics, and a plottable angular-velocity trace. This is the
 * pipeline behind "record a set and see a graph" — it needs NO machine
 * calibration and never gates on one. Display-only: nothing here feeds
 * prescription, progression, or logged set data (import-guard enforced).
 *
 * Pipeline:
 *   1. 4th-order Butterworth low-pass, 3 Hz cutoff, zero-phase (filtfilt),
 *      per gyro axis. Sample rate is measured, not assumed.
 *   2. Motion mask: |gyro| > 0.4 rad/s.
 *   3. PCA over masked gyro samples → PC1 is the rotation axis. PC1's
 *      variance share is reported; below 0.8 the capture is labeled
 *      low-confidence (motion isn't single-DOF).
 *   4. Project gyro onto PC1 → signed angular velocity w(t).
 *   5. Half-reps from sign changes of w with amplitude hysteresis
 *      (enter |w| > 0.5, exit |w| < 0.15). NO fixed refractory window —
 *      that would bake in a tempo assumption and break fast sets.
 *   6. Pair half-reps (positive then negative) into reps.
 *
 * ROM comes from integrating w over the half-rep between its enclosing
 * zero crossings — NOT between motion-mask boundaries, which clip the
 * ramps and under-read ROM by ~15%.
 *
 * Stillness tier (stillness.ts) never gates any of the above; it only
 * decides whether gravity-based cross-checks are shown.
 */

import type { ImuSample, Vec3 } from '@/types/motion';
import { angleBetweenUnit, dot, meanUnit, normalize } from './vec3';
import { eigenSymmetric3, type Sym3 } from './eigen3';
import { lowpassZeroPhase } from './butterworth';
import { classifyStillness, type StillnessResult, type StillnessTier } from './stillness';
import { DROPPED_DT_FACTOR, RAD_TO_DEG } from './constants';

export const CAPTURE_FILTER_CUTOFF_HZ = 3;
export const CAPTURE_MASK_OMEGA_RADPS = 0.4;
export const CAPTURE_ENTER_OMEGA_RADPS = 0.5;
export const CAPTURE_EXIT_OMEGA_RADPS = 0.15;
export const LOW_CONFIDENCE_PC1_SHARE = 0.8;
/** ± window for the endpoint gravity direction estimate. */
const ENDPOINT_GRAVITY_WINDOW_MS = 120;

export interface CaptureAnalysisOptions {
  cutoffHz?: number;
  maskOmegaRadps?: number;
  enterOmegaRadps?: number;
  exitOmegaRadps?: number;
}

export interface HalfRep {
  dir: 1 | -1;
  /** Zero-crossing-bounded sample span (inclusive). */
  startIdx: number;
  endIdx: number;
  durationMs: number;
  /** |∫w dt| over the span, degrees. */
  romDeg: number;
  peakW: number;
  meanW: number;
  /** 3-D angle between endpoint gravity directions, degrees; null when the
   *  stillness tier is 'none' (accel untrustworthy as gravity). */
  romGravityDeg: number | null;
}

export interface CaptureRep {
  index: number;
  concentric: HalfRep;
  eccentric: HalfRep;
  concentricMs: number;
  eccentricMs: number;
  peakW: number;
  meanWConcentric: number;
  romConcentricDeg: number;
  romEccentricDeg: number;
  romGravityDeg: number | null;
  /**
   * Contiguous time |w| stayed under the exit threshold at the bottom
   * turnaround INTO this rep, ms. Null for the first rep (its bottom is the
   * pre-set rest, not a turnaround).
   */
  bottomDwellMs: number | null;
  /**
   * Peak |dw/dt| within ±150 ms of the eccentric→concentric zero crossing
   * into this rep, rad/s² (Savitzky-Golay differentiated — raw finite
   * differences off a 60 Hz gyro are too noisy). Null for the first rep.
   */
  turnaroundPeakAccelRadps2: number | null;
}

/**
 * Validity of the gravity-ROM cross-check. The accelerometer only resolves
 * rotation PERPENDICULAR to gravity — rotation about a gravity-parallel
 * axis is invisible to it — so the column's meaning degrades as PC1
 * approaches vertical.
 */
export type GravityRomStatus = 'ok' | 'low-confidence' | 'suppressed' | 'unavailable';

/** PC1-to-gravity angle bounds for the gravity-ROM column (degrees). */
export const GRAVITY_ROM_OK_MIN_DEG = 45;
export const GRAVITY_ROM_SUPPRESS_BELOW_DEG = 30;

export interface CaptureAnalysis {
  sampleRateHz: number;
  droppedFrames: number;
  durationMs: number;
  stillness: StillnessResult;
  tier: StillnessTier;
  /** PC1 of the masked gyro scatter; first half-rep direction is positive. */
  axis: Vec3;
  pc1VarianceShare: number;
  pc1Pc2Ratio: number;
  lowConfidence: boolean;
  /**
   * Acute angle between PC1 and the capture's gravity reference, degrees
   * (sign-independent — the axis orientation is a convention). Null when no
   * gravity reference exists (tier 'none').
   */
  pc1GravityAngleDeg: number | null;
  /** Display validity of the gravity-ROM column, derived from the angle. */
  gravityRomStatus: GravityRomStatus;
  /** True when tier === 'none': absolute ROM is suppressed in display. */
  romSuppressed: boolean;
  /** Per-sample series for the chart (filtered, projected). */
  tMs: number[];
  w: number[];
  halfReps: HalfRep[];
  reps: CaptureRep[];
  unpairedHalfReps: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Mean-centered covariance eigen-decomposition of a set of Vec3s.
 *  Exported for consumers that need PCA over a SUBSET of a capture (e.g.
 *  calibration eligibility over rep spans only). */
export function pcaOfVectors(vs: Vec3[]): { axis: Vec3; share: number; ratio: number } | null {
  const n = vs.length;
  if (n < 10) return null;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const v of vs) {
    mx += v.x;
    my += v.y;
    mz += v.z;
  }
  mx /= n;
  my /= n;
  mz /= n;
  const c: Sym3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const v of vs) {
    const x = v.x - mx;
    const y = v.y - my;
    const z = v.z - mz;
    c[0][0] += x * x;
    c[0][1] += x * y;
    c[0][2] += x * z;
    c[1][1] += y * y;
    c[1][2] += y * z;
    c[2][2] += z * z;
  }
  c[1][0] = c[0][1];
  c[2][0] = c[0][2];
  c[2][1] = c[1][2];
  const eig = eigenSymmetric3(c);
  const total = eig.values[0] + eig.values[1] + eig.values[2];
  const axis = normalize(eig.vectors[0]);
  if (!axis || total <= 0) return null;
  return {
    axis,
    share: eig.values[0] / total,
    ratio: eig.values[0] / Math.max(eig.values[1], 1e-12),
  };
}

export function analyzeCapture(
  samples: ImuSample[],
  opts: CaptureAnalysisOptions = {}
): CaptureAnalysis {
  const cutoffHz = opts.cutoffHz ?? CAPTURE_FILTER_CUTOFF_HZ;
  const maskOmega = opts.maskOmegaRadps ?? CAPTURE_MASK_OMEGA_RADPS;
  const enter = opts.enterOmegaRadps ?? CAPTURE_ENTER_OMEGA_RADPS;
  const exit = opts.exitOmegaRadps ?? CAPTURE_EXIT_OMEGA_RADPS;

  const n = samples.length;
  const tMs = samples.map((s) => s.tMs);
  const stillness = classifyStillness(samples);

  const empty = (axis: Vec3): CaptureAnalysis => ({
    sampleRateHz: 0,
    droppedFrames: 0,
    durationMs: n > 0 ? tMs[n - 1] - tMs[0] : 0,
    stillness,
    tier: stillness.tier,
    axis,
    pc1VarianceShare: 0,
    pc1Pc2Ratio: 0,
    lowConfidence: true,
    pc1GravityAngleDeg: null,
    gravityRomStatus: 'unavailable',
    romSuppressed: stillness.tier === 'none',
    tMs,
    w: new Array<number>(n).fill(0),
    halfReps: [],
    reps: [],
    unpairedHalfReps: 0,
  });
  if (n < 16) return empty({ x: 1, y: 0, z: 0 });

  // --- Timing stats (measured dt) ----------------------------------------
  const dts: number[] = [];
  for (let i = 1; i < n; i++) dts.push(tMs[i] - tMs[i - 1]);
  const medianDt = median(dts);
  const sampleRateHz = ((n - 1) / (tMs[n - 1] - tMs[0])) * 1000;
  let droppedFrames = 0;
  if (medianDt > 0) {
    for (const dt of dts) {
      if (dt > DROPPED_DT_FACTOR * medianDt) droppedFrames += Math.round(dt / medianDt) - 1;
    }
  }

  // --- 1. Zero-phase low-pass per gyro axis ------------------------------
  const fx = lowpassZeroPhase(samples.map((s) => s.gyro.x), cutoffHz, sampleRateHz);
  const fy = lowpassZeroPhase(samples.map((s) => s.gyro.y), cutoffHz, sampleRateHz);
  const fz = lowpassZeroPhase(samples.map((s) => s.gyro.z), cutoffHz, sampleRateHz);
  const filtered: Vec3[] = fx.map((x, i) => ({ x, y: fy[i], z: fz[i] }));

  // --- 2+3. Motion mask → PCA axis ---------------------------------------
  const masked = filtered.filter((g) => Math.hypot(g.x, g.y, g.z) > maskOmega);
  const principal = pcaOfVectors(masked) ?? pcaOfVectors(filtered);
  if (!principal) return empty({ x: 1, y: 0, z: 0 });
  let axis = principal.axis;

  // --- 4. Signed angular velocity ----------------------------------------
  let w = filtered.map((g) => dot(g, axis));

  // --- 5. Half-reps: hysteresis excursions, zero-crossing boundaries -----
  const halfReps = segmentHalfReps(w, tMs, enter, exit);

  // Sign convention: concentric must be positive. Anchoring on the first
  // excursion is fragile (a pre-set hand wiggle can qualify and flip the
  // whole capture), so choose the orientation that pairs MORE reps, with
  // ties broken by the physical prior that the pause inside a rep (top,
  // concentric→eccentric) is shorter than the rest between reps.
  if (halfReps.length > 0 && !orientationIsCanonical(halfReps, tMs)) {
    axis = { x: -axis.x, y: -axis.y, z: -axis.z };
    w = w.map((v) => -v);
    for (const h of halfReps) h.dir = (h.dir * -1) as 1 | -1;
  }

  // --- Metrics + gravity cross-check -------------------------------------
  const tierAllowsGravity = stillness.tier !== 'none';
  const finished: HalfRep[] = halfReps.map((h) => {
    let rom = 0;
    let peak = 0;
    let sum = 0;
    for (let i = h.startIdx; i <= h.endIdx; i++) {
      const a = Math.abs(w[i]);
      if (a > peak) peak = a;
      sum += a;
      if (i > h.startIdx) rom += ((w[i] + w[i - 1]) / 2) * ((tMs[i] - tMs[i - 1]) / 1000);
    }
    return {
      dir: h.dir,
      startIdx: h.startIdx,
      endIdx: h.endIdx,
      durationMs: tMs[h.endIdx] - tMs[h.startIdx],
      romDeg: Math.abs(rom) * RAD_TO_DEG,
      peakW: peak,
      meanW: sum / (h.endIdx - h.startIdx + 1),
      romGravityDeg: tierAllowsGravity
        ? gravityAngleBetween(samples, tMs, h.startIdx, h.endIdx)
        : null,
    };
  });

  // --- 6. Pair half-reps into reps ---------------------------------------
  // Bottom-turnaround metrics need dw/dt: Savitzky-Golay differentiate the
  // already-low-passed w (window 9, order 2) — NOT raw finite differences,
  // and NOT second derivatives (jerk off a 60 Hz gyro is noise).
  const dwdt = savitzkyGolayDerivative(w, tMs);

  const reps: CaptureRep[] = [];
  let unpaired = 0;
  let prevEcc: HalfRep | null = null;
  for (let i = 0; i < finished.length; i++) {
    const conc = finished[i];
    if (conc.dir !== 1) {
      unpaired++;
      prevEcc = conc.dir === -1 ? conc : prevEcc;
      continue;
    }
    const ecc = finished[i + 1];
    if (!ecc || ecc.dir !== -1) {
      unpaired++;
      continue;
    }
    i++;

    // Bottom turnaround INTO this rep: only exists when an eccentric
    // preceded it (the first rep starts from rest, not a turnaround).
    let bottomDwellMs: number | null = null;
    let turnaroundPeakAccelRadps2: number | null = null;
    if (prevEcc) {
      bottomDwellMs = dwellAround(w, tMs, conc.startIdx, exit);
      turnaroundPeakAccelRadps2 = peakAbsAround(dwdt, tMs, conc.startIdx, TURNAROUND_WINDOW_MS);
    }
    prevEcc = ecc;

    reps.push({
      index: reps.length,
      concentric: conc,
      eccentric: ecc,
      concentricMs: conc.durationMs,
      eccentricMs: ecc.durationMs,
      peakW: conc.peakW,
      meanWConcentric: conc.meanW,
      romConcentricDeg: conc.romDeg,
      romEccentricDeg: ecc.romDeg,
      romGravityDeg: conc.romGravityDeg,
      bottomDwellMs,
      turnaroundPeakAccelRadps2,
    });
  }

  // --- Gravity-ROM validity: PC1 vs gravity angle ------------------------
  // The accelerometer resolves only rotation perpendicular to gravity, so
  // the cross-check's meaning collapses as PC1 approaches vertical. Acute
  // angle (|dot|): the axis sign is a convention, not physics.
  let pc1GravityAngleDeg: number | null = null;
  let gravityRomStatus: GravityRomStatus = 'unavailable';
  if (stillness.gravityUnit) {
    pc1GravityAngleDeg =
      Math.acos(Math.min(1, Math.abs(dot(axis, stillness.gravityUnit)))) * RAD_TO_DEG;
    gravityRomStatus =
      pc1GravityAngleDeg >= GRAVITY_ROM_OK_MIN_DEG
        ? 'ok'
        : pc1GravityAngleDeg >= GRAVITY_ROM_SUPPRESS_BELOW_DEG
          ? 'low-confidence'
          : 'suppressed';
  }

  return {
    sampleRateHz,
    droppedFrames,
    durationMs: tMs[n - 1] - tMs[0],
    stillness,
    tier: stillness.tier,
    axis,
    pc1VarianceShare: principal.share,
    pc1Pc2Ratio: principal.ratio,
    lowConfidence: principal.share < LOW_CONFIDENCE_PC1_SHARE,
    pc1GravityAngleDeg,
    gravityRomStatus,
    romSuppressed: stillness.tier === 'none',
    tMs,
    w,
    halfReps: finished,
    reps,
    unpairedHalfReps: unpaired,
  };
}

interface RawHalfRep {
  dir: 1 | -1;
  startIdx: number;
  endIdx: number;
}

/** Pairing stats for one orientation: rep count + median within-pair gap. */
function pairingStats(
  halfReps: RawHalfRep[],
  tMs: number[],
  sign: 1 | -1
): { reps: number; medianGapMs: number } {
  const gaps: number[] = [];
  let reps = 0;
  for (let i = 0; i < halfReps.length; i++) {
    if (halfReps[i].dir !== sign) continue;
    const next = halfReps[i + 1];
    if (!next || next.dir === sign) continue;
    reps++;
    gaps.push(Math.max(0, tMs[next.startIdx] - tMs[halfReps[i].endIdx]));
    i++;
  }
  gaps.sort((a, b) => a - b);
  const medianGapMs =
    gaps.length === 0
      ? Number.POSITIVE_INFINITY
      : gaps.length % 2
        ? gaps[(gaps.length - 1) / 2]
        : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
  return { reps, medianGapMs };
}

/** True when the current dirs already put the concentric positive. */
function orientationIsCanonical(halfReps: RawHalfRep[], tMs: number[]): boolean {
  const asIs = pairingStats(halfReps, tMs, 1);
  const flipped = pairingStats(halfReps, tMs, -1);
  if (asIs.reps !== flipped.reps) return asIs.reps > flipped.reps;
  if (asIs.medianGapMs !== flipped.medianGapMs) return asIs.medianGapMs <= flipped.medianGapMs;
  return halfReps[0].dir === 1;
}

/**
 * Hysteresis excursions merged into sign-run half-reps, each expanded to
 * its enclosing zero crossings (a small deadband stands in for "zero" so
 * near-zero noise during pauses doesn't stretch boundaries through them).
 * Deliberately NO refractory window.
 */
function segmentHalfReps(
  w: number[],
  tMs: number[],
  enter: number,
  exit: number
): RawHalfRep[] {
  // Hysteresis state machine → qualifying excursions.
  const excursions: RawHalfRep[] = [];
  let state: 0 | 1 | -1 = 0;
  let startIdx = 0;
  for (let i = 0; i < w.length; i++) {
    if (state === 0) {
      if (Math.abs(w[i]) >= enter) {
        state = w[i] > 0 ? 1 : -1;
        startIdx = i;
      }
    } else if (Math.abs(w[i]) <= exit) {
      excursions.push({ dir: state, startIdx, endIdx: i });
      state = 0;
    }
  }
  if (state !== 0) excursions.push({ dir: state, startIdx, endIdx: w.length - 1 });

  // Merge consecutive same-direction excursions (a mid-stroke slowdown that
  // dips under the exit threshold is still the same half-rep; only an
  // opposite-direction excursion ends it) — but only across BRIEF gaps. A
  // sticking point is a sub-second grind; a second-plus of quiet between
  // same-sign excursions means two separate movements (e.g. the last
  // eccentric and a later same-sign fidget), which must never fuse into one
  // giant half-rep.
  const MERGE_MAX_GAP_MS = 750;
  const merged: RawHalfRep[] = [];
  for (const e of excursions) {
    const last = merged[merged.length - 1];
    if (last && last.dir === e.dir && tMs[e.startIdx] - tMs[last.endIdx] <= MERGE_MAX_GAP_MS) {
      last.endIdx = e.endIdx;
    } else {
      merged.push({ ...e });
    }
  }

  // Expand each to its enclosing ZERO CROSSINGS (the true rep boundaries —
  // stopping at any velocity deadband instead would clip the slow ramps of
  // high-curvature profiles and under-read durations/ROM). A second stop at
  // a local minimum below the exit threshold guards the other failure:
  // without it, sub-threshold same-sign drift right before a set (settling
  // motion) would be absorbed into the first rep and stretch it.
  const VALLEY_RISE = 0.015;
  for (const h of merged) {
    let s = h.startIdx;
    while (s > 0) {
      const prev = w[s - 1] * h.dir;
      const cur = w[s] * h.dir;
      if (prev <= 0) break;
      if (cur < exit && prev > cur + VALLEY_RISE) break;
      s--;
    }
    let e = h.endIdx;
    while (e < w.length - 1) {
      const next = w[e + 1] * h.dir;
      const cur = w[e] * h.dir;
      if (next <= 0) break;
      if (cur < exit && next > cur + VALLEY_RISE) break;
      e++;
    }
    h.startIdx = trimShelf(w, tMs, s, e, h.dir, +1);
    h.endIdx = trimShelf(w, tMs, e, h.startIdx, h.dir, -1);
  }

  // Guard against degenerate overlaps after expansion (adjacent half-reps
  // sharing a boundary sample are fine; containment is not expected).
  return merged.filter((h) => h.endIdx > h.startIdx);
}

/** ± window around the eccentric→concentric crossing for turnaround accel. */
const TURNAROUND_WINDOW_MS = 150;

/**
 * Savitzky-Golay first derivative (window 9, polynomial order 2) of a
 * uniformly-ish sampled series. For quadratic fits the derivative estimate
 * at the window center is Σ j·y[i+j] / (Σ j² · dt), j = −4..4 — a linear
 * smoother far better conditioned than raw finite differences on 60 Hz
 * data. Edges fall back to one-sided differences.
 */
export function savitzkyGolayDerivative(y: number[], tMs: number[]): number[] {
  const n = y.length;
  const out = new Array<number>(n).fill(0);
  if (n < 2) return out;
  const dts: number[] = [];
  for (let i = 1; i < n; i++) dts.push(tMs[i] - tMs[i - 1]);
  const dtS = median(dts) / 1000;
  if (dtS <= 0) return out;

  const HALF = 4; // window 9
  const denom = 60 * dtS; // Σ j² for j=−4..4 is 60
  for (let i = 0; i < n; i++) {
    if (i < HALF || i >= n - HALF) {
      const j0 = Math.max(0, i - 1);
      const j1 = Math.min(n - 1, i + 1);
      const dt = (tMs[j1] - tMs[j0]) / 1000;
      out[i] = dt > 0 ? (y[j1] - y[j0]) / dt : 0;
      continue;
    }
    let acc = 0;
    for (let j = -HALF; j <= HALF; j++) acc += j * y[i + j];
    out[i] = acc / denom;
  }
  return out;
}

/** Contiguous ms |w| stays below `threshold` around sample `centerIdx`. */
function dwellAround(w: number[], tMs: number[], centerIdx: number, threshold: number): number {
  let lo = centerIdx;
  while (lo > 0 && Math.abs(w[lo - 1]) < threshold) lo--;
  let hi = centerIdx;
  while (hi < w.length - 1 && Math.abs(w[hi + 1]) < threshold) hi++;
  return Math.max(0, tMs[hi] - tMs[lo]);
}

/** Max |series| within ±windowMs of sample `centerIdx`. */
function peakAbsAround(
  series: number[],
  tMs: number[],
  centerIdx: number,
  windowMs: number
): number {
  const t = tMs[centerIdx];
  let peak = 0;
  for (let i = centerIdx; i >= 0 && t - tMs[i] <= windowMs; i--) {
    peak = Math.max(peak, Math.abs(series[i]));
  }
  for (let i = centerIdx + 1; i < series.length && tMs[i] - t <= windowMs; i++) {
    peak = Math.max(peak, Math.abs(series[i]));
  }
  return peak;
}

/** |w| below this is indistinguishable from gyro bias/tremor at rest. */
const SHELF_FLOOR_RADPS = 0.03;
/** A sub-floor tail lingering longer than this is a rest shelf, not a ramp. */
const SHELF_MAX_TAIL_MS = 150;

/**
 * Trim a flat near-zero shelf off a half-rep boundary. Real captures show
 * long stretches of w ≈ +0.01 (gyro bias) at rest that never cross zero, so
 * the zero-crossing walk would absorb them and stretch durations by half a
 * second. The discriminator is DWELL TIME, not amplitude: a genuine stroke
 * ramp passes through the sub-floor band in a few samples; a rest shelf
 * lingers. Tails under the floor for longer than SHELF_MAX_TAIL_MS are cut
 * to their inner edge; brief dips are kept (they are the ramp).
 */
function trimShelf(
  w: number[],
  tMs: number[],
  boundary: number,
  limit: number,
  dir: 1 | -1,
  inward: 1 | -1
): number {
  let i = boundary;
  while (i !== limit && Math.abs(w[i]) < SHELF_FLOOR_RADPS) i += inward;
  if (i === boundary) return boundary;
  const dwellMs = Math.abs(tMs[i] - tMs[boundary]);
  return dwellMs > SHELF_MAX_TAIL_MS ? i : boundary;
}

/** 3-D angle between mean gravity directions around two sample indices. */
function gravityAngleBetween(
  samples: ImuSample[],
  tMs: number[],
  aIdx: number,
  bIdx: number
): number | null {
  const dirAt = (center: number): Vec3 | null => {
    const units: Vec3[] = [];
    for (
      let i = center;
      i >= 0 && tMs[center] - tMs[i] <= ENDPOINT_GRAVITY_WINDOW_MS;
      i--
    ) {
      const u = normalize(samples[i].accel);
      if (u) units.push(u);
    }
    for (
      let i = center + 1;
      i < samples.length && tMs[i] - tMs[center] <= ENDPOINT_GRAVITY_WINDOW_MS;
      i++
    ) {
      const u = normalize(samples[i].accel);
      if (u) units.push(u);
    }
    return meanUnit(units);
  };
  const a = dirAt(aIdx);
  const b = dirAt(bIdx);
  if (!a || !b) return null;
  return angleBetweenUnit(a, b) * RAD_TO_DEG;
}
