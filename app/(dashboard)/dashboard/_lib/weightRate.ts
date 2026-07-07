/**
 * Weekly weight-change rate vs the goal-implied target rate — shared by the
 * home "Weight" glance tile and the nutrition page's Weight tab so the rate
 * the user taps on the dashboard is the rate they land on. Pure: no React,
 * no Supabase client.
 */

import { getDisplayWeight } from '@/lib/weightUtils';

export interface WeightHistoryEntry {
  /** YYYY-MM-DD (or ISO) log date. */
  date: string;
  weight: number;
  unit: string;
}

export interface WeightRateSummary {
  /** Observed lb-or-kg per week (regression over recent entries). */
  perWeek: number;
  /** Goal-implied target rate; null when the goal has no rate (maintenance). */
  target: number | null;
}

export type WeightGoal = 'bulk' | 'cut' | 'recomp' | 'maintain' | 'maintenance';

/** Goal-implied weekly rate in the display unit (null = no target rate). */
export function goalTargetRate(goal: WeightGoal, displayUnit: 'lb' | 'kg'): number | null {
  if (goal === 'bulk') return displayUnit === 'lb' ? 0.5 : 0.25;
  if (goal === 'cut') return displayUnit === 'lb' ? -1.0 : -0.45;
  return null;
}

/**
 * Weekly weight-change rate (linear regression over the last ~3 weeks of
 * entries, falling back to the last two entries when the window is sparse)
 * vs the goal-implied target rate, in the preferred display unit.
 */
export function computeWeightRate(
  weightHistory: WeightHistoryEntry[],
  displayUnit: 'lb' | 'kg',
  goal: WeightGoal
): WeightRateSummary | null {
  if (weightHistory.length < 2) return null;
  const sorted = [...weightHistory].sort((a, b) => a.date.localeCompare(b.date));
  const latestTs = Date.parse(sorted[sorted.length - 1].date);
  const windowStart = latestTs - 21 * 24 * 60 * 60 * 1000;
  let windowEntries = sorted.filter((w) => Date.parse(w.date) >= windowStart);
  if (windowEntries.length < 2) windowEntries = sorted.slice(-2);

  const points = windowEntries.map((w) => ({
    x: Date.parse(w.date) / (24 * 60 * 60 * 1000),
    y: getDisplayWeight(w.weight, w.unit as 'lb' | 'kg' | null, displayUnit),
  }));
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumX2 = points.reduce((a, p) => a + p.x * p.x, 0);
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return null;
  const slopePerDay = (n * sumXY - sumX * sumY) / denominator;
  const perWeek = Math.round(slopePerDay * 7 * 10) / 10;

  return { perWeek, target: goalTargetRate(goal, displayUnit) };
}
