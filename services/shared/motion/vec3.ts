/**
 * Minimal 3-vector math for the motion pipeline. Pure, allocation-light,
 * no dependencies — everything under services/shared/motion must stay
 * framework-free and unit-testable.
 */

import type { Vec3 } from '@/types/motion';

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Unit vector, or null when the input is (numerically) zero. */
export function normalize(a: Vec3): Vec3 | null {
  const n = norm(a);
  if (n < 1e-9) return null;
  return scale(a, 1 / n);
}

/** Component of `v` perpendicular to unit vector `n` (projection onto n's plane). */
export function perpComponent(v: Vec3, n: Vec3): Vec3 {
  return sub(v, scale(n, dot(v, n)));
}

/**
 * Rotate `v` by `angleRad` about unit axis `n` (Rodrigues). Used by the
 * synthetic-signal test generator and axis-consistency checks.
 */
export function rotateAbout(v: Vec3, n: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const nxv = cross(n, v);
  const ndv = dot(n, v);
  return {
    x: v.x * c + nxv.x * s + n.x * ndv * (1 - c),
    y: v.y * c + nxv.y * s + n.y * ndv * (1 - c),
    z: v.z * c + nxv.z * s + n.z * ndv * (1 - c),
  };
}

/**
 * Signed angle (radians, in (-π, π]) that rotates `from` into `to` about
 * unit axis `n`, using only the components perpendicular to `n`.
 * Positive = right-hand rotation about `n`. Returns null when either vector
 * is (numerically) parallel to the axis — the angle is undefined there.
 */
export function signedAngleAbout(n: Vec3, from: Vec3, to: Vec3): number | null {
  const u = perpComponent(from, n);
  const v = perpComponent(to, n);
  if (norm(u) < 1e-9 || norm(v) < 1e-9) return null;
  return Math.atan2(dot(n, cross(u, v)), dot(u, v));
}
