/**
 * Live capture gate: the tiny pure state machine the ARM screen feeds with
 * projected angular-rate samples. Decides when a recording has actually
 * started (motion onset above threshold) and when to auto-terminate
 * (5 s below the rest threshold after motion was seen).
 *
 * Pure so it is unit-testable; the browser layer owns the sensors and just
 * calls feed() per sample.
 */

import { AUTO_STOP_QUIET_MS, ONSET_OMEGA_RADPS, REST_OMEGA_RADPS } from './constants';

export type LiveGateState = 'armed' | 'recording' | 'done';

export interface LiveGateOptions {
  onsetOmegaRadps?: number;
  restOmegaRadps?: number;
  autoStopQuietMs?: number;
}

export class LiveCaptureGate {
  private readonly onsetOmega: number;
  private readonly restOmega: number;
  private readonly quietMs: number;

  private state: LiveGateState = 'armed';
  private biasSum = 0;
  private biasCount = 0;
  private lastActiveTMs: number | null = null;
  private motionStartTMs: number | null = null;

  constructor(opts: LiveGateOptions = {}) {
    this.onsetOmega = opts.onsetOmegaRadps ?? ONSET_OMEGA_RADPS;
    this.restOmega = opts.restOmegaRadps ?? REST_OMEGA_RADPS;
    this.quietMs = opts.autoStopQuietMs ?? AUTO_STOP_QUIET_MS;
  }

  /** Feed one projected angular-rate sample; returns the current state. */
  feed(tMs: number, omegaRadps: number): LiveGateState {
    if (this.state === 'done') return this.state;

    if (this.state === 'armed') {
      // While armed-and-quiet, accumulate the pre-set bias estimate.
      if (Math.abs(omegaRadps - this.biasEstimate()) < this.onsetOmega) {
        this.biasSum += omegaRadps;
        this.biasCount++;
        return this.state;
      }
      this.state = 'recording';
      this.motionStartTMs = tMs;
      this.lastActiveTMs = tMs;
      return this.state;
    }

    // recording
    if (Math.abs(omegaRadps - this.biasEstimate()) >= this.restOmega) {
      this.lastActiveTMs = tMs;
    } else if (this.lastActiveTMs !== null && tMs - this.lastActiveTMs >= this.quietMs) {
      this.state = 'done';
    }
    return this.state;
  }

  /** Running bias estimate from the armed quiet period (rad/s). */
  biasEstimate(): number {
    return this.biasCount === 0 ? 0 : this.biasSum / this.biasCount;
  }

  /** Timestamp of motion onset, ms (null until recording starts). */
  motionStartedAt(): number | null {
    return this.motionStartTMs;
  }

  current(): LiveGateState {
    return this.state;
  }
}
