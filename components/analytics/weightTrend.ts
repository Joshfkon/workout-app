/**
 * The weight chart's window + fitted trend line, pure (no React, no I/O), so
 * the Body tab's weight chart (WeightGraph) and the Progress summary line
 * read the SAME numbers: same window cut, same unit conversion, same
 * least-squares fit.
 */

import { parseLocalDate } from '@/lib/utils';
import { getDisplayWeight } from '@/lib/weightUtils';

export const DAY_MS = 1000 * 60 * 60 * 24;

export interface WeighInEntry {
  /** Local day (YYYY-MM-DD) or a timestamp parseLocalDate accepts. */
  date: string;
  weight: number;
  unit: string;
}

export interface WindowWeightPoint {
  date: string;
  /** In the display unit, one decimal. */
  weight: number;
}

/** A weekly change within ±this (display units/wk) reads as steady. */
export const STEADY_WEIGHT_PER_WEEK = 0.05;

/**
 * Weigh-ins from the last `days` whole local days (a weigh-in exactly N days
 * ago is inside an N-day window whatever the time of day), oldest first,
 * converted to the display unit and rounded to one decimal.
 */
export function weighInsInWindow(
  weightHistory: readonly WeighInEntry[],
  preferredUnit: 'lb' | 'kg',
  days: number,
  now: Date
): WindowWeightPoint[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);
  return weightHistory
    .filter((entry) => parseLocalDate(entry.date) >= cutoff)
    .sort((a, b) => parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime())
    .map((entry) => ({
      date: entry.date,
      weight: Number(
        getDisplayWeight(entry.weight, entry.unit as 'lb' | 'kg' | null, preferredUnit).toFixed(1)
      ),
    }));
}

/** Least-squares slope (per day) and intercept over day offsets from the first point. */
export function fitWeightLine(
  data: readonly WindowWeightPoint[]
): { slopePerDay: number; intercept: number; lastX: number } | null {
  if (data.length < 2) return null;
  const t0 = parseLocalDate(data[0].date).getTime();
  const points = data.map((d) => ({ x: (parseLocalDate(d.date).getTime() - t0) / DAY_MS, y: d.weight }));
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  const denom = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  if (denom === 0) return null;
  const slopePerDay = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0) / denom;
  return { slopePerDay, intercept: meanY - slopePerDay * meanX, lastX: points[n - 1].x };
}

export interface WeightTrendLine {
  perWeek: number;
  isPositive: boolean;
  isNegative: boolean;
  /** Fitted weight at the first and last weigh-in (display units). */
  fitStart: number;
  fitEnd: number;
}

/** The fitted trend the chart draws (dashed) and its change line reads. */
export function weightTrendLine(data: readonly WindowWeightPoint[]): WeightTrendLine | null {
  const fit = fitWeightLine(data);
  if (!fit) return null;
  const perWeek = fit.slopePerDay * 7;
  return {
    perWeek,
    isPositive: perWeek > STEADY_WEIGHT_PER_WEEK,
    isNegative: perWeek < -STEADY_WEIGHT_PER_WEEK,
    fitStart: fit.intercept,
    fitEnd: fit.intercept + fit.slopePerDay * fit.lastX,
  };
}

/**
 * How the trend is worked out, in plain words — exactly what
 * {@link weightTrendLine} does: one straight line fitted (least squares)
 * through every weigh-in in the range. Not a moving average, and no
 * weigh-in is dropped.
 */
export function weightTrendMethod(weighIns: number, days: number): string {
  const count = `${weighIns} weigh-in${weighIns === 1 ? '' : 's'}`;
  return `The trend is a straight line fitted through all ${count} from the last ${days} days (not a 7-day average), so one heavy or light day barely moves it.`;
}
