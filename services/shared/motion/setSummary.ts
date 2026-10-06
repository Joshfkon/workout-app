/**
 * Set summary for the capture review: velocity loss against the FASTEST rep,
 * per-rep relative velocity, short plain-language callouts, and a capture
 * quality verdict. Pure — the review panel renders what this returns.
 *
 * Velocity-loss baseline: the fastest rep by mean concentric velocity, not
 * rep 1 (standard VBT practice — rep 1 is often slower while the lifter
 * settles in). Reps with a missing / non-positive mean velocity are
 * excluded from the baseline and flagged.
 */

import type { CaptureAnalysis, CaptureRep } from './captureAnalysis';

export type VelocityZone = 'fresh' | 'hard' | 'near-failure';

/** Every threshold the set summary uses, in one place. */
export const SET_SUMMARY_CONFIG = {
  /** Below this many reps the velocity-loss headline is hidden. */
  minRepsForLoss: 3,
  /** Loss zones (fraction of best-rep velocity lost). < hardFrom → fresh. */
  zones: {
    hardFrom: 0.2,
    nearFailureAbove: 0.4,
  },
  zoneLabels: {
    fresh: 'Plenty left',
    hard: 'Getting hard',
    'near-failure': 'Near failure',
  } as Record<VelocityZone, string>,
  callouts: {
    max: 3,
    /** Last rep's relative velocity below this → sharp-drop callout. */
    sharpDropBelowRelative: 0.6,
    /** Bottom dwell above this (ms) → pause callout. */
    longPauseAboveMs: 150,
    /** Eccentric duration above this multiple of the set median → callout. */
    slowEccentricRatio: 1.4,
  },
} as const;

export interface RepVelocity {
  /** 0-based rep index (CaptureRep.index). */
  index: number;
  meanW: number | null;
  /** meanW / best meanW; null when the rep was excluded. */
  relative: number | null;
  excluded: boolean;
}

export interface VelocityLossSummary {
  repCount: number;
  /** 0-based index of the fastest valid rep; null when no rep is valid. */
  bestIndex: number | null;
  bestMeanW: number | null;
  /** (best - last) / best, last = last valid rep. Null when hidden. */
  loss: number | null;
  zone: VelocityZone | null;
  perRep: RepVelocity[];
  /** 0-based indices excluded from the baseline (missing / ≤ 0 mean ω). */
  excludedIndices: number[];
}

type VelocityInput = Pick<CaptureRep, 'index' | 'meanWConcentric'>;

const isValidW = (w: number | null | undefined): w is number =>
  typeof w === 'number' && Number.isFinite(w) && w > 0;

export function velocityZone(loss: number): VelocityZone {
  const { hardFrom, nearFailureAbove } = SET_SUMMARY_CONFIG.zones;
  if (loss > nearFailureAbove) return 'near-failure';
  if (loss >= hardFrom) return 'hard';
  return 'fresh';
}

export function computeVelocityLoss(reps: VelocityInput[]): VelocityLossSummary {
  let best: VelocityInput | null = null;
  for (const r of reps) {
    if (isValidW(r.meanWConcentric) && (!best || r.meanWConcentric > best.meanWConcentric)) {
      best = r;
    }
  }
  const bestW = best ? best.meanWConcentric : null;

  const perRep: RepVelocity[] = reps.map((r) => {
    const valid = isValidW(r.meanWConcentric);
    return {
      index: r.index,
      meanW: valid ? r.meanWConcentric : null,
      relative: valid && bestW ? r.meanWConcentric / bestW : null,
      excluded: !valid,
    };
  });
  const excludedIndices = perRep.filter((p) => p.excluded).map((p) => p.index);

  const validReps = perRep.filter((p) => !p.excluded);
  const last = validReps[validReps.length - 1];
  const showLoss =
    reps.length >= SET_SUMMARY_CONFIG.minRepsForLoss && bestW !== null && last?.meanW != null;
  const loss = showLoss ? Math.max(0, (bestW - last.meanW!) / bestW) : null;

  return {
    repCount: reps.length,
    bestIndex: best ? best.index : null,
    bestMeanW: bestW,
    loss,
    zone: loss === null ? null : velocityZone(loss),
    perRep,
    excludedIndices,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface SetCallout {
  kind: 'sharp-drop' | 'slow-eccentric' | 'long-pause';
  text: string;
}

/**
 * At most `callouts.max` short lines, in priority order: sharp drop on the
 * last rep, slowest eccentric outlier, longest pause. One line per kind.
 */
export function buildSetCallouts(
  reps: CaptureRep[],
  velocity: VelocityLossSummary = computeVelocityLoss(reps)
): SetCallout[] {
  const cfg = SET_SUMMARY_CONFIG.callouts;
  const out: SetCallout[] = [];
  if (reps.length === 0) return out;

  // Sharp drop: the last rep (only when it has a measured velocity).
  const lastRel = velocity.perRep[velocity.perRep.length - 1];
  if (
    velocity.loss !== null &&
    lastRel.relative !== null &&
    lastRel.relative < cfg.sharpDropBelowRelative
  ) {
    out.push({
      kind: 'sharp-drop',
      text: `Rep ${lastRel.index + 1} slowed sharply — likely close to failure.`,
    });
  }

  // Slow eccentric: biggest outlier vs the set median.
  if (reps.length >= SET_SUMMARY_CONFIG.minRepsForLoss) {
    const med = median(reps.map((r) => r.eccentricMs));
    if (med > 0) {
      const outlier = reps
        .filter((r) => r.eccentricMs > med * cfg.slowEccentricRatio)
        .sort((a, b) => b.eccentricMs - a.eccentricMs)[0];
      if (outlier) {
        out.push({
          kind: 'slow-eccentric',
          text: `Rep ${outlier.index + 1} lowered noticeably slower.`,
        });
      }
    }
  }

  // Long pause: the longest bottom dwell over threshold.
  const pause = reps
    .filter((r) => r.bottomDwellMs !== null && r.bottomDwellMs > cfg.longPauseAboveMs)
    .sort((a, b) => (b.bottomDwellMs ?? 0) - (a.bottomDwellMs ?? 0))[0];
  if (pause) {
    out.push({
      kind: 'long-pause',
      text: `Paused ${Math.round((pause.bottomDwellMs ?? 0) / 10) * 10} ms before rep ${pause.index + 1}.`,
    });
  }

  return out.slice(0, cfg.max);
}

export interface CaptureQualityIssue {
  key: 'dropped' | 'stillness' | 'pc1' | 'latency';
  /** Short badge text, e.g. "3 dropped samples". */
  label: string;
}

/**
 * Capture-quality checks for the review badge. `stopLatencyMs` /
 * `latencyWarnMs` are optional — the stop-tap latency lives with the
 * recorder, not the analysis.
 */
export function assessCaptureQuality(
  analysis: Pick<CaptureAnalysis, 'droppedFrames' | 'tier' | 'lowConfidence'>,
  opts: { stopLatencyMs?: number | null; latencyWarnMs?: number } = {}
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
  if (analysis.lowConfidence) {
    issues.push({ key: 'pc1', label: 'Motion not single-axis' });
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
