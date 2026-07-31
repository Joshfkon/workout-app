/**
 * Synthetic IMU signal generator for the motion-pipeline tests.
 *
 * Physics convention (must mirror the pipeline's):
 *  - the arm angle θ(t) is positive bottom→top;
 *  - the gyro reads ω(t) = dθ/dt along the pivot axis (plus bias/noise);
 *  - gravity observed in the phone frame is g(t) = R(axis, −θ(t)) · gBottom
 *    (a world-fixed vector counter-rotates in a rotating frame).
 *
 * The generator is deterministic (seeded LCG noise) so tests are stable.
 */

import type { ImuSample, Vec3 } from '@/types/motion';
import { add, cross, normalize, rotateAbout, scale } from '../vec3';
import { DEG_TO_RAD, G_MPS2 } from '../constants';

export interface SyntheticRepSpec {
  romDeg: number;
  concentricMs: number;
  /** Pause at the top of the stroke. */
  pauseTopMs: number;
  eccentricMs: number;
  /** Rest at the bottom after the rep. */
  restAfterMs: number;
}

export interface SyntheticOptions {
  /** Pivot axis in the phone frame (normalized internally). */
  axis?: Vec3;
  /** Gravity at the bottom position (normalized to |g| internally). */
  gBottom?: Vec3;
  sampleRateHz?: number;
  /** Quiet lead-in before the first rep (the bias-estimation window). */
  leadInMs?: number;
  /** Gyro bias along the pivot axis, rad/s — constant or time-varying. */
  gyroBias?: number | ((tMs: number) => number);
  /** Gaussian-ish gyro noise stddev per axis, rad/s. */
  gyroNoise?: number;
  /** Multiplicative gyro error (1 = perfect). For integrity-check tests. */
  gyroScale?: number;
  /** Accel spikes injected verbatim on the x axis at given times. */
  accelSpikes?: Array<{ tMs: number; valueMps2: number }>;
  /**
   * Cross-axis wobble during movement: extra rotation rate about an axis
   * perpendicular to the pivot. Deliberately NOT reflected in the synthetic
   * gravity — it exists to degrade the scatter-matrix axis quality, which
   * must reject the sweep before any gravity check runs.
   */
  crossAxisWobble?: { amplitudeRadps: number; freqHz: number };
  /**
   * Scale the accel magnitude during rest segments (|ω| ≈ 0) — e.g. 1.05
   * puts |a| ≈ 0.5 m/s² off gravity: still enough for loose gating, but a
   * dynamic sample under the STRICT gravity-reference bounds (±0.3 m/s²).
   */
  restAccelScale?: number;
  seed?: number;
}

export const DEFAULT_AXIS: Vec3 = { x: 1, y: 0, z: 0 };
export const DEFAULT_G_BOTTOM: Vec3 = { x: 2, y: -8, z: -5 };

/** Deterministic pseudo-gaussian noise (sum of 3 LCG uniforms, centered). */
function makeNoise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  return () => next() + next() + next() - 1.5;
}

/** θ(t) profiles: raised-cosine stroke (smooth accel/decel, like a real rep). */
function raisedCosine(progress: number, romRad: number): { theta: number; omega01: number } {
  const theta = (romRad * (1 - Math.cos(Math.PI * progress))) / 2;
  const omega01 = (romRad * Math.PI * Math.sin(Math.PI * progress)) / 2; // dθ/dprogress
  return { theta, omega01 };
}

export interface SyntheticSignal {
  samples: ImuSample[];
  axis: Vec3;
  gBottom: Vec3;
  gTop: (romDeg: number) => Vec3;
}

/**
 * Generate a full capture: lead-in quiet period, then the given reps.
 * Also usable for constant-velocity segments via `generateFromProfile`.
 */
export function generateReps(reps: SyntheticRepSpec[], opts: SyntheticOptions = {}): SyntheticSignal {
  // Build a piecewise θ(t) profile then sample it.
  const segments: Array<{ durMs: number; theta: (p: number) => number; omega: (p: number) => number }> = [];
  const still = (theta: number, durMs: number) => ({
    durMs,
    theta: () => theta,
    omega: () => 0,
  });
  segments.push(still(0, opts.leadInMs ?? 1000));
  for (const rep of reps) {
    const romRad = rep.romDeg * DEG_TO_RAD;
    segments.push({
      durMs: rep.concentricMs,
      theta: (p) => raisedCosine(p, romRad).theta,
      omega: (p) => raisedCosine(p, romRad).omega01 / (rep.concentricMs / 1000),
    });
    segments.push(still(romRad, rep.pauseTopMs));
    segments.push({
      durMs: rep.eccentricMs,
      theta: (p) => romRad - raisedCosine(p, romRad).theta,
      omega: (p) => -raisedCosine(p, romRad).omega01 / (rep.eccentricMs / 1000),
    });
    segments.push(still(0, rep.restAfterMs));
  }
  return generateFromProfile(segments, opts);
}

