/**
 * Rep cleaning + confidence for a set capture. Runs BEFORE any analysis
 * (velocity loss, coach findings): rep detection is untouched, this only
 * decides which detected reps are real working reps.
 *
 *   1. SPLIT at any inter-rep pause > splitPauseMs (setup, re-rack, rest)
 *      and keep only the longest continuous block. The split alone costs
 *      confidence only when the kept block can't be checked against (or
 *      disagrees with) the logged rep count.
 *   2. REJECT setup / re-rack artifacts, judged against the median of ALL
 *      detected reps: concentric or eccentric duration < minDurationFraction
 *      of median, peak ω > maxPeakRatio × median, or ROM < minRomFraction of
 *      median. (The first and last reps are where these live — unracking,
 *      a seat adjustment, the re-rack — but every rep is checked.)
 *   3. Unpaired movement phases were never reps (the detector reports them
 *      separately) and stay uncounted.
 *   4. PC1 share is recomputed over the CLEAN reps' motion only (when the
 *      samples are available), so a capture flagged multi-axis because of a
 *      re-rack can be upgraded once that re-rack is removed.
 *
 * The result (CleanedCapture) is plain data — it is what gets persisted, so
 * a capture reloaded without its raw samples can still be coached.
 * Thresholds: MOTION_SET_CONFIG.cleaning / .gating. Pure.
 */

import type { ImuSample, Vec3 } from '@/types/motion';
import {
  CAPTURE_FILTER_CUTOFF_HZ,
  CAPTURE_MASK_OMEGA_RADPS,
  pcaOfVectors,
  type CaptureAnalysis,
  type CaptureRep,
} from './captureAnalysis';
import { lowpassZeroPhase } from './butterworth';
import { MOTION_SET_CONFIG } from './motionSetConfig';

/** Bump when cleaning semantics change; older persisted captures are reprocessed or left uncoached. */
export const CLEANING_VERSION = 2;

/** A counted rep, numbered the way the lifter counts (1-based, artifacts removed). */
export interface CleanRep {
  n: number;
  /** 0-based index among the detector's reps (for the chart / diagnostics). */
  detectedIndex: number;
  concentricMs: number;
  eccentricMs: number;
  peakW: number;
  meanW: number;
  romDeg: number;
  romGravityDeg: number | null;
  /** Pause before this rep's concentric, ms (null on the first counted rep). */
  dwellMs: number | null;
  turnaroundAccelRadps2: number | null;
}

export interface RejectedRep {
  /** 1-based detected rep number. */
  detectedRep: number;
  /** Plain-language reasons with the numbers that tripped them. */
  reasons: string[];
}

export interface CleanedCapture {
  version: typeof CLEANING_VERSION;
  reps: CleanRep[];
  rejected: RejectedRep[];
  rawRepCount: number;
  unpairedHalfReps: number;
  /** Longest pause that caused a split, ms (null = no split). */
  splitPauseMs: number | null;
  /** Detected reps outside the kept block (setup before / after a long pause). */
  outsideBlockCount: number;
  pc1ShareRaw: number;
  /** PC1 share over the clean reps only; null when samples weren't available. */
  pc1ShareClean: number | null;
}

export type CaptureConfidence = 'ok' | 'low';

