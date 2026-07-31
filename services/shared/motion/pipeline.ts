/**
 * Motion pipeline: normalized IMU samples → derived per-rep metrics.
 *
 * Pure and framework-free: no DOM, no sensors, no persistence, no imports
 * from the training engines (enforced by __tests__/importGuard.test.ts).
 * Motion data is display-only telemetry — nothing computed here feeds e1RM,
 * prescription, or volume.
 *
 * Signal chain:
 *   1. Project the gyro onto the calibration-derived pivot axis (the axis is
 *      DERIVED from the calibration gravity refs, never assumed).
 *   2. Estimate gyro bias from the pre-set quiet period and subtract it.
 *   3. Integrate angular rate to angle using the MEASURED dt between
 *      samples (performance.now() deltas), never a nominal interval.
 *   4. ZUPT: at every detected rest interval (|ω| below threshold for
 *      >250 ms), re-estimate the bias from that interval and re-zero the
 *      accumulated drift against the gravity-derived absolute angle.
 *   5. Segment reps from ω sign changes with hysteresis.
 *   6. INTEGRITY CHECK per rep, between quasi-static endpoints (bottom →
 *      top pause → bottom), using gravity as a CHECK, never an estimator:
 *      (a) the 3-D angle between two endpoint gravity unit vectors is a
 *          strict LOWER BOUND on the true rotation (gravity is blind to the
 *          axis-parallel component, so it can only under-report). An
 *          integrated gyro angle below the bound is definitive proof the
 *          gyro path is wrong — hard rejection, not a soft flag;
 *      (b) forward-prediction: rotating the start gravity about the pivot
 *          axis by the integrated angle must land on the measured end
 *          gravity; a residual above 3° rejects the rep.
 *      This is the feature's main defense against silently wrong data.
 */

import type { ImuSample, RepMetric, Vec3 } from '@/types/motion';
import { angleBetweenUnit, dot, meanUnit, normalize, rotateAbout } from './vec3';
import { armAngleFromGravity, isQuasiStatic } from './gravity';
import { segmentPhases, type MovementPhase, type SegmentationOptions } from './segmentation';
import {
  CLIP_ACCEL_MPS2,
  DROPPED_DT_FACTOR,
  GRAVITY_LOWER_BOUND_TOL_DEG,
  INTEGRITY_MAX_ERROR_DEG,
  INTEGRITY_SEARCH_MS,
  LOW_SAMPLE_RATE_HZ,
  MIN_BIAS_WINDOW_MS,
  ONSET_OMEGA_RADPS,
  QUALITY_FLAGS,
  RAD_TO_DEG,
  REST_MIN_MS,
  REST_OMEGA_RADPS,
} from './constants';

export interface MotionPipelineInput {
  samples: ImuSample[];
  /** Unit pivot axis from deriveSweepCalibration (concentric positive). */
  pivotAxis: Vec3;
  /** Calibration bottom gravity reference — the angle-zero direction. */
  gravityRefBottom: Vec3;
  mountRadiusMm: number;
}

export interface MotionPipelineOptions {
  /** ZUPT drift reset + bias re-zeroing at rest intervals. Default true;
   *  disabling exists so tests can demonstrate the drift it prevents. */
  zuptEnabled?: boolean;
  restOmegaRadps?: number;
  restMinMs?: number;
  segmentation?: SegmentationOptions;
}

export interface MotionPipelineResult {
  reps: RepMetric[];
  durationMs: number;
  sampleRateHzMean: number;
  sampleRateHzStddev: number;
  droppedSampleCount: number;
  clipDetected: boolean;
  qualityFlags: string[];
  /** Number of ZUPT drift resets applied (introspection/debug). */
  zuptCount: number;
}

interface RestRun {
  startIdx: number;
  endIdx: number;
  /** Integrated angle at run end BEFORE the ZUPT reset (rad). */
  thetaPreResetRad: number;
  /** Integrated angle leaving the run, AFTER any ZUPT reset (rad). */
  thetaAfterRad: number;
  /** Gravity-derived angle averaged over the run's quasi-static samples,
   *  relative to capture start (rad). Null when nothing was quasi-static. */
  gravityThetaRad: number | null;
  /** Mean gravity UNIT vector over the run's quasi-static samples. */
  gravityUnitMean: Vec3 | null;
}

