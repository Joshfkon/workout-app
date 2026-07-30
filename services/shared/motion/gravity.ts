/**
 * Gravity-referenced arm angle. When the arm is (quasi-)static, the
 * accelerometer reads pure gravity, so the gravity direction in the phone
 * frame gives an ABSOLUTE arm angle — independent of the gyro integral.
 * This is what the per-rep integrity check compares against.
 *
 * Derivation of the sign (matches the gyro projection):
 * for a vector fixed in the world observed from the rotating phone frame,
 * ġ = −ω × g. With ω = ω·n that makes g's in-plane component rotate about
 * n at rate −ω, so signedAngleAbout(n, g(t), gRef) = +∫ω dt: this function
 * and the integrated gyro projection agree in sign by construction.
 */

import type { Vec3 } from '@/types/motion';
import { norm, signedAngleAbout } from './vec3';
import { G_MPS2, QUASI_STATIC_TOL_MPS2 } from './constants';

/**
 * Signed arm angle (radians) of gravity reading `g` relative to reference
 * `gRef`, about unit `pivotAxis`. Null when either vector is parallel to
 * the axis (angle undefined — should not happen on a sanely mounted phone).
 */
export function armAngleFromGravity(g: Vec3, pivotAxis: Vec3, gRef: Vec3): number | null {
  return signedAngleAbout(pivotAxis, g, gRef);
}

/**
 * True when an accel sample plausibly measures gravity alone: magnitude
 * within tolerance of g. Mid-stroke samples (centripetal + tangential
 * acceleration) fail this, which is exactly why the integrity check only
 * trusts endpoints.
 */
export function isQuasiStatic(accel: Vec3, tolMps2: number = QUASI_STATIC_TOL_MPS2): boolean {
  return Math.abs(norm(accel) - G_MPS2) <= tolMps2;
}
