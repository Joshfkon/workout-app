/**
 * Which range the Weight & trends chart opens on.
 *
 * Panel finding (r21, Priya): "The default 30-day chart showed almost
 * nothing, so I had to switch to 90 days to see a trend." The chart always
 * opened on 30 days. Now it opens on the SHORTEST of 30 / 90 days that holds
 * enough weigh-ins to draw a line worth reading, and when even 90 days
 * doesn't, the page says so plainly with how many more are needed.
 *
 * Pure: dates are YYYY-MM-DD local days; `today` comes from the caller.
 */

export const WEIGHT_CHART_RANGE_DAYS = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
} as const;
export type WeightChartRange = keyof typeof WEIGHT_CHART_RANGE_DAYS;

/** Ranges the chart may open on, shortest first. */
const DEFAULT_CANDIDATES: readonly WeightChartRange[] = ['30d', '90d'];

/** Weigh-ins (on different days) a range needs before its line reads as a trend. */
export const MIN_WEIGHT_CHART_POINTS = 4;

export interface WeightChartDefault {
  range: WeightChartRange;
  /** Distinct weigh-in days inside `range`. */
  points: number;
  /** True when `range` holds at least MIN_WEIGHT_CHART_POINTS. */
  enough: boolean;
  /** More weigh-in days needed for a trend (0 when enough). */
  needed: number;
}

function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.UTC(+fromDay.slice(0, 4), +fromDay.slice(5, 7) - 1, +fromDay.slice(8, 10));
  const b = Date.UTC(+toDay.slice(0, 4), +toDay.slice(5, 7) - 1, +toDay.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Distinct weigh-in days within the last `days` days up to `today`. */
export function weighInDaysInRange(loggedDays: string[], today: string, days: number): number {
  const inRange = new Set<string>();
  for (const raw of loggedDays) {
    const day = raw.slice(0, 10);
    const ago = daysBetween(day, today);
    if (ago >= 0 && ago <= days) inRange.add(day);
  }
  return inRange.size;
}

/**
 * The shortest of 30 / 90 days with enough weigh-ins; else 90 days (the most
 * the chart can show) with `enough: false` and how many more are needed.
 */
export function pickWeightChartRange(loggedDays: string[], today: string): WeightChartDefault {
  let last: WeightChartDefault | null = null;
  for (const range of DEFAULT_CANDIDATES) {
    const points = weighInDaysInRange(loggedDays, today, WEIGHT_CHART_RANGE_DAYS[range]);
    const needed = Math.max(0, MIN_WEIGHT_CHART_POINTS - points);
    last = { range, points, enough: needed === 0, needed };
    if (last.enough) return last;
  }
  return last!;
}

/**
 * Plain line for a chart range without enough data:
 * "Not enough weigh-ins for a trend yet: 2 in the last 90 days. Weigh in on
 * 2 more days to see one." Null when there is enough.
 */
export function notEnoughWeighInsMessage(info: WeightChartDefault): string | null {
  if (info.enough) return null;
  const days = WEIGHT_CHART_RANGE_DAYS[info.range];
  const have = `${info.points} weigh-in${info.points === 1 ? '' : 's'} in the last ${days} days`;
  return `Not enough weigh-ins for a trend yet: ${have}. Weigh in on ${info.needed} more day${
    info.needed === 1 ? '' : 's'
  } to see one.`;
}
