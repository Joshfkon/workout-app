/**
 * Rep segmentation from the bias-corrected angular-rate series. Movement
 * phases are detected with amplitude HYSTERESIS (open above OMEGA_HIGH,
 * close below OMEGA_LOW), never from a bare zero crossing — noise around
 * zero must not chatter phases open and closed.
 */

import {
  MIN_PHASE_DEG,
  MIN_PHASE_MS,
  OMEGA_HIGH_RADPS,
  OMEGA_LOW_RADPS,
  RAD_TO_DEG,
} from './constants';

/** One contiguous movement phase. dir +1 = toward top (concentric on a press). */
export interface MovementPhase {
  dir: 1 | -1;
  /** Inclusive sample-index bounds. */
  startIdx: number;
  endIdx: number;
}

export interface SegmentationOptions {
  omegaHighRadps?: number;
  omegaLowRadps?: number;
  minPhaseMs?: number;
  minPhaseDeg?: number;
}

/**
 * Split the corrected ω series into signed movement phases.
 *
 * @param omega   bias-corrected angular rate per sample, rad/s
 * @param tMs     timestamps per sample, ms
 * @param theta   integrated angle per sample, rad (for the min-displacement gate)
 */
export function segmentPhases(
  omega: number[],
  tMs: number[],
  theta: number[],
  opts: SegmentationOptions = {}
): MovementPhase[] {
  const high = opts.omegaHighRadps ?? OMEGA_HIGH_RADPS;
  const low = opts.omegaLowRadps ?? OMEGA_LOW_RADPS;
  const minMs = opts.minPhaseMs ?? MIN_PHASE_MS;
  const minDeg = opts.minPhaseDeg ?? MIN_PHASE_DEG;

  const phases: MovementPhase[] = [];
  let openDir: 1 | -1 | 0 = 0;
  let openStart = 0;

  const close = (endIdx: number) => {
    if (openDir === 0) return;
    const durMs = tMs[endIdx] - tMs[openStart];
    const spanDeg = Math.abs(theta[endIdx] - theta[openStart]) * RAD_TO_DEG;
    // Jitter gate: a real stroke both lasts and travels.
    if (durMs >= minMs && spanDeg >= minDeg) {
      phases.push({ dir: openDir, startIdx: openStart, endIdx });
    }
    openDir = 0;
  };

  for (let i = 0; i < omega.length; i++) {
    const w = omega[i];
    if (openDir === 0) {
      if (Math.abs(w) >= high) {
        openDir = w > 0 ? 1 : -1;
        // Backtrack to where the ramp actually left the low band, so the
        // phase includes its acceleration from (near) rest.
        let j = i;
        while (j > 0 && Math.abs(omega[j - 1]) > low && Math.sign(omega[j - 1]) === openDir) j--;
        openStart = j;
      }
    } else if (Math.abs(w) <= low) {
      close(i);
    } else if (Math.sign(w) !== openDir && Math.abs(w) >= high) {
      // Instant reversal without dipping under the low band (fast touch-and-go
      // turnaround between two samples): close the phase and open the new one.
      close(i - 1 >= openStart ? i - 1 : i);
      openDir = w > 0 ? 1 : -1;
      openStart = i;
    }
  }
  close(omega.length - 1);

  return phases;
}
