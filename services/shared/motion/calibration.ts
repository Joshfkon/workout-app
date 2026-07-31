/**
 * Sweep-based machine calibration.
 *
 * The user taps START with the phone in hand, sets it on the mount,
 * performs ~3 slow full-ROM reps (unloaded or light), retrieves the phone,
 * and taps STOP. Two taps total, both with the phone in hand — no taps at
 * ROM endpoints (the phone is unreachable and unreadable there).
 *
 * Why not two static gravity holds (the previous approach): recovering a
 * rotation axis from two gravity vectors is ILL-POSED — the set of
 * rotations mapping g_start to g_end is a one-parameter family, so the
 * axis component parallel to gravity is unrecoverable. Any axis picked from
 * that family under-projects the gyro by cos(misalignment); a field test
 * measured 47.4° integrated vs 72.0° actual. The pivot axis must come from
 * the gyro itself:
 *
 *   1. TRIM to the mounted span: everything between the first and last long
 *      quasi-static rest (phone sitting on the mount). In-hand handling
 *      before/after — fast, multi-axis, exactly what would poison a
 *      rate-weighted estimate — is discarded.
 *   2. AXIS: scatter matrix M = Σ ω ωᵀ over moving samples in the span; the
 *      principal eigenvector (Jacobi, eigen3.ts) is the pivot axis. The
 *      eigenvalue ratio λ1/(λ2+λ3) is the axis-quality metric — a genuine
 *      single-DOF machine is overwhelmingly planar; wobble drops the ratio
 *      and rejects the sweep.
 *   3. SIGN: flipped so the first stroke (concentric — a press starts at
 *      the bottom) integrates positive.
 *   4. ANGLE: project ω onto the axis, integrate over measured dt, ZUPT at
 *      each quasi-static rest (bias re-zero + drift snap to the
 *      gravity-projected angle). Stroke ROMs are endpoint-to-endpoint.
 *   5. GRAVITY AS CHECK, not estimator: per stroke, (a) the 3-D angle
 *      between endpoint gravity unit vectors is a strict lower bound on the
 *      true rotation — an integrated angle below it is definitive proof the
 *      gyro path is wrong (hard error); (b) forward-prediction — rotating
 *      the start gravity about the axis by the integrated angle must land
 *      on the end gravity within tolerance.
 */

import type { ImuSample, Vec3 } from '@/types/motion';
import {
  angleBetweenUnit,
  dot,
  meanUnit,
  norm,
  normalize,
  rotateAbout,
  scale,
  signedAngleAbout,
} from './vec3';
import { eigenSymmetric3, type Sym3 } from './eigen3';
import { findGravityRef, GRAVITY_REF_FAIL_HINT } from './gravityRef';
import { isQuasiStatic } from './gravity';
import {
  AXIS_QUALITY_MIN,
  GRAVITY_LOWER_BOUND_TOL_DEG,
  INTEGRITY_MAX_ERROR_DEG,
  MIN_CALIBRATION_ROM_DEG,
  MIN_PHASE_DEG,
  MIN_SWEEP_STROKES,
  RAD_TO_DEG,
  REST_MIN_MS,
  REST_OMEGA_RADPS,
  SCATTER_MOTION_OMEGA_RADPS,
  SWEEP_MOUNT_REST_MS,
  SWEEP_STROKE_SPREAD_MAX_DEG,
} from './constants';

export interface SweepCalibrationOptions {
  axisQualityMin?: number;
  scatterMotionOmegaRadps?: number;
  mountRestMs?: number;
}

export interface SweepCalibrationDerivation {
  valid: boolean;
  reason: string | null;
  /** Unit pivot axis, phone frame; concentric (first-stroke) direction positive. */
  pivotAxis: Vec3 | null;
  /** λ1/(λ2+λ3) of the motion scatter — planarity of the sweep. */
  axisQuality: number | null;
  /** Median endpoint-to-endpoint stroke ROM, degrees. */
  romDegrees: number | null;
  strokeCount: number;
  strokeRomsDeg: number[];
  /** Mean endpoint gravity UNIT vectors (bottom / top of the ROM). */
  gravityRefBottom: Vec3 | null;
  gravityRefTop: Vec3 | null;
  /** Worst per-stroke forward-prediction residual, degrees. */
  maxGravityResidualDeg: number | null;
}

