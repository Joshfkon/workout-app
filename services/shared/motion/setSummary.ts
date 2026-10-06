/**
 * Set summary: velocity loss on the CLEAN reps and a capture-quality
 * verdict. Pure — the coach layer and the review panel read what this
 * returns. Thresholds: MOTION_SET_CONFIG (motionSetConfig.ts).
 *
 * Velocity-loss baseline (supersedes "fastest rep"): the faster of the
 * first two clean reps; the end point is the MEAN of the last two clean
 * reps, so one sloppy final rep can't dominate. Loss is floored at 0 — a
 * set that ends faster than it started lost nothing.
 */

import type { CaptureAnalysis } from './captureAnalysis';
import { MOTION_SET_CONFIG, type EffortZone } from './motionSetConfig';

export type { EffortZone };

export interface RepVelocity {
  /** 1-based clean rep number. */
  n: number;
  meanW: number | null;
  /** meanW / baseline; null when the rep had no measurable velocity. */
  relative: number | null;
  excluded: boolean;
}

export interface VelocityLossSummary {
  repCount: number;
  /** Clean rep number the baseline came from (1 or 2); null = no baseline. */
  baselineRep: number | null;
  baselineW: number | null;
  /** Mean of the last two clean reps' mean ω. */
  endW: number | null;
  /** (baseline − end) / baseline, floored at 0; null when hidden. */
  loss: number | null;
  zone: EffortZone | null;
  perRep: RepVelocity[];
  /** Rep numbers with missing / non-positive velocity (excluded). */
  excludedReps: number[];
}

type VelocityInput = { n: number; meanW: number };

const isValidW = (w: number | null | undefined): w is number =>
  typeof w === 'number' && Number.isFinite(w) && w > 0;

export function effortZone(loss: number): EffortZone {
  const z = MOTION_SET_CONFIG.coach.effortZones;
  if (loss < z.easyBelow) return 'easy';
  if (loss < z.moderateBelow) return 'moderate';
  if (loss <= z.hardUpTo) return 'hard';
  return 'near-failure';
}

export function computeVelocityLoss(reps: VelocityInput[]): VelocityLossSummary {
  const valid = reps.filter((r) => isValidW(r.meanW));
  const firstTwo = valid.slice(0, 2);
  const base = firstTwo.reduce<VelocityInput | null>(
    (best, r) => (!best || r.meanW > best.meanW ? r : best),
    null
  );
  const lastTwo = valid.slice(-2);
  const endW = lastTwo.length > 0 ? lastTwo.reduce((a, r) => a + r.meanW, 0) / lastTwo.length : null;

  const perRep: RepVelocity[] = reps.map((r) => {
    const ok = isValidW(r.meanW);
    return {
      n: r.n,
      meanW: ok ? r.meanW : null,
      relative: ok && base ? r.meanW / base.meanW : null,
      excluded: !ok,
    };
  });

  const show =
    valid.length >= MOTION_SET_CONFIG.coach.minRepsForLoss && base !== null && endW !== null;
  const loss = show ? Math.max(0, (base!.meanW - endW!) / base!.meanW) : null;

  return {
    repCount: reps.length,
    baselineRep: base?.n ?? null,
    baselineW: base?.meanW ?? null,
    endW,
    loss,
    zone: loss === null ? null : effortZone(loss),
    perRep,
    excludedReps: perRep.filter((p) => p.excluded).map((p) => p.n),
  };
}

export interface CaptureQualityIssue {
  key: 'dropped' | 'stillness' | 'pc1' | 'latency';
  /** Short badge text, e.g. "3 dropped samples". */
  label: string;
}

/**
 * Capture-quality checks for the review badge. `pc1Share` should be the
 * post-cleaning share when known; `stopLatencyMs` / `latencyWarnMs` are
 * optional — the stop-tap latency lives with the recorder.
 */
export function assessCaptureQuality(
  analysis: Pick<CaptureAnalysis, 'droppedFrames' | 'tier' | 'pc1VarianceShare'>,
  opts: { pc1Share?: number | null; stopLatencyMs?: number | null; latencyWarnMs?: number } = {}
): CaptureQualityIssue[] {
  const issues: CaptureQualityIssue[] = [];
  if (analysis.droppedFrames > 0) {
    issues.push({
      key: 'dropped',
      label: `${analysis.droppedFrames} dropped sample${analysis.droppedFrames === 1 ? '' : 's'}`,
    });
  }
  if (analysis.tier !== 'mounted') {
    issues.push({
      key: 'stillness',
      label: analysis.tier === 'handheld' ? 'Phone not mounted' : 'No still reference',
    });
  }
  const pc1 = opts.pc1Share ?? analysis.pc1VarianceShare;
  if (pc1 < MOTION_SET_CONFIG.gating.minPc1Share) {
    issues.push({ key: 'pc1', label: 'Motion in more than one direction' });
  }
  if (
    opts.stopLatencyMs != null &&
    opts.latencyWarnMs != null &&
    opts.stopLatencyMs > opts.latencyWarnMs
  ) {
    issues.push({ key: 'latency', label: 'Sensor lagging' });
  }
  return issues;
}
