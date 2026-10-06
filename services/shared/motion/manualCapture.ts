/**
 * Manual (Start/Stop) set capture — the pure half. The browser hook feeds
 * samples in and asks three questions:
 *
 *   - is the phone mounted right now?  (Start is only offered when it is)
 *   - should the safety auto-stop fire? (no motion for autoStopQuietMs
 *     after at least one rep)
 *   - what did the capture contain?     (trim → analyze → gate)
 *
 * All timing comes from sample timestamps. Rep detection is the unchanged
 * analyzeCapture; this only decides when to stop and what to keep.
 */

import type { ImuSample } from '@/types/motion';
import { norm } from './vec3';
import { trimCaptureTail } from './autoGate';
import type { CaptureAnalysis } from './captureAnalysis';
import { gateCapture, type CaptureGating } from './captureGating';
import { MOTION_SET_CONFIG } from './motionSetConfig';

/** True when the trailing mountedHoldMs of samples are all near-still. */
export function isMountedNow(recent: ImuSample[]): boolean {
  const { mountedGyroMaxRadps, mountedHoldMs } = MOTION_SET_CONFIG.capture;
  if (recent.length < 2) return false;
  const last = recent[recent.length - 1].tMs;
  if (last - recent[0].tMs < mountedHoldMs) return false;
  for (let i = recent.length - 1; i >= 0 && last - recent[i].tMs <= mountedHoldMs; i--) {
    if (norm(recent[i].gyro) > mountedGyroMaxRadps) return false;
  }
  return true;
}

/** Tracks the last moment of motion for the safety auto-stop. */
export class ManualCaptureClock {
  private lastMotionTMs: number | null = null;
  private latestTMs: number | null = null;

  feed(sample: ImuSample): void {
    this.latestTMs = sample.tMs;
    if (norm(sample.gyro) >= MOTION_SET_CONFIG.capture.motionOmegaRadps) {
      this.lastMotionTMs = sample.tMs;
    }
  }

  lastMotion(): number | null {
    return this.lastMotionTMs;
  }

  /** Auto-stop once ≥ 1 rep is counted and motion has been quiet long enough. */
  shouldAutoStop(liveReps: number): boolean {
    if (liveReps < 1 || this.lastMotionTMs === null || this.latestTMs === null) return false;
    return this.latestTMs - this.lastMotionTMs >= MOTION_SET_CONFIG.capture.autoStopQuietMs;
  }
}

/** Counted reps so far (same gating as the final result, no logged reps). */
export function liveRepCount(samples: ImuSample[]): number {
  if (samples.length < 30) return 0;
  const { analysis } = trimCaptureTail(samples);
  return gateCapture(analysis).reps.length;
}

export interface FinishedCapture {
  samples: ImuSample[];
  analysis: CaptureAnalysis;
  /** Gated without logged reps — the logged-count check runs at attach. */
  gating: CaptureGating;
  /** Sensor-clock time the set really ended (last counted rep, else last motion). */
  endTMs: number | null;
}

/**
 * Stop-time processing: cut trailing stillness (and, when the auto-stop
 * fired, everything after the last motion), trim the reach for the phone,
 * analyze, gate.
 */
export function finishManualCapture(
  samples: ImuSample[],
  lastMotionTMs: number | null = null
): FinishedCapture {
  const cut =
    lastMotionTMs !== null ? samples.filter((s) => s.tMs <= lastMotionTMs + 500) : samples;
  const { samples: trimmed, analysis } = trimCaptureTail(cut);
  const gating = gateCapture(analysis);
  const lastRep = gating.reps[gating.reps.length - 1];
  const endIdx = lastRep?.eccentric?.endIdx;
  const endTMs =
    endIdx !== undefined && analysis.tMs[endIdx] !== undefined
      ? analysis.tMs[endIdx]
      : lastMotionTMs;
  return { samples: trimmed, analysis, gating, endTMs };
}