interface RestWindow {
  startIdx: number;
  endIdx: number;
  /** Mean unit gravity over the window (windows are quasi-static by construction). */
  gravityUnit: Vec3;
  /** Integrated angle entering the window (pre-ZUPT-snap), rad. */
  thetaPre: number;
  /** Integrated angle leaving the window (post-snap), rad. */
  thetaPost: number;
}

function invalid(reason: string): SweepCalibrationDerivation {
  return {
    valid: false,
    reason,
    pivotAxis: null,
    axisQuality: null,
    romDegrees: null,
    strokeCount: 0,
    strokeRomsDeg: [],
    gravityRefBottom: null,
    gravityRefTop: null,
    maxGravityResidualDeg: null,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function deriveSweepCalibration(
  samples: ImuSample[],
  opts: SweepCalibrationOptions = {}
): SweepCalibrationDerivation {
  const qualityMin = opts.axisQualityMin ?? AXIS_QUALITY_MIN;
  const motionOmega = opts.scatterMotionOmegaRadps ?? SCATTER_MOTION_OMEGA_RADPS;
  const mountRestMs = opts.mountRestMs ?? SWEEP_MOUNT_REST_MS;

  if (samples.length < 100) {
    return invalid('Too few sensor readings — is motion access working?');
  }
  const t = samples.map((s) => s.tMs);

  // --- 1. Trim to the mounted span ---------------------------------------
  // Long quasi-static rests can only happen with the phone sitting on the
  // mount; in-hand handling never holds that still. First → last long rest
  // bounds the analysis; handling outside is discarded.
  const still = samples.map((s) => norm(s.gyro) < REST_OMEGA_RADPS * 1.5 && isQuasiStatic(s.accel));
  const longRests: Array<{ startIdx: number; endIdx: number }> = [];
  let runStart = -1;
  for (let i = 0; i <= samples.length; i++) {
    const r = i < samples.length && still[i];
    if (r && runStart === -1) runStart = i;
    if (!r && runStart !== -1) {
      if (t[i - 1] - t[runStart] >= mountRestMs) longRests.push({ startIdx: runStart, endIdx: i - 1 });
      runStart = -1;
    }
  }
  if (longRests.length < 2) {
    return invalid(
      'Could not find still periods on the mount. Let the arm sit completely still ' +
        'for a moment after mounting the phone and again before picking it up.'
    );
  }
  const spanStart = longRests[0].startIdx;
  const spanEnd = longRests[longRests.length - 1].endIdx;

  // --- 2. Axis from the gyro scatter matrix ------------------------------
  const scatter: Sym3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let motionCount = 0;
  for (let i = spanStart; i <= spanEnd; i++) {
    const g = samples[i].gyro;
    if (norm(g) < motionOmega) continue;
    motionCount++;
    scatter[0][0] += g.x * g.x;
    scatter[0][1] += g.x * g.y;
    scatter[0][2] += g.x * g.z;
    scatter[1][1] += g.y * g.y;
    scatter[1][2] += g.y * g.z;
    scatter[2][2] += g.z * g.z;
  }
  scatter[1][0] = scatter[0][1];
  scatter[2][0] = scatter[0][2];
  scatter[2][1] = scatter[1][2];

  if (motionCount < 50) {
    return invalid('Not enough movement between the still periods — do 3 slow full-range reps.');
  }

  const eig = eigenSymmetric3(scatter);
  const axisQuality = eig.values[0] / Math.max(eig.values[1] + eig.values[2], 1e-12);
  if (axisQuality < qualityMin) {
    return {
      ...invalid(
        `Motion wasn't planar enough (axis quality ${axisQuality.toFixed(1)}, ` +
          `need ≥ ${qualityMin}). The mount may be loose or on a member that ` +
          'moves in more than one plane — secure it to the rotating arm and redo the sweep.'
      ),
      axisQuality,
    };
  }
  let axis = normalize(eig.vectors[0]);
  if (!axis) return invalid('Degenerate axis estimate.');

  // --- 3+4. Integrate the projection with ZUPT; collect rest windows -----
  // Runs twice at most: if the first stroke integrates negative the axis is
  // flipped (concentric must be positive) and the pass repeats.
  let rejectedStillWindows = 0;
  const analyze = (n: Vec3) => {
    rejectedStillWindows = 0;
    const omega = samples.map((s) => dot(s.gyro, n));
    let bias =
      longRests[0].endIdx > longRests[0].startIdx
        ? omega.slice(longRests[0].startIdx, longRests[0].endIdx + 1).reduce((a, b) => a + b, 0) /
          (longRests[0].endIdx - longRests[0].startIdx + 1)
        : 0;

    // Rest detection within the span (shorter than mount rests: any ≥250 ms
    // quasi-static endpoint counts, e.g. brief pauses at the top).
    const resting = (i: number) =>
      Math.abs(omega[i] - bias) < REST_OMEGA_RADPS && isQuasiStatic(samples[i].accel);

    const theta = new Array<number>(samples.length).fill(0);
    const windows: RestWindow[] = [];
    // Gravity reference for the projected drift snap: the first mount rest.
    let gravityRef: Vec3 | null = null;
    let rs = -1;

    // Close a rest run ending at sample `re`, applying the ZUPT (bias
    // re-zero + drift snap) to theta[re] BEFORE the next sample integrates
    // from it — otherwise the snap would never propagate.
    const closeRun = (re: number) => {
      const runStartIdx = rs;
      rs = -1;
      if (runStartIdx === -1 || t[re] - t[runStartIdx] < REST_MIN_MS) return;
      // STRICT gravity-reference validation: ≥200 ms contiguous stillness
      // (|a| within 0.3 m/s² of g, |ω| < 5 °/s). A rest that doesn't pass is
      // counted and skipped — never silently accepted as a gravity vector.
      const ref = findGravityRef(samples, runStartIdx, re);
      if (!ref) {
        rejectedStillWindows++;
        return;
      }
      const gravityUnit = ref.unit;
      const thetaPre = theta[re];
      bias =
        omega.slice(runStartIdx, re + 1).reduce((a, b) => a + b, 0) / (re - runStartIdx + 1);
      let thetaPost = thetaPre;
      if (!gravityRef) {
        gravityRef = gravityUnit;
        thetaPost = 0;
      } else {
        const projected = signedAngleAbout(n, gravityUnit, gravityRef);
        if (projected !== null) thetaPost = projected;
      }
      theta[re] = thetaPost;
      windows.push({ startIdx: runStartIdx, endIdx: re, gravityUnit, thetaPre, thetaPost });
    };

    if (resting(spanStart)) rs = spanStart;
    for (let i = spanStart + 1; i <= spanEnd; i++) {
      if (rs !== -1 && !resting(i)) closeRun(i - 1);
      const dt = (t[i] - t[i - 1]) / 1000;
      theta[i] = theta[i - 1] + (omega[i] - bias) * dt;
      if (rs === -1 && resting(i)) rs = i;
    }
    closeRun(spanEnd);
    return windows;
  };

  let windows = analyze(axis);
  if (windows.length >= 2 && windows[1].thetaPre - windows[0].thetaPost < 0) {
    axis = scale(axis, -1);
    windows = analyze(axis);
  }

  // --- Strokes: endpoint-to-endpoint deltas ------------------------------
  interface Stroke {
    from: RestWindow;
    to: RestWindow;
    /** Pure gyro integral between the endpoints, rad (signed). */
    dThetaGyro: number;
  }
  const strokes: Stroke[] = [];
  for (let k = 1; k < windows.length; k++) {
    const from = windows[k - 1];
    const to = windows[k];
    const dThetaGyro = to.thetaPre - from.thetaPost;
    if (Math.abs(dThetaGyro) * RAD_TO_DEG < MIN_PHASE_DEG) continue; // settling jitter
    strokes.push({ from, to, dThetaGyro });
  }
  if (strokes.length < MIN_SWEEP_STROKES) {
    return {
      ...invalid(
        `Only ${strokes.length} full stroke${strokes.length === 1 ? '' : 's'} detected — ` +
          'do at least 2 slow full-range reps with a brief pause at each end.' +
          (rejectedStillWindows > 0
            ? ` (${rejectedStillWindows} endpoint${rejectedStillWindows === 1 ? '' : 's'} discarded: ` +
              `${GRAVITY_REF_FAIL_HINT}.)`
            : '')
      ),
      pivotAxis: axis,
      axisQuality,
    };
  }

  // --- 5. Gravity checks --------------------------------------------------
  let maxResidualDeg = 0;
  for (const s of strokes) {
    const gyroDeg = Math.abs(s.dThetaGyro) * RAD_TO_DEG;
    const gravityDeg = angleBetweenUnit(s.from.gravityUnit, s.to.gravityUnit) * RAD_TO_DEG;
    // Strict lower bound: gravity can only under-report rotation (its
    // component along the axis is invisible), never over-report it.
    if (gyroDeg < gravityDeg - GRAVITY_LOWER_BOUND_TOL_DEG) {
      return {
        ...invalid(
          `Integrated gyro angle (${gyroDeg.toFixed(1)}°) is BELOW the gravity lower ` +
            `bound (${gravityDeg.toFixed(1)}°) — the gyro path is definitively wrong. ` +
            'Redo the sweep; if this repeats, the mount is moving relative to the arm.'
        ),
        pivotAxis: axis,
        axisQuality,
      };
    }
    // Forward-prediction: rotating the start gravity about the axis by the
    // integrated angle must land on the measured end gravity. (World-fixed
    // vectors counter-rotate in the phone frame, hence −dθ.)
    const predicted = rotateAbout(s.from.gravityUnit, axis, -s.dThetaGyro);
    const residualDeg = angleBetweenUnit(predicted, s.to.gravityUnit) * RAD_TO_DEG;
    maxResidualDeg = Math.max(maxResidualDeg, residualDeg);
    if (residualDeg > INTEGRITY_MAX_ERROR_DEG) {
      return {
        ...invalid(
          `Gravity forward-prediction misses by ${residualDeg.toFixed(1)}° on a stroke ` +
            `(limit ${INTEGRITY_MAX_ERROR_DEG}°) — axis or integration is off. Redo the sweep.`
        ),
        pivotAxis: axis,
        axisQuality,
      };
    }
  }

  // --- ROM + endpoint gravity references ----------------------------------
  const strokeRomsDeg = strokes.map((s) => Math.abs(s.dThetaGyro) * RAD_TO_DEG);
  const romDegrees = median(strokeRomsDeg);
  if (romDegrees < MIN_CALIBRATION_ROM_DEG) {
    return {
      ...invalid(
        `Median stroke is only ${romDegrees.toFixed(1)}° — too small to calibrate ` +
          `(minimum ${MIN_CALIBRATION_ROM_DEG}°). Sweep the full range of motion.`
      ),
      pivotAxis: axis,
      axisQuality,
    };
  }
  const spread = Math.max(...strokeRomsDeg) - Math.min(...strokeRomsDeg);
  if (spread > SWEEP_STROKE_SPREAD_MAX_DEG) {
    return {
      ...invalid(
        `Stroke lengths are inconsistent (${strokeRomsDeg
          .map((r) => r.toFixed(0))
          .join('°, ')}°) — use the same full range on every rep and redo the sweep.`
      ),
      pivotAxis: axis,
      axisQuality,
    };
  }

  // Classify endpoints by angle: below/above the midpoint of the range.
  const thetas = windows.map((w) => w.thetaPost);
  const mid = (Math.min(...thetas) + Math.max(...thetas)) / 2;
  const gravityRefBottom = meanUnit(windows.filter((w) => w.thetaPost <= mid).map((w) => w.gravityUnit));
  const gravityRefTop = meanUnit(windows.filter((w) => w.thetaPost > mid).map((w) => w.gravityUnit));
  if (!gravityRefBottom || !gravityRefTop) {
    return { ...invalid('Could not identify both ROM endpoints.'), pivotAxis: axis, axisQuality };
  }

  return {
    valid: true,
    reason: null,
    pivotAxis: axis,
    axisQuality,
    romDegrees,
    strokeCount: strokes.length,
    strokeRomsDeg,
    gravityRefBottom,
    gravityRefTop,
    maxGravityResidualDeg: maxResidualDeg,
  };
}
