/**
 * Automatic capture gate — removes the manual ARM/stop taps from the
 * in-workout flow:
 *
 *   ARMED    : IMU streams into a rolling ~3 s buffer; no capture exists.
 *   CAPTURING: entered when |gyro| stays above the enter threshold
 *              continuously for ≥ 200 ms; the capture is BACKFILLED from
 *              500 ms before the crossing using the buffer, so the ramp of
 *              rep 1 is never lost.
 *   DISARMED : no qualifying motion for 3 minutes — stop burning battery.
 *              Re-armed on any interaction with the exercise card.
 *
 * Stopping is external ("Log set" tap, or the manual fallback control).
 * Pure and framework-free: the browser layer feeds samples and reads
 * state; all timing comes from sample timestamps.
 */

import type { ImuSample } from '@/types/motion';
import { norm } from './vec3';
import { analyzeCapture, CAPTURE_ENTER_OMEGA_RADPS, type CaptureAnalysis } from './captureAnalysis';

export type AutoGateState = 'armed' | 'capturing' | 'disarmed';

export interface AutoGateOptions {
  /** |gyro| that counts as qualifying motion (defaults to the rep enter threshold). */
  enterOmegaRadps?: number;
  /** How long the threshold must hold continuously to start a capture. */
  sustainMs?: number;
  /** How far before the threshold crossing the capture is backfilled. */
  backfillMs?: number;
  /** Rolling pre-start buffer length. */
  bufferMs?: number;
  /** Disarm after this long armed with no capture start. */
  disarmAfterMs?: number;
}

export const AUTO_GATE_DEFAULTS: Required<AutoGateOptions> = {
  enterOmegaRadps: CAPTURE_ENTER_OMEGA_RADPS,
  sustainMs: 200,
  backfillMs: 500,
  bufferMs: 3000,
  disarmAfterMs: 3 * 60 * 1000,
};

export class AutoCaptureGate {
  private readonly opts: Required<AutoGateOptions>;
  private state: AutoGateState = 'armed';
  private buffer: ImuSample[] = [];
  private capture: ImuSample[] = [];
  /** Timestamp the current above-threshold run began (null = below). */
  private runStartTMs: number | null = null;
  private armedAtTMs: number | null = null;

  constructor(opts: AutoGateOptions = {}) {
    this.opts = { ...AUTO_GATE_DEFAULTS, ...opts };
  }

  feed(sample: ImuSample): AutoGateState {
    if (this.state === 'disarmed') return this.state;
    if (this.state === 'capturing') {
      this.capture.push(sample);
      return this.state;
    }

    // armed: rolling buffer + start detection.
    if (this.armedAtTMs === null) this.armedAtTMs = sample.tMs;
    this.buffer.push(sample);
    const cutoff = sample.tMs - this.opts.bufferMs;
    while (this.buffer.length > 0 && this.buffer[0].tMs < cutoff) this.buffer.shift();

    if (norm(sample.gyro) >= this.opts.enterOmegaRadps) {
      if (this.runStartTMs === null) this.runStartTMs = sample.tMs;
      if (sample.tMs - this.runStartTMs >= this.opts.sustainMs) {
        // START: backfill from before the crossing so rep 1's ramp is kept.
        const backfillFrom = this.runStartTMs - this.opts.backfillMs;
        this.capture = this.buffer.filter((s) => s.tMs >= backfillFrom);
        this.buffer = [];
        this.state = 'capturing';
        return this.state;
      }
    } else {
      this.runStartTMs = null;
      // Disarm only while quiet — an in-progress qualifying run never disarms.
      if (sample.tMs - this.armedAtTMs >= this.opts.disarmAfterMs) {
        this.buffer = [];
        this.state = 'disarmed';
      }
    }
    return this.state;
  }

  /** End the capture (external stop) and return everything collected. */
  collect(): ImuSample[] {
    const out = this.capture;
    this.capture = [];
    return out;
  }

  /** Reset the disarm clock; revive from 'disarmed' back to 'armed'. */
  rearm(): void {
    if (this.state === 'capturing') return;
    this.state = 'armed';
    this.armedAtTMs = null;
    this.runStartTMs = null;
  }

  current(): AutoGateState {
    return this.state;
  }
}

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
 * for the phone before "Log set" would otherwise appear as post-set motion.
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

/**
 * Auto-captures below this rep count are discarded silently (no UI):
 * warmups, seat adjustments, and re-racking all generate motion.
 */
export const MIN_AUTO_CAPTURE_REPS = 3;

export function shouldKeepAutoCapture(analysis: CaptureAnalysis): boolean {
  return analysis.reps.length >= MIN_AUTO_CAPTURE_REPS;
}
