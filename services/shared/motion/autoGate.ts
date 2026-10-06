/**
 * Capture-tail trimming. (The automatic start gate that used to live here
 * was removed when in-workout capture became an explicit Start/Stop — see
 * manualCapture.ts.)
 */

import type { ImuSample } from '@/types/motion';
import { norm } from './vec3';
import { analyzeCapture, type CaptureAnalysis } from './captureAnalysis';

/** Post-stop margin kept after the last rep boundary (settling samples). */
const TRIM_TAIL_MARGIN_MS = 250;

/**
 * Trim-anchor gates. The reach for the phone segments into pseudo
 * half-reps too (its lobes project onto PC1 and can even merge past the
 * 400 ms duration floor), so the anchor additionally requires the motion
 * to actually ROTATE ABOUT PC1: real machine strokes are on-axis
 * (|w| ≈ |gyro|), pickup motion is multi-axis. These bound only the TRIM
 * anchor, never segmentation — no refractory window exists anywhere.
 */
const TRIM_ANCHOR_MIN_HALF_REP_MS = 400;
const TRIM_ANCHOR_MIN_AXIS_ALIGNMENT = 0.8;

/**
 * Trim the capture tail back to the last detected rep boundary: the reach
 * for the phone before Stop would otherwise appear as post-set motion.
 * Returns the (re-)analysis of whatever survives.
 */
export function trimCaptureTail(samples: ImuSample[]): {
  samples: ImuSample[];
  analysis: CaptureAnalysis;
} {
  const analysis = analyzeCapture(samples);

  // Mean |w|/|gyro| over a half-rep's moving samples: ≈1 for a stroke
  // about PC1, well below for multi-axis handling.
  const alignmentOf = (startIdx: number, endIdx: number): number => {
    let sum = 0;
    let count = 0;
    for (let i = startIdx; i <= endIdx; i++) {
      const mag = norm(samples[i].gyro);
      if (mag < 0.3) continue;
      sum += Math.min(1, Math.abs(analysis.w[i]) / mag);
      count++;
    }
    return count === 0 ? 0 : sum / count;
  };

  const anchor = [...analysis.halfReps]
    .reverse()
    .find(
      (h) =>
        h.durationMs >= TRIM_ANCHOR_MIN_HALF_REP_MS &&
        alignmentOf(h.startIdx, h.endIdx) >= TRIM_ANCHOR_MIN_AXIS_ALIGNMENT
    );
  if (!anchor) return { samples, analysis };
  const cutT = analysis.tMs[anchor.endIdx] + TRIM_TAIL_MARGIN_MS;
  if (samples.length === 0 || samples[samples.length - 1].tMs <= cutT) {
    return { samples, analysis };
  }
  const trimmed = samples.filter((s) => s.tMs <= cutT);
  return { samples: trimmed, analysis: analyzeCapture(trimmed) };
}
