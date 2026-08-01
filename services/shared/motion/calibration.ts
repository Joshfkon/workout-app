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
import { dot, meanUnit, norm, scale } from './vec3';
import type { CaptureAnalysis } from './captureAnalysis';
import { CAPTURE_MASK_OMEGA_RADPS, pcaOfVectors } from './captureAnalysis';
import { findGravityRef } from './gravityRef';
import { AXIS_QUALITY_MIN, MIN_CALIBRATION_ROM_DEG } from './constants';

/** ± search window around a rep endpoint for a validated gravity rest, ms. */
const ENDPOINT_SEARCH_MS = 500;

/**
 * Machine-likeness gate: set-relative segmentation thresholds detect
 * in-hand handling lobes as phases too (they are genuine motion, and the
 * analysis deliberately describes them), but the CALIBRATION layer needs
 * the machine's motion only. The discriminator is INTEGRATED ROM relative
 * to the capture's largest phase: sweep strokes are full-range by
 * instruction (~tens of degrees), handling lobes integrate to a few. Axis
 * alignment can't do this job — a stroke on a loosely-mounted wobbling
 * machine scores like handling, and that case must still reach the
 * axis-quality refusal (the actionable message), not "fewer than 2 reps".
 * The comparison is PER DIRECTION: a constant rotation riding on the
 * capture (tier-'none' captures) inflates one direction's integrals and
 * deflates the other's, so a shared maximum would condemn every phase of
 * the deflated direction.
 */
const MACHINE_ROM_FRACTION_OF_MAX = 0.4;

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

/**
 * STRICTLY validated gravity direction near a rep endpoint: the persisted
 * calibration contract expects endpoint gravity vectors read from genuine
 * rests, so this requires a findGravityRef window (≥200 ms of contiguous
 * |a|≈g stillness) within ±500 ms of the endpoint — turnaround dynamics
 * blindly averaged into a "gravity" vector would corrupt the calibrated
 * pipeline's angle resets and integrity checks downstream.
 */
function validatedGravityAt(samples: ImuSample[], centerIdx: number): Vec3 | null {
  const t = samples[centerIdx]?.tMs;
  if (t === undefined) return null;
  let lo = centerIdx;
  while (lo > 0 && t - samples[lo - 1].tMs <= ENDPOINT_SEARCH_MS) lo--;
  let hi = centerIdx;
  while (hi < samples.length - 1 && samples[hi + 1].tMs - t <= ENDPOINT_SEARCH_MS) hi++;
  return findGravityRef(samples, lo, hi)?.unit ?? null;
}

export function deriveCalibrationFromAnalysis(
  analysis: CaptureAnalysis,
  samples: ImuSample[]
): CalibrationEligibility {
  // Machine-like phases only (see MACHINE_ROM_FRACTION_OF_MAX).
  const maxRomByDir = { 1: 0, [-1]: 0 } as Record<1 | -1, number>;
  for (const h of analysis.halfReps) {
    maxRomByDir[h.dir] = Math.max(maxRomByDir[h.dir], h.romDeg);
  }
  const machineHalves = new Set(
    analysis.halfReps.filter((h) => h.romDeg >= MACHINE_ROM_FRACTION_OF_MAX * maxRomByDir[h.dir])
  );
  const machineReps = analysis.reps.filter(
    (r) => machineHalves.has(r.concentric) && machineHalves.has(r.eccentric)
  );

  // The SAVED calibration's axis and quality come from PCA over the
  // MACHINE-LIKE REP SPANS ONLY: that is the machine's motion by
  // construction. Whole-capture stats (what the display reports per spec)
  // include in-hand handling, which is irrelevant to — and would unfairly
  // condemn — the mounted sweep's planarity. share s = λ1/Σλ ⇒
  // λ1/(λ2+λ3) = s/(1−s), matching the stored axis_quality semantics.
  const repSpanGyro: Vec3[] = [];
  for (const h of Array.from(machineHalves)) {
    for (let i = h.startIdx; i <= h.endIdx; i++) {
      const g = samples[i].gyro;
      if (norm(g) > CAPTURE_MASK_OMEGA_RADPS) repSpanGyro.push(g);
    }
  }
  const repPca = pcaOfVectors(repSpanGyro);
  // Sign-align the rep-span axis with the analysis axis (concentric +).
  const pivotAxis =
    repPca && machineReps.length > 0
      ? dot(repPca.axis, analysis.axis) >= 0
        ? repPca.axis
        : scale(repPca.axis, -1)
      : null;

  const base: CalibrationEligibility = {
    eligible: false,
    reason: null,
    pivotAxis,
    axisQuality: repPca ? repPca.share / Math.max(1 - repPca.share, 1e-6) : null,
    romDegrees: null,
    gravityRefBottom: null,
    gravityRefTop: null,
  };

  if (machineReps.length < 2) {
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

  // The SAVE gate uses the calibration contract's axis-quality threshold
  // (λ1/(λ2+λ3) ≥ AXIS_QUALITY_MIN ⇔ PC1 share ≳ 95%), NOT the looser 0.8
  // display-confidence threshold — a share of 0.85 is fine to look at but
  // materially multi-axis for a machine's stored pivot axis.
  if (base.axisQuality !== null && base.axisQuality < AXIS_QUALITY_MIN) {
    return {
      ...base,
      reason:
        `Motion isn't single-axis enough for a machine calibration (axis quality ` +
        `${base.axisQuality.toFixed(1)}, need ≥ ${AXIS_QUALITY_MIN}; PC1 variance share ` +
        `${(analysis.pc1VarianceShare * 100).toFixed(0)}%). The mount may be loose or on ` +
        'a member that moves in more than one plane.',
    };
  }

  const romDegrees = median(machineReps.map((r) => r.romConcentricDeg));
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
  // averaged across reps — each endpoint contributes only when a strictly
  // validated rest window exists around it.
  const bottoms: Vec3[] = [];
  const tops: Vec3[] = [];
  for (const rep of machineReps) {
    const b = validatedGravityAt(samples, rep.concentric.startIdx);
    const t = validatedGravityAt(samples, rep.concentric.endIdx);
    if (b) bottoms.push(b);
    if (t) tops.push(t);
  }
  const gravityRefBottom = meanUnit(bottoms);
  const gravityRefTop = meanUnit(tops);
  if (!gravityRefBottom || !gravityRefTop) {
    return {
      ...base,
      romDegrees,
      reason:
        'The rep endpoints were never held still enough to read gravity — pause about half a ' +
        'second at the top and the bottom of each sweep rep, then redo the sweep.',
    };
  }

  return {
    ...base,
    eligible: true,
    romDegrees,
    gravityRefBottom,
    gravityRefTop,
  };
}
