/**
 * Weekly weight-change rate vs the goal-implied target rate — shared by the
 * home "Weight" glance tile and the nutrition page's Weight tab so the rate
 * the user taps on the dashboard is the rate they land on. Pure: no React,
 * no Supabase client.
 */

import { getDisplayWeight } from '@/lib/weightUtils';
import { computeTrend } from '@/services/shared/trend';

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
 * Weekly weight-change rate (robust regression — services/shared/trend —
 * over the last `windowDays` of entries, ~3 weeks by default, falling back
 * to the last two entries when the window is sparse) vs the goal-implied
 * target rate, in the preferred display unit. A single fat-fingered weigh-in
 * cannot dominate the rate.
 */
export function computeWeightRate(
  weightHistory: WeightHistoryEntry[],
  displayUnit: 'lb' | 'kg',
  goal: WeightGoal,
  windowDays: number = 21
): WeightRateSummary | null {
  if (weightHistory.length < 2) return null;
  const sorted = [...weightHistory].sort((a, b) => a.date.localeCompare(b.date));
  const latestTs = Date.parse(sorted[sorted.length - 1].date);
  const windowStart = latestTs - windowDays * 24 * 60 * 60 * 1000;
  let windowEntries = sorted.filter((w) => Date.parse(w.date) >= windowStart);
  if (windowEntries.length < 2) windowEntries = sorted.slice(-2);

  const result = computeTrend(
    windowEntries.map((w) => ({
      date: w.date,
      value: getDisplayWeight(w.weight, w.unit as 'lb' | 'kg' | null, displayUnit),
    })),
    {
      minPoints: 2,
      // Bodyweight legitimately steps on diet-phase changes; within a ~3-week
      // tile window a persistent shift IS the signal, not a data boundary.
      detectDiscontinuity: false,
      // The tile renders whatever the window supports — short spans already
      // fall back to two entries; span gating is the nutrition page's job.
      lowConfidenceSpanDays: 0,
      lowConfidenceGapDays: Number.POSITIVE_INFINITY,
      label: 'weightRate',
    }
  );
  if (result.confidence === 'insufficient' || result.nPoints < 2) return null;
  const perWeek = Math.round(result.slopePerWeek * 10) / 10;

  return { perWeek, target: goalTargetRate(goal, displayUnit) };
}
