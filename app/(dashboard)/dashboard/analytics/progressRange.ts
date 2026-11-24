/**
 * The ONE time range for the Progress page (pure — no I/O, no React).
 *
 * UX panel r21: weight was shown over 30 days and strength over 12 weeks,
 * with a separate range picker on the weight chart and another on Wellness,
 * so "am I progressing?" compared two different windows. Every trend on the
 * page — the summary card, the weight chart, the lift trends, the muscle
 * rollup, plateau alerts and Wellness — now reads this one range.
 */

import { LIFT_TREND_WINDOW_DAYS } from '@/app/(dashboard)/dashboard/_lib/liftTrends';

export type ProgressRangeId = '4w' | '12w' | '6m' | '1y';

export interface ProgressRange {
  id: ProgressRangeId;
  days: number;
  /** Button label. */
  short: string;
  /** In a sentence: "over the last {words}". */
  words: string;
}

export const PROGRESS_RANGES: readonly ProgressRange[] = [
  { id: '4w', days: 28, short: '4 wk', words: '4 weeks' },
  // The default is the lift-trend window, so Progress and Home's lift tile
  // agree until the user picks another range.
  { id: '12w', days: LIFT_TREND_WINDOW_DAYS, short: '12 wk', words: '12 weeks' },
  { id: '6m', days: 182, short: '6 mo', words: '6 months' },
  { id: '1y', days: 365, short: '1 yr', words: 'year' },
];

export const DEFAULT_PROGRESS_RANGE: ProgressRangeId = '12w';

export function progressRange(id: ProgressRangeId): ProgressRange {
  return PROGRESS_RANGES.find((r) => r.id === id) ?? PROGRESS_RANGES[1];
}

/** "over the last 12 weeks" / "over the last year". */
export function rangePhrase(days: number): string {
  const match = PROGRESS_RANGES.find((r) => r.days === days);
  if (match) return `over the last ${match.words}`;
  if (days % 7 === 0) return `over the last ${days / 7} weeks`;
  return `over the last ${days} days`;
}

/**
 * Start of the range as an instant: local midnight (days - 1) days ago, so
 * a range covers whole local calendar days including today (same rule as
 * services/volumeTrendsData rangeStartLocalDay — never a rolling UTC window).
 */
export function progressRangeStart(days: number, now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}