export function generateFromProfile(
  segments: Array<{ durMs: number; theta: (p: number) => number; omega: (p: number) => number }>,
  opts: SyntheticOptions = {}
): SyntheticSignal {
  const axis = normalize(opts.axis ?? DEFAULT_AXIS)!;
  const gBottom = scale(normalize(opts.gBottom ?? DEFAULT_G_BOTTOM)!, G_MPS2);
  const rateHz = opts.sampleRateHz ?? 100;
  const dtMs = 1000 / rateHz;
  const noise = makeNoise(opts.seed ?? 42);
  const noiseAmp = opts.gyroNoise ?? 0;
  const gyroScale = opts.gyroScale ?? 1;
  const biasFn =
    typeof opts.gyroBias === 'function' ? opts.gyroBias : () => (opts.gyroBias as number) ?? 0;

  const totalMs = segments.reduce((a, s) => a + s.durMs, 0);
  const samples: ImuSample[] = [];

  for (let tMs = 0; tMs <= totalMs; tMs += dtMs) {
    // Locate the active segment.
    let acc = 0;
    let theta = 0;
    let omega = 0;
    for (const seg of segments) {
      if (tMs <= acc + seg.durMs || seg === segments[segments.length - 1]) {
        const p = seg.durMs === 0 ? 0 : Math.min(1, (tMs - acc) / seg.durMs);
        theta = seg.theta(p);
        omega = seg.omega(p);
        break;
      }
      acc += seg.durMs;
    }

    let gyroTrue = scale(axis, omega * gyroScale + biasFn(tMs));
    if (opts.crossAxisWobble && Math.abs(omega) > 0.05) {
      const wobbleAxis = normalize(cross(axis, gBottom))!;
      const w =
        opts.crossAxisWobble.amplitudeRadps *
        Math.sin(2 * Math.PI * opts.crossAxisWobble.freqHz * (tMs / 1000));
      gyroTrue = add(gyroTrue, scale(wobbleAxis, w));
    }
    const gyro = add(gyroTrue, {
      x: noise() * noiseAmp,
      y: noise() * noiseAmp,
      z: noise() * noiseAmp,
    });
    let accel = rotateAbout(gBottom, axis, -theta);
    if (opts.restAccelScale && Math.abs(omega) < 0.01) {
      accel = scale(accel, opts.restAccelScale);
    }
    const spike = opts.accelSpikes?.find((s) => Math.abs(s.tMs - tMs) < dtMs / 2);
    if (spike) accel = { ...accel, x: spike.valueMps2 };

    samples.push({ tMs, gyro, accel });
  }

  return {
    samples,
    axis,
    gBottom,
    gTop: (romDeg: number) => rotateAbout(gBottom, axis, -romDeg * DEG_TO_RAD),
  };
}

/**
 * A full calibration sweep as the wizard records it: in-hand handling
 * (fast, multi-axis, non-quasi-static — tap START, carry to the mount),
 * a long mount rest, the reps, a long rest, then handling again (retrieve,
 * tap STOP). The handling segments are exactly the motion that must NOT
 * poison the axis estimate.
 */
export function generateSweepSignal(
  reps: SyntheticRepSpec[],
  opts: SyntheticOptions = {}
): SyntheticSignal {
  const rateHz = opts.sampleRateHz ?? 100;
  const dtMs = 1000 / rateHz;
  const mounted = generateReps(reps, { ...opts, leadInMs: opts.leadInMs ?? 1500 });

  const handling = (startMs: number, durMs: number): ImuSample[] => {
    const out: ImuSample[] = [];
    for (let tMs = 0; tMs < durMs; tMs += dtMs) {
      const t = tMs / 1000;
      out.push({
        tMs: startMs + tMs,
        // Brisk multi-axis in-hand rotation — high |ω|, no dominant axis.
        gyro: {
          x: 1.6 * Math.sin(7 * t),
          y: 1.2 * Math.cos(5 * t + 1),
          z: 0.9 * Math.sin(3 * t + 2),
        },
        // Being carried: |a| swings well outside the quasi-static band.
        accel: add(scale(mounted.gBottom, 1 + 0.35 * Math.sin(9 * t)), {
          x: 2.5 * Math.sin(11 * t),
          y: 1.5 * Math.cos(13 * t),
          z: 0,
        }),
      });
    }
    return out;
  };

  const preMs = 1200;
  const pre = handling(0, preMs);
  const mountedShifted = mounted.samples.map((s) => ({ ...s, tMs: s.tMs + preMs }));
  const postStart = preMs + (mounted.samples[mounted.samples.length - 1]?.tMs ?? 0) + dtMs;
  const post = handling(postStart, 1200);

  return { ...mounted, samples: [...pre, ...mountedShifted, ...post] };
}
