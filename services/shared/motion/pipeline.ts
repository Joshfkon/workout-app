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
 *   6. INTEGRITY CHECK per rep: at the rep endpoint, compare the integrated
 *      gyro angle against the angle derived independently from the gravity
 *      direction (quasi-static). Disagreement > 3° rejects the rep. This is
 *      the feature's main defense against silently wrong data.
 */

import type { ImuSample, RepMetric, Vec3 } from '@/types/motion';
import { dot } from './vec3';
import { armAngleFromGravity, isQuasiStatic } from './gravity';
import { segmentPhases, type MovementPhase, type SegmentationOptions } from './segmentation';
import {
  CLIP_ACCEL_MPS2,
  DROPPED_DT_FACTOR,
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
  /** Unit pivot axis from deriveCalibration (bottom→top positive). */
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
  /** Gravity-derived angle averaged over the run's quasi-static samples,
   *  relative to capture start (rad). Null when nothing was quasi-static. */
  gravityThetaRad: number | null;
}

const REJECT = {
  clip: 'accelerometer clipped (>155 m/s² sample) — peak unknown, data untrustworthy',
  noEndpoint: 'no quasi-static endpoint — gyro/gravity integrity check impossible',
  noGravityRef: 'no gravity reference at capture start — integrity check impossible',
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
      for (let j = startIdx; j <= endIdx; j++) {
        const a = gravAngle(j);
        if (a !== null) gravSamples.push(a);
      }
      const gravityThetaRad = gravSamples.length >= 3 ? mean(gravSamples) : null;
      restRuns.push({ startIdx, endIdx, thetaPreResetRad: theta[i], gravityThetaRad });

      if (zuptEnabled) {
        // Re-zero the bias from what the gyro reads while provably at rest,
        // and snap accumulated drift to the absolute gravity angle.
        currentBias = mean(omegaRaw.slice(startIdx, endIdx + 1));
        if (gravityThetaRad !== null) {
          theta[i] = gravityThetaRad;
          zuptCount++;
        }
      }
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
      gravAngle,
      gravStart,
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
  gravAngle: (i: number) => number | null;
  gravStart: number | null;
  mountRadiusMm: number;
}): RepMetric {
  const { index, conc, ecc, t, theta, omegaCorr, clipped, restRuns, restMask, gravAngle, gravStart, mountRadiusMm } = args;

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

  if (gravStart === null) {
    return {
      ...base,
      gyroAngle_vs_gravityAngle_errorDeg: null,
      rejected: true,
      rejectReason: REJECT.noGravityRef,
    };
  }

  // Integrity check at the rep endpoint. Primary path: the rest interval the
  // eccentric lands in (its pre-ZUPT integrated angle vs its gravity angle,
  // so the comparison isn't trivially zeroed by the reset itself).
  const tEnd = t[ecc.endIdx];
  const run = restRuns.find(
    (r) => t[r.startIdx] >= tEnd - 100 && t[r.startIdx] <= tEnd + INTEGRITY_SEARCH_MS
  );
  let errorDeg: number | null = null;
  if (run && run.gravityThetaRad !== null) {
    errorDeg = Math.abs(run.thetaPreResetRad - run.gravityThetaRad) * RAD_TO_DEG;
  } else {
    // Fallback (touch-and-go into the next rep, no ≥250 ms rest): individual
    // resting + quasi-static samples right around the endpoint. Rest-run end
    // indices are excluded because theta may already be ZUPT-reset there.
    const resetIdxs = new Set(restRuns.map((r) => r.endIdx));
    const gravSamples: number[] = [];
    let thetaAtEndpoint: number | null = null;
    for (let i = ecc.startIdx; i < t.length && t[i] <= tEnd + INTEGRITY_SEARCH_MS; i++) {
      if (t[i] < tEnd - 100 || !restMask[i] || resetIdxs.has(i)) continue;
      const a = gravAngle(i);
      if (a === null) continue;
      gravSamples.push(a);
      if (thetaAtEndpoint === null) thetaAtEndpoint = theta[i];
    }
    if (gravSamples.length >= 3 && thetaAtEndpoint !== null) {
      errorDeg =
        Math.abs(thetaAtEndpoint - gravSamples.reduce((a, b) => a + b, 0) / gravSamples.length) *
        RAD_TO_DEG;
    }
  }

  if (errorDeg === null) {
    return {
      ...base,
      gyroAngle_vs_gravityAngle_errorDeg: null,
      rejected: true,
      rejectReason: REJECT.noEndpoint,
    };
  }
  if (errorDeg > INTEGRITY_MAX_ERROR_DEG) {
    return {
      ...base,
      gyroAngle_vs_gravityAngle_errorDeg: errorDeg,
      rejected: true,
      rejectReason:
        `gyro and gravity disagree by ${errorDeg.toFixed(1)}° at the rep endpoint ` +
        `(limit ${INTEGRITY_MAX_ERROR_DEG}°) — angle data unreliable`,
    };
  }
  return { ...base, gyroAngle_vs_gravityAngle_errorDeg: errorDeg, rejected: false, rejectReason: null };
}
