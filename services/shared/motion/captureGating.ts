/**
 * Confidence gating for a set capture: decides which detected reps count
 * and whether the capture is trustworthy enough to say anything about.
 *
 *   1. SPLIT at any inter-rep pause > splitPauseMs (setup, re-racking, a
 *      rest) and keep only the longest continuous block. The first rep of
 *      the kept block gets no dwell / turnaround metrics — its "bottom" was
 *      the pause, not a turnaround (this is what once produced "dwell
 *      dropped from 18710 ms").
 *   2. PARTIALS: within the block, a rep travelling under
 *      partialRepMaxRomFraction of the block's median ROM is a short-travel
 *      movement: it is excluded from the rep count and
 *      is left out of every velocity figure.
 *   3. LOW CONFIDENCE when any of: a split happened; partials exceed
 *      lowConfidencePartialShare; counted reps differ from the logged reps
 *      by more than repMismatchMaxAbs or repMismatchMaxFraction.
 *
 * A low-confidence capture produces no velocity observations and no
 * recommendation — only the reason. Rep detection itself is untouched;
 * this only filters its output. Pure.
 */

import type { CaptureAnalysis, CaptureRep } from './captureAnalysis';
import { MOTION_SET_CONFIG } from './motionSetConfig';

export type CaptureConfidence = 'ok' | 'low';

export interface CaptureGating {
  /** Counted reps (kept block, partials removed), re-indexed from 0. */
  reps: CaptureRep[];
  /** Reps the detector found across the whole capture. */
  rawRepCount: number;
  /** Partials removed from the kept block. */
  partialRepCount: number;
  /** Longest inter-rep pause that triggered a split, ms (null = no split). */
  splitPauseMs: number | null;
  confidence: CaptureConfidence;
  /** Short lowercase phrases, most important first ("" when confident). */
  lowReasons: string[];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Pause between rep `prev` ending and rep `next` starting, ms. */
function pauseBetween(analysis: CaptureAnalysis, prev: CaptureRep, next: CaptureRep): number {
  const { tMs } = analysis;
  const end = tMs[prev.eccentric?.endIdx ?? -1];
  const start = tMs[next.concentric?.startIdx ?? -1];
  const gap = end !== undefined && start !== undefined ? start - end : 0;
  // The dwell into `next` is the same pause measured from the other side.
  return Math.max(gap, next.bottomDwellMs ?? 0);
}

/** Split reps at long pauses; returns the blocks in order. */
export function splitAtPauses(
  analysis: CaptureAnalysis,
  reps: CaptureRep[] = analysis.reps
): { blocks: CaptureRep[][]; pausesMs: number[] } {
  const blocks: CaptureRep[][] = [];
  const pausesMs: number[] = [];
  let current: CaptureRep[] = [];
  for (const rep of reps) {
    const prev = current[current.length - 1];
    if (prev) {
      const pause = pauseBetween(analysis, prev, rep);
      if (pause > MOTION_SET_CONFIG.gating.splitPauseMs) {
        blocks.push(current);
        pausesMs.push(pause);
        current = [];
      }
    }
    current.push(rep);
  }
  if (current.length > 0) blocks.push(current);
  return { blocks, pausesMs };
}

const fmtSeconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function gateCapture(
  analysis: CaptureAnalysis,
  loggedReps: number | null = null
): CaptureGating {
  const cfg = MOTION_SET_CONFIG.gating;
  const rawRepCount = analysis.reps.length;

  // 1. Split; keep the longest block (the later one on a tie — setup
  //    motion comes before a set more often than after it).
  const { blocks, pausesMs } = splitAtPauses(analysis);
  let kept: CaptureRep[] = [];
  for (const b of blocks) if (b.length >= kept.length) kept = b;
  const splitPauseMs = pausesMs.length > 0 ? Math.max(...pausesMs) : null;

  // 2. Partials vs the kept block's median travel.
  const romMedian = median(kept.map((r) => r.romConcentricDeg));
  const isPartial = (r: CaptureRep) =>
    romMedian > 0 && r.romConcentricDeg < romMedian * cfg.partialRepMaxRomFraction;
  const partialRepCount = kept.filter(isPartial).length;

  const counted = kept.filter((r) => !isPartial(r));
  // A block that starts after a split: its first rep's "bottom" was the
  // pause, so dwell / turnaround metrics would describe the rest, not a rep.
  const startsAfterSplit = kept.length > 0 && blocks[0] !== kept;
  const reps = counted.map((r, i) =>
    i === 0 && startsAfterSplit && r === kept[0]
      ? { ...r, index: i, bottomDwellMs: null, turnaroundPeakAccelRadps2: null }
      : { ...r, index: i }
  );

  // 3. Confidence.
  const lowReasons: string[] = [];
  if (loggedReps !== null && loggedReps > 0) {
    const diff = Math.abs(reps.length - loggedReps);
    if (diff > cfg.repMismatchMaxAbs || diff > loggedReps * cfg.repMismatchMaxFraction) {
      lowReasons.push(`sensor counted ${reps.length} reps, you logged ${loggedReps}`);
    }
  }
  if (splitPauseMs !== null) {
    lowReasons.push(`paused ${fmtSeconds(splitPauseMs)} mid-capture`);
  }
  if (kept.length > 0 && partialRepCount / kept.length > cfg.lowConfidencePartialShare) {
    lowReasons.push(`${partialRepCount} of ${kept.length} movements were partial`);
  }

  return {
    reps,
    rawRepCount,
    partialRepCount,
    splitPauseMs,
    confidence: lowReasons.length > 0 ? 'low' : 'ok',
    lowReasons,
  };
}

/** "Capture unclear: {reason}. Logged reps used." */
export function captureUnclearLine(gating: CaptureGating): string | null {
  if (gating.confidence === 'ok') return null;
  return `Capture unclear: ${gating.lowReasons[0]}. Logged reps used.`;
}

/** One sentence on what gating did, for diagnostics (null when nothing). */
export function describeGating(g: CaptureGating): string | null {
  const blockSize = g.reps.length + g.partialRepCount;
  const parts = [
    g.rawRepCount !== blockSize
      ? `${g.rawRepCount} movements detected; the longest continuous block (${blockSize}) is used`
      : null,
    g.splitPauseMs !== null ? `split at a ${fmtSeconds(g.splitPauseMs)} pause` : null,
    g.partialRepCount > 0
      ? `${g.partialRepCount} short-travel movement${g.partialRepCount === 1 ? '' : 's'} left out of the rep count`
      : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const text = parts.join('; ');
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}
