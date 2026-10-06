/**
 * Per-rep metrics from real captures, rebuilt as CaptureAnalysis objects
 * (the fields rep cleaning and the coach read; spans are synthetic but
 * contiguous so pause measurement works).
 */
import type { CaptureAnalysis, CaptureRep } from '../../captureAnalysis';

export interface RepColumns {
  meanW: number[];
  concS: number[];
  eccS: number[];
  peakW: number[];
  romDeg?: number[];
  dwellMs?: Array<number | null>;
}

export function analysisFromColumns(c: RepColumns, pc1 = 0.95): CaptureAnalysis {
  const tMs: number[] = [];
  let t = 0;
  const reps: CaptureRep[] = c.meanW.map((meanW, i) => {
    t += c.dwellMs?.[i] ?? 400;
    const start = tMs.push(t) - 1;
    t += c.concS[i] * 1000 + c.eccS[i] * 1000;
    const end = tMs.push(t) - 1;
    const rom = c.romDeg?.[i] ?? 60;
    return {
      index: i,
      concentric: { dir: 1, startIdx: start, endIdx: start, durationMs: c.concS[i] * 1000, romDeg: rom, peakW: c.peakW[i], meanW, romGravityDeg: null },
      eccentric: { dir: -1, startIdx: end, endIdx: end, durationMs: c.eccS[i] * 1000, romDeg: rom, peakW: c.peakW[i], meanW, romGravityDeg: null },
      concentricMs: c.concS[i] * 1000,
      eccentricMs: c.eccS[i] * 1000,
      peakW: c.peakW[i],
      meanWConcentric: meanW,
      romConcentricDeg: rom,
      romEccentricDeg: rom,
      romGravityDeg: null,
      bottomDwellMs: i === 0 ? null : c.dwellMs?.[i] ?? 400,
      turnaroundPeakAccelRadps2: i === 0 ? null : 2,
    };
  });
  return {
    sampleRateHz: 60,
    droppedFrames: 0,
    durationMs: t,
    stillness: {} as CaptureAnalysis['stillness'],
    tier: 'mounted',
    axis: { x: 1, y: 0, z: 0 },
    pc1VarianceShare: pc1,
    pc1Pc2Ratio: 20,
    lowConfidence: pc1 < 0.8,
    pc1GravityAngleDeg: 80,
    gravityRomStatus: 'ok',
    romSuppressed: false,
    tMs,
    w: tMs.map(() => 0),
    halfReps: reps.flatMap((r) => [r.concentric, r.eccentric]),
    reps,
    unpairedHalfReps: 0,
  };
}

/** The capture from the coach-feedback spec: rep 1 is an unrack/setup stroke. */
export const SETUP_STROKE_CAPTURE: RepColumns = {
  meanW: [1.46, 0.56, 0.52, 0.61, 0.61, 0.65, 0.64, 0.55, 0.64],
  concS: [0.47, 1.18, 1.27, 1.08, 1.02, 0.95, 0.98, 1.12, 0.95],
  eccS: [0.25, 1.06, 1.53, 2.3, 1.08, 1.28, 1.12, 1.38, 1.32],
  peakW: [2.88, 0.92, 0.95, 1.31, 1.1, 1.22, 1.14, 1.02, 1.14],
};
