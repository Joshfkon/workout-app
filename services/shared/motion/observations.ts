/**
 * Post-set observations: plain declarative sentences describing what the
 * sensor measured, compared ONLY against the same set's median.
 *
 * FRAMING (load-bearing, enforced by test): this module DESCRIBES, it never
 * judges. No dismissive or judgmental label ever attaches to a rep, and no
 * text asserts technique deteriorated. ROM shortening and velocity loss are what
 * approaching failure looks like in a normal, productive set — labeling
 * them errors would systematically discount the most stimulative reps, and
 * the sensor cannot distinguish an honest grind from a cheated rep anyway.
 *
 * Reference discipline: within-set median only. No stored templates, no
 * prior sessions, no population norms — same load, same mount, minutes
 * apart; the only variable that moved is fatigue. With fewer than
 * MIN_REPS_FOR_REFERENCE reps the median is too thin, and every
 * percentage-of-median figure is suppressed (raw values still display).
 */

import type { CaptureRep } from './captureAnalysis';

/** Below this many reps, the set median is too thin to compare against. */
export const MIN_REPS_FOR_REFERENCE = 4;

/** Emission thresholds (see the display spec). */
export const ROM_LINE_MAX_PCT_OF_MEDIAN = 85;
export const VELOCITY_LINE_MIN_DROP_PCT = 20;
export const TURNAROUND_LINE_MIN_RATIO = 2.0;
export const DWELL_LINE_MIN_REDUCTION_PCT = 50;

/** Always shown under the observations — standing context, not a warning. */
export const OBSERVATIONS_CONTEXT_LINE =
  'Range of motion and velocity normally decline toward the end of a hard set. ' +
  'These are measurements, not errors.';

export const NOTHING_NOTABLE_LINE =
  'Nothing notable — metrics were consistent across the set.';

export const THIN_REFERENCE_LINE =
  'Fewer than 4 reps in this set, so per-rep values are shown without ' +
  'set-median comparisons.';

export interface SetObservations {
  /** At most 4 declarative lines, one per metric type. */
  lines: string[];
  /** True when no line qualified (display NOTHING_NOTABLE_LINE). */
  nothingNotable: boolean;
  /** True when reps < MIN_REPS_FOR_REFERENCE: no median comparisons. */
  referenceTooThin: boolean;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** "Reps 10-12" / "rep 4" / "reps 3, 5-7" from 0-based indices. */
function formatRepRanges(indices: number[]): string {
  const sorted = [...indices].sort((a, b) => a - b).map((i) => i + 1);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const v of sorted.slice(1).concat([Number.NaN])) {
    if (v === prev + 1) {
      prev = v;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = v;
    prev = v;
  }
  const plural = sorted.length > 1 || parts[0].includes('-');
  return `${plural ? 'Reps' : 'Rep'} ${parts.join(', ')}`;
}

const round10 = (ms: number) => Math.round(ms / 10) * 10;

export function buildObservations(reps: CaptureRep[]): SetObservations {
  if (reps.length < MIN_REPS_FOR_REFERENCE) {
    return { lines: [], nothingNotable: false, referenceTooThin: true };
  }

  const lines: string[] = [];

  // --- ROM vs set median --------------------------------------------------
  const roms = reps.map((r) => r.romConcentricDeg);
  const romMedian = median(roms);
  if (romMedian > 0) {
    const qualifying = reps.filter(
      (r) => (r.romConcentricDeg / romMedian) * 100 <= ROM_LINE_MAX_PCT_OF_MEDIAN
    );
    if (qualifying.length > 0) {
      const pcts = qualifying.map((r) => Math.round((r.romConcentricDeg / romMedian) * 100));
      const lo = Math.min(...pcts);
      const hi = Math.max(...pcts);
      const pctText = lo === hi ? `${lo}%` : `${lo}-${hi}%`;
      lines.push(
        `${formatRepRanges(qualifying.map((r) => r.index))} traveled ${pctText} of your set median.`
      );
    }
  }

  // --- Mean concentric velocity, first rep → last rep ---------------------
  const first = reps[0];
  const last = reps[reps.length - 1];
  if (first.meanWConcentric > 0) {
    const dropPct = Math.round(
      (1 - last.meanWConcentric / first.meanWConcentric) * 100
    );
    if (dropPct >= VELOCITY_LINE_MIN_DROP_PCT) {
      lines.push(
        `Mean concentric velocity fell ${dropPct}% from rep 1 to rep ${reps.length}.`
      );
    }
  }

  // --- Bottom-turnaround acceleration, last third vs first third ----------
  const third = Math.max(1, Math.floor(reps.length / 3));
  const accelOf = (rs: CaptureRep[]) =>
    rs.map((r) => r.turnaroundPeakAccelRadps2).filter((a): a is number => a !== null);
  const firstThird = accelOf(reps.slice(0, third));
  const lastThird = accelOf(reps.slice(reps.length - third));
  if (firstThird.length > 0 && lastThird.length > 0) {
    const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const firstMean = meanOf(firstThird);
    const ratio = firstMean > 0 ? meanOf(lastThird) / firstMean : 0;
    if (ratio >= TURNAROUND_LINE_MIN_RATIO) {
      lines.push(
        `${formatRepRanges(reps.slice(reps.length - third).map((r) => r.index))} showed ` +
          `${ratio.toFixed(1)}x the bottom-turnaround acceleration of ` +
          `${formatRepRanges(reps.slice(0, third).map((r) => r.index)).toLowerCase()}.`
      );
    }
  }

  // --- Bottom dwell, max → later min --------------------------------------
  const dwellReps = reps.filter((r) => r.bottomDwellMs !== null);
  if (dwellReps.length >= 2) {
    const maxRep = dwellReps.reduce((a, b) => ((b.bottomDwellMs ?? 0) > (a.bottomDwellMs ?? 0) ? b : a));
    const laterReps = dwellReps.filter((r) => r.index > maxRep.index);
    if (laterReps.length > 0) {
      const minRep = laterReps.reduce((a, b) =>
        (b.bottomDwellMs ?? Infinity) < (a.bottomDwellMs ?? Infinity) ? b : a
      );
      const maxMs = maxRep.bottomDwellMs ?? 0;
      const minMs = minRep.bottomDwellMs ?? 0;
      if (maxMs > 0 && minMs <= maxMs * (1 - DWELL_LINE_MIN_REDUCTION_PCT / 100)) {
        lines.push(
          `Bottom dwell dropped from ${round10(maxMs)} ms on rep ${maxRep.index + 1} to ` +
            `${round10(minMs)} ms on rep ${minRep.index + 1}.`
        );
      }
    }
  }

  return {
    lines: lines.slice(0, 4),
    nothingNotable: lines.length === 0,
    referenceTooThin: false,
  };
}
