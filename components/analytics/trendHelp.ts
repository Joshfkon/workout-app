/**
 * Plain-words help for the Progress trends (pure — no React, no I/O).
 *
 * UX panel r19: "trend line" and "straight line fitted" read as jargon to a
 * beginner, nobody could tell what makes a lift "flat", and the method text
 * was repeated under every chart. These strings say what the code actually
 * does — the thresholds are imported from the code that applies them, never
 * restated — and the page shows them once, behind an info toggle.
 */

import { FLAT_BAND_PCT } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { STEADY_WEIGHT_PER_WEEK } from './weightTrend';

/** A lift's weekly change, as the user would see it on a typical lift. */
const EXAMPLE_LIFT: Record<'lb' | 'kg', number> = { lb: 200, kg: 100 };

function trimNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * How a lift gets "Rising" / "Flat" / "Down" (liftTrends FLAT_BAND_PCT), with
 * the band turned into weight on a round example lift so "0.15%" means
 * something.
 */
export function liftStatusRule(units: 'lb' | 'kg'): string {
  const pct = trimNumber(FLAT_BAND_PCT);
  const example = EXAMPLE_LIFT[units];
  const perWeek = trimNumber((example * FLAT_BAND_PCT) / 100);
  return (
    `A lift is rising when its estimated max goes up more than ${pct}% a week, down when it drops more than ${pct}% a week, ` +
    `and flat in between (on a ${example} ${units} lift, that's less than ${perWeek} ${units} a week either way).`
  );
}

/** What the "% per week" on a lift row is. */
export function liftRateRule(weeks: number): string {
  return (
    `Change per week is how fast a lift's estimated max is moving: the average weekly change across the best set of every workout ` +
    `in the last ${weeks} weeks, as a share of today's estimated max.`
  );
}

/**
 * How the weight trend is worked out (weightTrend.weightTrendLine: a
 * least-squares line through every weigh-in in the range) and when it reads
 * as steady (STEADY_WEIGHT_PER_WEEK, in the display unit).
 */
export function weightTrendRule(units: 'lb' | 'kg', weighIns: number, days: number): string {
  const count = `${weighIns} weigh-in${weighIns === 1 ? '' : 's'}`;
  return (
    `Your weight trend uses all ${count} from the last ${days} days, not just the first and the last, ` +
    `so one heavy or light day barely moves it. Less than ${trimNumber(STEADY_WEIGHT_PER_WEEK)} ${units} a week either way counts as steady.`
  );
}

/** Goals / phases on which holding strength is the win. */
export function isCutGoal(goal: string | null | undefined): boolean {
  return goal === 'cut';
}

/** Shown with the strength verdict on a cut (UX panel: what counts as good on a cut?). */
export const CUT_STRENGTH_NOTE =
  "You're on a cut, so lifts holding steady is a good result: you're keeping your strength while you lose fat.";
