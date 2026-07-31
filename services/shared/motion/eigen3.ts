/**
 * Symmetric 3×3 eigendecomposition via cyclic Jacobi rotations.
 *
 * Exists so the sweep-calibration axis estimate (principal eigenvector of
 * the gyro scatter matrix) doesn't pull a linear-algebra dependency into
 * the bundle for one 3×3 problem. Inputs here are PSD scatter matrices;
 * Jacobi on a symmetric 3×3 converges to machine precision in a handful of
 * sweeps and is unconditionally stable.
 */

import type { Vec3 } from '@/types/motion';

export type Sym3 = [[number, number, number], [number, number, number], [number, number, number]];

export interface Eigen3Result {
  /** Eigenvalues sorted descending. */
  values: [number, number, number];
  /** Unit eigenvectors, vectors[i] pairs with values[i]. */
  vectors: [Vec3, Vec3, Vec3];
}

const PAIRS: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [1, 2],
];

export function eigenSymmetric3(m: Sym3): Eigen3Result {
  // Working copies: a = matrix being diagonalized, v = accumulated rotations.
  const a = m.map((row) => [...row]) as number[][];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    const scale = Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]);
    if (off <= 1e-14 * Math.max(scale, 1e-30)) break;

    for (const [p, q] of PAIRS) {
      const apq = a[p][q];
      if (Math.abs(apq) < 1e-30) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;

      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }

  const pairs = [0, 1, 2]
    .map((i) => ({
      value: a[i][i],
      vector: { x: v[0][i], y: v[1][i], z: v[2][i] } as Vec3,
    }))
    .sort((p1, p2) => p2.value - p1.value);

  return {
    values: [pairs[0].value, pairs[1].value, pairs[2].value],
    vectors: [pairs[0].vector, pairs[1].vector, pairs[2].vector],
  };
}