const REJECT = {
  clip: 'accelerometer clipped (>155 m/s² sample) — peak unknown, data untrustworthy',
  noEndpoint: 'no quasi-static endpoint — gyro/gravity integrity check impossible',
} as const;

function emptyResult(qualityFlags: string[]): MotionPipelineResult {
  return {
    reps: [],
    durationMs: 0,
    sampleRateHzMean: 0,
    sampleRateHzStddev: 0,
    droppedSampleCount: 0,
    clipDetected: false,
    qualityFlags,
    zuptCount: 0,
  };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function processMotionSamples(
  input: MotionPipelineInput,
  opts: MotionPipelineOptions = {}
): MotionPipelineResult {
  const { samples, pivotAxis, gravityRefBottom, mountRadiusMm } = input;
  const zuptEnabled = opts.zuptEnabled ?? true;
  const restOmega = opts.restOmegaRadps ?? REST_OMEGA_RADPS;
  const restMinMs = opts.restMinMs ?? REST_MIN_MS;

  const n = samples.length;
  if (n < 10) return emptyResult([QUALITY_FLAGS.noReps]);

  const t = samples.map((s) => s.tMs);
  const qualityFlags: string[] = [];

  // --- Sample-timing stats (measured dt, never nominal) ------------------
  const dts: number[] = [];
  for (let i = 1; i < n; i++) dts.push(t[i] - t[i - 1]);
  const medianDt = median(dts);
  const rates = dts.filter((dt) => dt > 0).map((dt) => 1000 / dt);
  const sampleRateHzMean = mean(rates);
  const sampleRateHzStddev = stddev(rates);
  let droppedSampleCount = 0;
  if (medianDt > 0) {
    for (const dt of dts) {
      if (dt > DROPPED_DT_FACTOR * medianDt) {
        droppedSampleCount += Math.round(dt / medianDt) - 1;
      }
    }
  }
  if (sampleRateHzMean < LOW_SAMPLE_RATE_HZ) qualityFlags.push(QUALITY_FLAGS.lowSampleRate);
  if (droppedSampleCount > 0.05 * n) qualityFlags.push(QUALITY_FLAGS.highDropRate);

  // --- Clipping ----------------------------------------------------------
  const clipped = samples.map(
    (s) =>
      Math.abs(s.accel.x) > CLIP_ACCEL_MPS2 ||
      Math.abs(s.accel.y) > CLIP_ACCEL_MPS2 ||
      Math.abs(s.accel.z) > CLIP_ACCEL_MPS2
  );
  const clipDetected = clipped.some(Boolean);
  if (clipDetected) qualityFlags.push(QUALITY_FLAGS.clipping);

  // --- Gyro projection + initial bias from the pre-set quiet period ------
  const omegaRaw = samples.map((s) => dot(s.gyro, pivotAxis));

  let onsetIdx = omegaRaw.findIndex((w) => Math.abs(w) >= ONSET_OMEGA_RADPS);
  if (onsetIdx === -1) onsetIdx = n; // never moved — everything is quiet
  const biasWindowEnd = Math.max(0, onsetIdx - 1);
  let bias = 0;
  if (t[biasWindowEnd] - t[0] >= MIN_BIAS_WINDOW_MS) {
    bias = mean(omegaRaw.slice(0, biasWindowEnd + 1));
  } else {
    qualityFlags.push(QUALITY_FLAGS.shortBiasWindow);
  }

  // --- Gravity angle series, referenced to the capture's own start -------
  // Referencing to the capture start (not the calibration bottom directly)
  // makes the integrity comparison immune to the user racking a few degrees
  // away from where they calibrated.
  const gravAngleAbs: (number | null)[] = samples.map((s) =>
    isQuasiStatic(s.accel) ? armAngleFromGravity(s.accel, pivotAxis, gravityRefBottom) : null
  );
  const startWindow = gravAngleAbs
    .slice(0, biasWindowEnd + 1)
    .filter((a): a is number => a !== null);
  const gravStart = startWindow.length >= 3 ? mean(startWindow) : null;
  const gravAngle = (i: number): number | null => {
    const a = gravAngleAbs[i];
    return a === null || gravStart === null ? null : a - gravStart;
  };

  // --- Rest runs (for ZUPT and endpoint integrity) -----------------------
  const restMask = omegaRaw.map((w) => Math.abs(w - bias) < restOmega);
  const restRunBounds: Array<{ startIdx: number; endIdx: number }> = [];
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    const resting = i < n && restMask[i];
    if (resting && runStart === -1) runStart = i;
    if (!resting && runStart !== -1) {
      if (t[i - 1] - t[runStart] >= restMinMs) restRunBounds.push({ startIdx: runStart, endIdx: i - 1 });
      runStart = -1;
    }
  }

  // --- Integration with piecewise bias + ZUPT ----------------------------
  const theta = new Array<number>(n).fill(0);
  const biasAt = new Array<number>(n).fill(bias);
  const restRuns: RestRun[] = [];
  let zuptCount = 0;
  let currentBias = bias;
  let nextRun = 0;

  for (let i = 1; i < n; i++) {
    const dt = (t[i] - t[i - 1]) / 1000;
    biasAt[i] = currentBias;
    theta[i] = theta[i - 1] + (omegaRaw[i] - currentBias) * dt;

    if (nextRun < restRunBounds.length && i === restRunBounds[nextRun].endIdx) {
      const { startIdx, endIdx } = restRunBounds[nextRun];
      const gravSamples: number[] = [];
      const gravUnits: Vec3[] = [];
      for (let j = startIdx; j <= endIdx; j++) {
        const a = gravAngle(j);
        if (a !== null) gravSamples.push(a);
        if (isQuasiStatic(samples[j].accel)) {
          const u = normalize(samples[j].accel);
          if (u) gravUnits.push(u);
        }
      }
      const gravityThetaRad = gravSamples.length >= 3 ? mean(gravSamples) : null;
      const thetaPreResetRad = theta[i];

      if (zuptEnabled) {
        // Re-zero the bias from what the gyro reads while provably at rest,
        // and snap accumulated drift to the absolute gravity angle.
        currentBias = mean(omegaRaw.slice(startIdx, endIdx + 1));
        if (gravityThetaRad !== null) {
          theta[i] = gravityThetaRad;
          zuptCount++;
        }
      }
      restRuns.push({
        startIdx,
        endIdx,
        thetaPreResetRad,
        thetaAfterRad: theta[i],
        gravityThetaRad,
        gravityUnitMean: gravUnits.length >= 3 ? meanUnit(gravUnits) : null,
      });
      nextRun++;
    }
  }

  const omegaCorr = omegaRaw.map((w, i) => w - biasAt[i]);

  // --- Segmentation & rep pairing ----------------------------------------
  const phases = segmentPhases(omegaCorr, t, theta, opts.segmentation);
  if (phases.length > 0 && phases[0].dir === -1) {
    qualityFlags.push(QUALITY_FLAGS.firstPhaseNotConcentric);
  }

  // Calibration canonicalizes bottom→top as positive, so on a press the
  // concentric is always the +1 phase; a rep is a +1 phase followed by the
  // next −1 phase (with an optional top pause between them).
  const reps: RepMetric[] = [];
  let unpaired = 0;
  for (let p = 0; p < phases.length; p++) {
    const conc = phases[p];
    if (conc.dir !== 1) {
      unpaired++;
      continue;
    }
    const ecc = phases[p + 1];
    if (!ecc || ecc.dir !== -1) {
      unpaired++;
      continue;
    }
    p++; // consume the eccentric

    const rep = buildRepMetric({
      index: reps.length,
      conc,
      ecc,
      t,
      theta,
      omegaCorr,
      clipped,
      restRuns,
      restMask,
      samples,
      pivotAxis,
      mountRadiusMm,
    });
    reps.push(rep);
  }
  if (unpaired > 0) qualityFlags.push(QUALITY_FLAGS.unpairedPhases);
  if (reps.length === 0) qualityFlags.push(QUALITY_FLAGS.noReps);

  return {
    reps,
    durationMs: t[n - 1] - t[0],
    sampleRateHzMean,
    sampleRateHzStddev,
    droppedSampleCount,
    clipDetected,
    qualityFlags,
    zuptCount,
  };
}

