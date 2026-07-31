/**
 * Machine-calibration derivation on top of the tiered, calibration-free
 * capture analysis (captureAnalysis.ts + stillness.ts).
 *
 * The old flow was pass/fail: any sweep without a near-perfect still period
 * was rejected outright, which blocked everything downstream. Now EVERY
 * sweep proceeds through analysis — reps, velocities, and the chart always
 * come out — and this module only decides whether the sweep additionally
 * qualifies to be SAVED as a machine calibration (which needs a trustworthy
 * pivot axis and gravity references):
 *
 *   - tier 'mounted' or 'handheld' → gravity refs come from rep endpoints;
 *     eligible when the motion is single-DOF enough and ≥2 reps exist.
 *   - tier 'none' → absolute ROM is suppressed and no calibration can be
 *     saved; when still-ish windows existed but were too noisy the message
 *     says the phone appears HAND-HELD — telling the user to "hold still
 *     longer" does not fix that case.
 *
 * Gravity is never averaged over the whole capture: during cyclic motion
 * that lands tens of degrees off with a shrunken magnitude. Endpoint
 * windows or nothing.
 */

import type { ImuSample, Vec3 } from '@/types/motion';
import { meanUnit, normalize } from './vec3';
import type { CaptureAnalysis } from './captureAnalysis';
import { LOW_CONFIDENCE_PC1_SHARE } from './captureAnalysis';
import { MIN_CALIBRATION_ROM_DEG } from './constants';

/** ± window for endpoint gravity reference estimation, ms. */
const ENDPOINT_WINDOW_MS = 120;

export interface CalibrationEligibility {
  eligible: boolean;
  /** User-facing explanation when not eligible. */
  reason: string | null;
  /** Unit pivot axis (concentric positive); present whenever motion existed. */
  pivotAxis: Vec3 | null;
  /** λ1/(λ2+λ3) equivalent, derived from the PC1 variance share. */
  axisQuality: number | null;
  /** Median concentric ROM, degrees; null when tier is 'none' (suppressed). */
  romDegrees: number | null;
  gravityRefBottom: Vec3 | null;
  gravityRefTop: Vec3 | null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Mean gravity direction over ±window around a sample index. */
function gravityDirAt(samples: ImuSample[], centerIdx: number): Vec3 | null {
  const t = samples[centerIdx]?.tMs;
  if (t === undefined) return null;
  const units: Vec3[] = [];
  for (let i = centerIdx; i >= 0 && t - samples[i].tMs <= ENDPOINT_WINDOW_MS; i--) {
    const u = normalize(samples[i].accel);
    if (u) units.push(u);
  }
  for (let i = centerIdx + 1; i < samples.length && samples[i].tMs - t <= ENDPOINT_WINDOW_MS; i++) {
    const u = normalize(samples[i].accel);
    if (u) units.push(u);
  }
  return meanUnit(units);
}

export function deriveCalibrationFromAnalysis(
  analysis: CaptureAnalysis,
  samples: ImuSample[]
): CalibrationEligibility {
  const base: CalibrationEligibility = {
    eligible: false,
    reason: null,
    pivotAxis: analysis.reps.length > 0 ? analysis.axis : null,
    // share s = λ1/Σλ ⇒ λ1/(λ2+λ3) = s/(1−s), matching the stored
    // axis_quality semantics from the scatter-based derivation.
    axisQuality:
      analysis.reps.length > 0
        ? analysis.pc1VarianceShare / Math.max(1 - analysis.pc1VarianceShare, 1e-6)
        : null,
    romDegrees: null,
    gravityRefBottom: null,
    gravityRefTop: null,
  };

  if (analysis.reps.length < 2) {
    return {
      ...base,
      reason:
        'Fewer than 2 full reps detected — sweep the machine through at least 2 slow full-range reps.',
    };
  }

  if (analysis.tier === 'none') {
    return {
      ...base,
      reason: analysis.stillness.nearMissHandheld
        ? 'The phone appears to be hand-held (still-ish periods exist, but the direction is not ' +
          'steady enough for a machine reference). Reps and velocity were measured; to save a ' +
          'machine calibration, mount the phone on the machine and let it rest there briefly.'
        : 'No still period found anywhere in the recording, so there is no gravity reference. ' +
          'Reps and velocity were measured; to save a machine calibration, let the mounted ' +
          'phone rest still at some point.',
    };
  }

  if (analysis.lowConfidence) {
    return {
      ...base,
      reason:
        `Motion is not single-DOF enough for a machine calibration (PC1 variance share ` +
        `${(analysis.pc1VarianceShare * 100).toFixed(0)}%, need ≥ ${LOW_CONFIDENCE_PC1_SHARE * 100}%). ` +
        'The mount may be loose or on a member that moves in more than one plane.',
    };
  }

  const romDegrees = median(analysis.reps.map((r) => r.romConcentricDeg));
  if (romDegrees < MIN_CALIBRATION_ROM_DEG) {
    return {
      ...base,
      romDegrees,
      reason:
        `Median stroke is only ${romDegrees.toFixed(1)}° — too small to calibrate ` +
        `(minimum ${MIN_CALIBRATION_ROM_DEG}°). Sweep the full range of motion.`,
    };
  }

  // Endpoint gravity references: concentric start = bottom, end = top,
  // averaged across reps.
  const bottoms: Vec3[] = [];
  const tops: Vec3[] = [];
  for (const rep of analysis.reps) {
    const b = gravityDirAt(samples, rep.concentric.startIdx);
    const t = gravityDirAt(samples, rep.concentric.endIdx);
    if (b) bottoms.push(b);
    if (t) tops.push(t);
  }
  const gravityRefBottom = meanUnit(bottoms);
  const gravityRefTop = meanUnit(tops);
  if (!gravityRefBottom || !gravityRefTop) {
    return { ...base, romDegrees, reason: 'Could not read gravity at the rep endpoints.' };
  }

  return {
    ...base,
    eligible: true,
    romDegrees,
    gravityRefBottom,
    gravityRefTop,
  };
}
