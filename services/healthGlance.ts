/**
 * healthGlance — the latest HRV / resting-HR reading for the Home health card,
 * compared with the user's own baseline (pure).
 *
 * The baseline is the recovery engine's (services/wearableRecovery
 * .rollingBaseline: 14-day median, excluding the reading's own day), so the
 * card and the recovery adjustment never disagree about "your normal".
 */

import { rollingBaseline, type WellnessDay } from './wearableRecovery';

export interface WellnessReading {
  value: number;
  /** Local day of the reading, YYYY-MM-DD. */
  date: string;
  /** 14-day median before that day, or null with too little history. */
  baseline: number | null;
  /** Rounded percent vs baseline (+ above, - below), or null without one. */
  deltaPct: number | null;
}

/** The newest day with a value for `metric`, against its baseline. */
export function latestWellnessReading(
  history: WellnessDay[],
  metric: 'hrvSdnnMs' | 'restingHrBpm'
): WellnessReading | null {
  const latest = [...history]
    .filter((d) => {
      const v = d[metric];
      return v != null && Number.isFinite(v) && v > 0;
    })
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!latest) return null;
  const value = latest[metric] as number;
  const baseline = rollingBaseline(history, latest.date, metric);
  return {
    value,
    date: latest.date,
    baseline,
    deltaPct: baseline ? Math.round(((value - baseline) / baseline) * 100) : null,
  };
}