function buildRepMetric(args: {
  index: number;
  conc: MovementPhase;
  ecc: MovementPhase;
  t: number[];
  theta: number[];
  omegaCorr: number[];
  clipped: boolean[];
  restRuns: RestRun[];
  restMask: boolean[];
  samples: ImuSample[];
  pivotAxis: Vec3;
  mountRadiusMm: number;
}): RepMetric {
  const { index, conc, ecc, t, theta, omegaCorr, clipped, restRuns, restMask, samples, pivotAxis, mountRadiusMm } = args;

  const concentricMs = t[conc.endIdx] - t[conc.startIdx];
  const eccentricMs = t[ecc.endIdx] - t[ecc.startIdx];
  const pauseMs = Math.max(0, t[ecc.startIdx] - t[conc.endIdx]);

  let thetaMin = Infinity;
  let thetaMax = -Infinity;
  for (let i = conc.startIdx; i <= ecc.endIdx; i++) {
    if (theta[i] < thetaMin) thetaMin = theta[i];
    if (theta[i] > thetaMax) thetaMax = theta[i];
  }
  const romDegrees = (thetaMax - thetaMin) * RAD_TO_DEG;

  // Velocity stats over the MOVING samples only (pause excluded).
  let peak = 0;
  let velSum = 0;
  let velCount = 0;
  const scan = (a: number, b: number) => {
    for (let i = a; i <= b; i++) {
      const w = Math.abs(omegaCorr[i]);
      if (w > peak) peak = w;
      velSum += w;
      velCount++;
    }
  };
  scan(conc.startIdx, conc.endIdx);
  scan(ecc.startIdx, ecc.endIdx);
  const meanOmega = velCount > 0 ? velSum / velCount : 0;

  const base: Omit<RepMetric, 'gyroAngle_vs_gravityAngle_errorDeg' | 'rejected' | 'rejectReason'> = {
    index,
    concentricMs,
    eccentricMs,
    pauseMs,
    romDegrees,
    peakAngularVelocity_radps: peak,
    meanAngularVelocity_radps: meanOmega,
    meanHandleVelocity_mps: (mountRadiusMm / 1000) * meanOmega,
  };

  // Hard rejection: any clipped accel sample inside the rep span.
  for (let i = conc.startIdx; i <= ecc.endIdx; i++) {
    if (clipped[i]) {
      return {
        ...base,
        gyroAngle_vs_gravityAngle_errorDeg: null,
        rejected: true,
        rejectReason: REJECT.clip,
      };
    }
  }

  // --- Endpoint integrity: gravity as a CHECK, never an estimator --------
  // Windows: bottom before the concentric, top pause (when ≥250 ms), bottom
  // after the eccentric. Angles use pre-reset θ on the "to" side and
  // post-reset θ on the "from" side, so each pair measures the pure gyro
  // integral between its endpoints and is never trivially zeroed by the
  // ZUPT snap. NOTE: with no top pause the only pair is bottom→bottom,
  // where symmetric per-stroke errors cancel — pauses strengthen the check.
  interface EndpointWindow {
    thetaPre: number;
    thetaAfter: number;
    gravityUnit: Vec3;
  }
  const runToWindow = (r: RestRun | undefined): EndpointWindow | null =>
    r && r.gravityUnitMean
      ? { thetaPre: r.thetaPreResetRad, thetaAfter: r.thetaAfterRad, gravityUnit: r.gravityUnitMean }
      : null;

  // Fallback for touch-and-go endpoints (no ≥250 ms rest run): individual
  // resting + quasi-static samples around the endpoint. Rest-run end indices
  // are excluded because theta may already be ZUPT-reset there.
  const resetIdxs = new Set(restRuns.map((r) => r.endIdx));
  const pseudoWindow = (fromT: number, toT: number): EndpointWindow | null => {
    const units: Vec3[] = [];
    let thetaAt: number | null = null;
    for (let i = 0; i < t.length; i++) {
      if (t[i] < fromT) continue;
      if (t[i] > toT) break;
      if (!restMask[i] || resetIdxs.has(i)) continue;
      if (!isQuasiStatic(samples[i].accel)) continue;
      const u = normalize(samples[i].accel);
      if (!u) continue;
      units.push(u);
      if (thetaAt === null) thetaAt = theta[i];
    }
    const gravityUnit = units.length >= 3 ? meanUnit(units) : null;
    return gravityUnit && thetaAt !== null
      ? { thetaPre: thetaAt, thetaAfter: thetaAt, gravityUnit }
      : null;
  };

  const tStart = t[conc.startIdx];
  const tConcEnd = t[conc.endIdx];
  const tEccStart = t[ecc.startIdx];
  const tEnd = t[ecc.endIdx];

  const wStart =
    runToWindow(
      restRuns.find((r) => t[r.endIdx] >= tStart - INTEGRITY_SEARCH_MS && t[r.endIdx] <= tStart + 100)
    ) ?? pseudoWindow(tStart - INTEGRITY_SEARCH_MS, tStart + 100);
  const wTop = runToWindow(
    restRuns.find((r) => t[r.startIdx] >= tConcEnd - 100 && t[r.endIdx] <= tEccStart + 100)
  );
  const wEnd =
    runToWindow(
      restRuns.find((r) => t[r.startIdx] >= tEnd - 100 && t[r.startIdx] <= tEnd + INTEGRITY_SEARCH_MS)
    ) ?? pseudoWindow(tEnd - 100, tEnd + INTEGRITY_SEARCH_MS);

  if (!wStart || !wEnd) {
    return {
      ...base,
      gyroAngle_vs_gravityAngle_errorDeg: null,
      rejected: true,
      rejectReason: REJECT.noEndpoint,
    };
  }

  const pairs: Array<[EndpointWindow, EndpointWindow]> = wTop
    ? [
        [wStart, wTop],
        [wTop, wEnd],
      ]
    : [[wStart, wEnd]];

  let maxResidualDeg = 0;
  for (const [from, to] of pairs) {
    const dThetaGyro = to.thetaPre - from.thetaAfter;
    const gyroDeg = Math.abs(dThetaGyro) * RAD_TO_DEG;
    const gravityDeg = angleBetweenUnit(from.gravityUnit, to.gravityUnit) * RAD_TO_DEG;

    // INVARIANT: the 3-D angle between endpoint gravity vectors is a strict
    // lower bound on the true rotation (gravity cannot see its axis-parallel
    // component). Integrated gyro below the bound = the gyro path is
    // definitively wrong. Hard error, not a soft flag.
    if (gyroDeg < gravityDeg - GRAVITY_LOWER_BOUND_TOL_DEG) {
      return {
        ...base,
        gyroAngle_vs_gravityAngle_errorDeg: gravityDeg - gyroDeg,
        rejected: true,
        rejectReason:
          `gyro under-read: integrated ${gyroDeg.toFixed(1)}° is BELOW the gravity lower ` +
          `bound ${gravityDeg.toFixed(1)}° — the gyro path is definitively wrong ` +
          '(axis, units, or dropped samples)',
      };
    }

    // Forward-prediction: rotating the start gravity about the pivot axis by
    // the integrated angle must land on the measured end gravity. (A
    // world-fixed vector counter-rotates in the phone frame, hence −dθ.)
    const predicted = rotateAbout(from.gravityUnit, pivotAxis, -dThetaGyro);
    const residualDeg = angleBetweenUnit(predicted, to.gravityUnit) * RAD_TO_DEG;
    maxResidualDeg = Math.max(maxResidualDeg, residualDeg);
    if (residualDeg > INTEGRITY_MAX_ERROR_DEG) {
      return {
        ...base,
        gyroAngle_vs_gravityAngle_errorDeg: residualDeg,
        rejected: true,
        rejectReason:
          `gravity forward-prediction misses by ${residualDeg.toFixed(1)}° at the rep ` +
          `endpoints (limit ${INTEGRITY_MAX_ERROR_DEG}°) — angle data unreliable`,
      };
    }
  }

  return {
    ...base,
    gyroAngle_vs_gravityAngle_errorDeg: maxResidualDeg,
    rejected: false,
    rejectReason: null,
  };
}