export interface ConfidenceResult {
  confidence: CaptureConfidence;
  /** Plain-language reasons, most important first. */
  reasons: string[];
  /** Low on PC1 before cleaning, fine after. */
  upgradedByCleaning: boolean;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const sec = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** Pause between rep `prev` ending and rep `next` starting, ms. */
function pauseBetween(analysis: CaptureAnalysis, prev: CaptureRep, next: CaptureRep): number {
  const { tMs } = analysis;
  const end = tMs?.[prev.eccentric?.endIdx ?? -1];
  const start = tMs?.[next.concentric?.startIdx ?? -1];
  const gap = end !== undefined && start !== undefined ? start - end : 0;
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

/** Why a rep is a setup / re-rack artifact (empty = it's a real rep). */
function artifactReasons(
  rep: CaptureRep,
  med: { conc: number; ecc: number; peak: number; rom: number }
): string[] {
  const c = MOTION_SET_CONFIG.cleaning;
  const out: string[] = [];
  if (med.conc > 0 && rep.concentricMs < med.conc * c.minDurationFraction) {
    out.push(`lifted in ${sec(rep.concentricMs)} (typical ${sec(med.conc)})`);
  }
  if (med.ecc > 0 && rep.eccentricMs < med.ecc * c.minDurationFraction) {
    out.push(`lowered in ${sec(rep.eccentricMs)} (typical ${sec(med.ecc)})`);
  }
  if (med.peak > 0 && rep.peakW > med.peak * c.maxPeakRatio) {
    out.push(
      `peak speed ${rep.peakW.toFixed(2)} rad/s, ${(rep.peakW / med.peak).toFixed(1)}× typical`
    );
  }
  if (med.rom > 0 && rep.romConcentricDeg < med.rom * c.minRomFraction) {
    out.push(`travelled ${rep.romConcentricDeg.toFixed(0)}° (typical ${med.rom.toFixed(0)}°)`);
  }
  return out;
}

/** PC1 share of the filtered gyro over the given reps' spans. */
function cleanPc1Share(
  analysis: CaptureAnalysis,
  samples: ImuSample[],
  reps: CaptureRep[]
): number | null {
  if (samples.length !== analysis.tMs.length || reps.length === 0 || !(analysis.sampleRateHz > 0)) {
    return null;
  }
  const rate = analysis.sampleRateHz;
  const fx = lowpassZeroPhase(samples.map((s) => s.gyro.x), CAPTURE_FILTER_CUTOFF_HZ, rate);
  const fy = lowpassZeroPhase(samples.map((s) => s.gyro.y), CAPTURE_FILTER_CUTOFF_HZ, rate);
  const fz = lowpassZeroPhase(samples.map((s) => s.gyro.z), CAPTURE_FILTER_CUTOFF_HZ, rate);
  const vs: Vec3[] = [];
  for (const r of reps) {
    const from = r.concentric?.startIdx ?? 0;
    const to = r.eccentric?.endIdx ?? from;
    for (let i = from; i <= to && i < fx.length; i++) {
      if (Math.hypot(fx[i], fy[i], fz[i]) > CAPTURE_MASK_OMEGA_RADPS) {
        vs.push({ x: fx[i], y: fy[i], z: fz[i] });
      }
    }
  }
  return pcaOfVectors(vs)?.share ?? null;
}

export function cleanCapture(analysis: CaptureAnalysis, samples?: ImuSample[]): CleanedCapture {
  const all = analysis.reps;

  // 1. Split; keep the longest block (the later one on a tie — setup motion
  //    comes before a set more often than after it).
  const { blocks, pausesMs } = splitAtPauses(analysis);
  let kept: CaptureRep[] = [];
  for (const b of blocks) if (b.length >= kept.length) kept = b;
  const splitPauseMs = pausesMs.length > 0 ? Math.max(...pausesMs) : null;

  // 2. Artifacts vs the median of ALL detected reps.
  const med = {
    conc: median(all.map((r) => r.concentricMs)),
    ecc: median(all.map((r) => r.eccentricMs)),
    peak: median(all.map((r) => r.peakW)),
    rom: median(all.map((r) => r.romConcentricDeg)),
  };
  const rejected: RejectedRep[] = [];
  const counted: CaptureRep[] = [];
  for (const rep of kept) {
    const reasons = artifactReasons(rep, med);
    if (reasons.length > 0) rejected.push({ detectedRep: rep.index + 1, reasons });
    else counted.push(rep);
  }

  // A counted rep's "pause before" only describes a turnaround when the
  // rep right before it was also counted — otherwise it is the pre-set
  // rest, a split pause, or the gap after a rejected setup stroke.
  const reps: CleanRep[] = counted.map((r, i) => {
    const prevCounted = i > 0 && counted[i - 1].index === r.index - 1;
    return {
      n: i + 1,
      detectedIndex: r.index,
      concentricMs: r.concentricMs,
      eccentricMs: r.eccentricMs,
      peakW: r.peakW,
      meanW: r.meanWConcentric,
      romDeg: r.romConcentricDeg,
      romGravityDeg: r.romGravityDeg,
      dwellMs: prevCounted ? r.bottomDwellMs : null,
      turnaroundAccelRadps2: prevCounted ? r.turnaroundPeakAccelRadps2 : null,
    };
  });

  return {
    version: CLEANING_VERSION,
    reps,
    rejected,
    rawRepCount: all.length,
    unpairedHalfReps: analysis.unpairedHalfReps ?? 0,
    splitPauseMs,
    outsideBlockCount: all.length - kept.length,
    pc1ShareRaw: analysis.pc1VarianceShare,
    pc1ShareClean: samples ? cleanPc1Share(analysis, samples, counted) : null,
  };
}

export const MULTI_AXIS_REASON =
  'the sensor picked up movement in more than one direction, so these numbers are rough';

export function assessConfidence(
  cleaned: CleanedCapture,
  loggedReps: number | null = null
): ConfidenceResult {
  const g = MOTION_SET_CONFIG.gating;
  const reasons: string[] = [];
  const counted = cleaned.reps.length;

  const hasLogged = loggedReps !== null && loggedReps > 0;
  let countMatches = false;
  if (hasLogged) {
    const diff = Math.abs(counted - loggedReps);
    countMatches = !(diff > g.repMismatchMaxAbs || diff > loggedReps * g.repMismatchMaxFraction);
    if (!countMatches) {
      reasons.push(`the sensor counted ${counted} reps but you logged ${loggedReps}`);
    }
  }
  // A long pause split the capture. If the kept block agrees with the
  // logged count, the split found the set (rest-pause, a mid-set re-seat):
  // confident. With no logged count to check against, it stays unclear.
  if (cleaned.splitPauseMs !== null && !countMatches) {
    reasons.push(`there was a ${(cleaned.splitPauseMs / 1000).toFixed(0)}-second stop mid-set`);
  }
  const detectedInBlock = cleaned.rawRepCount - cleaned.outsideBlockCount;
  if (detectedInBlock > 0 && cleaned.rejected.length / detectedInBlock > g.lowConfidenceRejectedShare) {
    reasons.push(
      `${cleaned.rejected.length} of ${detectedInBlock} movements didn't look like working reps`
    );
  }
  const pc1 = cleaned.pc1ShareClean ?? cleaned.pc1ShareRaw;
  if (pc1 < g.minPc1Share) reasons.push(MULTI_AXIS_REASON);
  if (counted === 0) reasons.push('no working reps were found');

  return {
    confidence: reasons.length > 0 ? 'low' : 'ok',
    reasons,
    upgradedByCleaning:
      cleaned.pc1ShareRaw < g.minPc1Share &&
      cleaned.pc1ShareClean !== null &&
      cleaned.pc1ShareClean >= g.minPc1Share,
  };
}

/** "Capture unclear: {reason}." — null when confident. */
export function captureUnclearLine(result: ConfidenceResult): string | null {
  if (result.confidence === 'ok') return null;
  const r = result.reasons[0];
  return `Capture unclear: ${r[0].toUpperCase()}${r.slice(1)}.`;
}

/** One line per thing cleaning did (diagnostics + the console log). */
export function describeCleaning(c: CleanedCapture): string[] {
  const lines: string[] = [];
  if (c.splitPauseMs !== null) {
    lines.push(
      `Split at a ${(c.splitPauseMs / 1000).toFixed(1)} s pause; ${c.outsideBlockCount} detected rep${
        c.outsideBlockCount === 1 ? '' : 's'
      } outside the main block set aside.`
    );
  }
  for (const r of c.rejected) {
    lines.push(`Detected rep ${r.detectedRep} set aside as setup motion: ${r.reasons.join('; ')}.`);
  }
  if (c.unpairedHalfReps > 0) {
    lines.push(
      `${c.unpairedHalfReps} movement phase${c.unpairedHalfReps === 1 ? '' : 's'} didn't pair into a rep (left out of the rep count).`
    );
  }
  return lines;
}
