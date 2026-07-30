/**
 * Calibration derivation: determine which gyro direction the machine arm
 * actually rotates about — determined during calibration, never assumed —
 * plus the total ROM angle, shown to the user to sanity-check against
 * reality.
 *
 * Inputs come from the calibration wizard:
 *   - gravity references captured while holding still at the BOTTOM and TOP
 *     of the ROM, and
 *   - the gyro recorded while the user moved the arm between the two holds
 *     (`transitSamples`).
 *
 * The pivot axis comes from the transit-gyro integral: for a single-DOF
 * machine the rotation axis is fixed, so ∫gyro·dt = axis·θ_total. Two static
 * gravity holds alone CANNOT pin the axis down — any axis on the bisector
 * plane of the two gravity vectors is consistent with them, and the
 * minimal-angle (cross-product) choice is biased whenever the true axis
 * isn't horizontal. The cross-product fallback exists only for transit-less
 * inputs and carries that documented bias.
 *
 * The gravity refs then serve two jobs:
 *   1. independent ROM: project both refs onto the plane ⊥ the axis — with
 *      the true axis this is exact, and it's what the user sanity-checks;
 *   2. cross-check: gravity ROM and gyro ROM must agree, else the phone
 *      slipped or the mount is loose → calibration invalid.
 *
 * Sign convention (load-bearing, verified by the synthetic-signal tests):
 * the axis is canonicalized so that bottom→top rotation is POSITIVE. With
 * that, a press rep's concentric integrates to a positive angle, and
 * dot(gyro, pivotAxis) integrates to the same signed angle that
 * `armAngleFromGravity` reports.
 */

import type { Vec3 } from '@/types/motion';
import { add, cross, norm, normalize, scale, signedAngleAbout } from './vec3';
import {
  CALIBRATION_GRAVITY_TOL_MPS2,
  G_MPS2,
  MIN_CALIBRATION_ROM_DEG,
  RAD_TO_DEG,
} from './constants';

/** One gyro sample recorded while moving between the two calibration holds. */
export interface TransitSample {
  /** rad/s, phone frame. */
  gyro: Vec3;
  /** Measured time since the previous sample, ms. */
  dtMs: number;
}

/** Gyro-vs-gravity ROM disagreement beyond this invalidates the calibration. */
export const CALIBRATION_ROM_AGREEMENT_DEG = 8;

export interface CalibrationDerivation {
  valid: boolean;
  reason: string | null;
  /** Unit pivot axis in the phone frame; bottom→top rotation is positive. */
  pivotAxis: Vec3 | null;
  /** ROM derived from the gravity references about the axis, degrees. */
  romDegrees: number | null;
  /** ROM from the transit-gyro integral, degrees (null on the fallback path). */
  romFromGyroDegrees: number | null;
}

export function deriveCalibration(
  gravityRefStart: Vec3,
  gravityRefEnd: Vec3,
  transitSamples?: TransitSample[]
): CalibrationDerivation {
  const invalid = (reason: string): CalibrationDerivation => ({
    valid: false,
    reason,
    pivotAxis: null,
    romDegrees: null,
    romFromGyroDegrees: null,
  });

  for (const [label, g] of [
    ['bottom', gravityRefStart],
    ['top', gravityRefEnd],
  ] as const) {
    const mag = norm(g);
    if (Math.abs(mag - G_MPS2) > CALIBRATION_GRAVITY_TOL_MPS2) {
      return invalid(
        `${label} reference doesn't look like a still gravity reading ` +
          `(|a| = ${mag.toFixed(1)} m/s², expected ≈ ${G_MPS2.toFixed(1)}). ` +
          'Hold the arm completely still and recapture.'
      );
    }
  }

  // --- Axis ---------------------------------------------------------------
  let axis: Vec3 | null = null;
  let romFromGyroDegrees: number | null = null;

  if (transitSamples && transitSamples.length > 0) {
    let net: Vec3 = { x: 0, y: 0, z: 0 };
    for (const s of transitSamples) net = add(net, scale(s.gyro, s.dtMs / 1000));
    const netMag = norm(net); // radians rotated about the (fixed) axis
    romFromGyroDegrees = netMag * RAD_TO_DEG;
    if (romFromGyroDegrees < MIN_CALIBRATION_ROM_DEG) {
      return invalid(
        `The gyro only saw ${romFromGyroDegrees.toFixed(1)}° of rotation between the ` +
          'two holds — move the arm through its full stroke between captures.'
      );
    }
    axis = normalize(net);
  } else {
    // Fallback: minimal-rotation axis from the gravity refs alone. Exact only
    // when the true pivot axis is horizontal; tilted axes bias this estimate,
    // which is why the wizard always records the transit.
    axis = normalize(cross(gravityRefStart, gravityRefEnd));
  }
  if (!axis) {
    return invalid(
      'Could not derive a rotation axis — the phone did not rotate between ' +
        'captures. Check the mount and recapture both positions.'
    );
  }

  // --- ROM from gravity, about the derived axis ---------------------------
  const romRad = signedAngleAbout(axis, gravityRefEnd, gravityRefStart);
  if (romRad === null) {
    return invalid(
      'Gravity is parallel to the rotation axis — arm angle cannot be read ' +
        'from gravity on this mount. Re-mount the phone and recalibrate.'
    );
  }
  const romDegrees = Math.abs(romRad) * RAD_TO_DEG;
  if (romDegrees < MIN_CALIBRATION_ROM_DEG) {
    return invalid(
      `Derived ROM is only ${romDegrees.toFixed(1)}° — too small to calibrate ` +
        `reliably (minimum ${MIN_CALIBRATION_ROM_DEG}°). Make sure you capture at ` +
        'the true bottom and top of the stroke.'
    );
  }

  // --- Gyro/gravity cross-check (transit path only) -----------------------
  if (romFromGyroDegrees !== null && Math.abs(romFromGyroDegrees - romDegrees) > CALIBRATION_ROM_AGREEMENT_DEG) {
    return invalid(
      `Gyro and gravity disagree on the ROM (${romFromGyroDegrees.toFixed(1)}° vs ` +
        `${romDegrees.toFixed(1)}°). The phone probably shifted on the mount — ` +
        'secure it and recalibrate.'
    );
  }

  // Canonicalize the sign: consumers measure angles via signedAngleAbout(axis,
  // g, gStart), so flip the axis if bottom→top came out negative.
  const pivotAxis = romRad > 0 ? axis : scale(axis, -1);

  return { valid: true, reason: null, pivotAxis, romDegrees, romFromGyroDegrees };
}
