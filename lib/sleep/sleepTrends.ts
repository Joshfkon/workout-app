// ============================================================
// SLEEP TRENDS — pure series/stat builders for the /dashboard/sleep
// detail page (graph + averages + trend).
//
// No DB access here: callers pass the trailing entries (from
// useSleepHistory / fetchRecentSleep) and everything is derived. "Now"
// follows the app clock convention — a default parameter, never a read
// mid-calculation — so simulated time moves every window with it.
// ============================================================

import { now as clockNow } from '@/lib/clock';
import { getLocalDateString } from '@/lib/utils';
import type { SleepLogEntry, SleepQuality } from '@/types/schema';

/** One chart row per CALENDAR day — unlogged nights stay as gaps (null),
 *  never fabricated zeros. */
export interface SleepTrendPoint {
  /** YYYY-MM-DD local day. */
  localDay: string;
  /** Hours slept, or null when the night wasn't logged. */
  hours: number | null;
  /** Logged quality, or null when the night wasn't logged. */
  quality: SleepQuality | null;
  /**
   * Mean hours over the logged nights in the trailing 7 CALENDAR days ending
   * on this day (null when none of them were logged). This is the smoothed
   * trend line; it deliberately averages only what was logged rather than
   * treating missing nights as zero-hour nights.
   */
  rollingAvg: number | null;
}

/** Local-day string `daysBack` days before `now`. */
function localDayAgo(now: Date, daysBack: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - daysBack);
  return getLocalDateString(d);
}

/**
 * Build the chart series for the trailing `days` calendar days (oldest →
 * newest, today last). Entries outside the range still contribute to the
 * rolling average at the range's left edge, so the line doesn't dip
 * artificially on the first week of the window.
 */
export function buildSleepTrendSeries(
  entries: SleepLogEntry[],
  days: number,
  now: Date = clockNow()
): SleepTrendPoint[] {
  const byDay = new Map<string, SleepLogEntry>();
  for (const e of entries) byDay.set(e.localDay, e);

  const series: SleepTrendPoint[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const day = localDayAgo(now, back);
    const entry = byDay.get(day) ?? null;

    let sum = 0;
    let count = 0;
    for (let w = 0; w < 7; w++) {
      const windowEntry = byDay.get(localDayAgo(now, back + w));
      if (windowEntry) {
        sum += windowEntry.hours;
        count++;
      }
    }

    series.push({
      localDay: day,
      hours: entry ? entry.hours : null,
      quality: entry ? entry.quality : null,
      rollingAvg: count > 0 ? sum / count : null,
    });
  }
  return series;
}

/** Direction of the week-over-week trend (see `deltaPerWeek`). */
export type SleepTrendDirection = 'up' | 'down' | 'steady';

/** Dead zone for the trend verdict: ±15 min/night is noise, not a trend. */
export const SLEEP_TREND_THRESHOLD_HOURS = 0.25;

/** Minimum logged nights PER WEEK before a week-over-week delta is honest. */
const MIN_NIGHTS_FOR_TREND = 3;

export interface SleepTrendStats {
  /** Mean hours over the trailing 7 local days (null with no logged nights). */
  avg7: number | null;
  /** Mean hours over the trailing 30 local days (null with no logged nights). */
  avg30: number | null;
  /** Logged nights in the trailing 30 days (of 30). */
  nightsLogged30: number;
  /**
   * avg(hours, last 7 days) − avg(hours, days 8–14): positive = sleeping
   * more this week. Null unless BOTH weeks have ≥3 logged nights — one night
   * against one night is not a trend.
   */
  deltaPerWeek: number | null;
  /** Verdict on `deltaPerWeek` with a ±15 min dead zone; null when no delta. */
  direction: SleepTrendDirection | null;
  /** Quality distribution over the trailing 30 days' logged nights. */
  qualityCounts30: Record<SleepQuality, number>;
}

/** Averages + week-over-week trend for the detail page's stat tiles. */
export function computeSleepTrendStats(
  entries: SleepLogEntry[],
  now: Date = clockNow()
): SleepTrendStats {
  const today = getLocalDateString(now);
  const cutoff7 = localDayAgo(now, 6);
  const cutoff14 = localDayAgo(now, 13);
  const cutoff30 = localDayAgo(now, 29);

  const inWindow = (e: SleepLogEntry, from: string, to: string) =>
    e.localDay >= from && e.localDay <= to;

  const week = entries.filter((e) => inWindow(e, cutoff7, today));
  const priorWeek = entries.filter((e) => e.localDay >= cutoff14 && e.localDay < cutoff7);
  const month = entries.filter((e) => inWindow(e, cutoff30, today));

  const mean = (list: SleepLogEntry[]) =>
    list.length > 0 ? list.reduce((s, e) => s + e.hours, 0) / list.length : null;

  const avg7 = mean(week);
  const avg30 = mean(month);
  const priorAvg = mean(priorWeek);

  const deltaPerWeek =
    week.length >= MIN_NIGHTS_FOR_TREND &&
    priorWeek.length >= MIN_NIGHTS_FOR_TREND &&
    avg7 !== null &&
    priorAvg !== null
      ? avg7 - priorAvg
      : null;

  const direction: SleepTrendDirection | null =
    deltaPerWeek === null
      ? null
      : deltaPerWeek > SLEEP_TREND_THRESHOLD_HOURS
        ? 'up'
        : deltaPerWeek < -SLEEP_TREND_THRESHOLD_HOURS
          ? 'down'
          : 'steady';

  const qualityCounts30: Record<SleepQuality, number> = { poor: 0, ok: 0, good: 0 };
  for (const e of month) qualityCounts30[e.quality]++;

  return {
    avg7,
    avg30,
    nightsLogged30: month.length,
    deltaPerWeek,
    direction,
    qualityCounts30,
  };
}
