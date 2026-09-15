/**
 * sleepTrends — chart series + stat builders behind /dashboard/sleep.
 * Everything takes an explicit `now`, so these tests pin the window edges
 * without touching the app clock.
 */

import {
  buildSleepTrendSeries,
  computeSleepTrendStats,
  SLEEP_TREND_THRESHOLD_HOURS,
} from '@/lib/sleep/sleepTrends';
import { getLocalDateString } from '@/lib/utils';
import type { SleepLogEntry } from '@/types/schema';

// Mid-month noon avoids DST/day-boundary ambiguity in local-day math.
const NOW = new Date(2026, 8, 15, 12, 0, 0);

function dayAgo(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return getLocalDateString(d);
}

function entry(daysAgo: number, hours: number, quality: SleepLogEntry['quality'] = 'ok'): SleepLogEntry {
  return { localDay: dayAgo(daysAgo), hours, quality, source: 'manual' };
}

describe('buildSleepTrendSeries', () => {
  it('emits one point per calendar day, oldest first, with gaps as nulls (never zeros)', () => {
    const series = buildSleepTrendSeries([entry(0, 7.5, 'good'), entry(2, 6)], 4, NOW);
    expect(series.map((p) => p.localDay)).toEqual([dayAgo(3), dayAgo(2), dayAgo(1), dayAgo(0)]);
    expect(series.map((p) => p.hours)).toEqual([null, 6, null, 7.5]);
    expect(series[3].quality).toBe('good');
    expect(series[1].quality).toBe('ok');
    expect(series[0].quality).toBeNull();
  });

  it('rolling average covers the trailing 7 calendar days, counting only logged nights', () => {
    // 8h logged 6 days ago and 6h last night: today's window holds both.
    const series = buildSleepTrendSeries([entry(6, 8), entry(0, 6)], 7, NOW);
    const todayPoint = series[series.length - 1];
    expect(todayPoint.rollingAvg).toBeCloseTo(7);
    // The oldest point's window only contains its own night.
    expect(series[0].rollingAvg).toBeCloseTo(8);
  });

  it('entries older than the range still feed the rolling average at the left edge', () => {
    // Range = 2 days, but a night 3 days ago is inside the first point's
    // trailing-7-day window.
    const series = buildSleepTrendSeries([entry(3, 9), entry(0, 6)], 2, NOW);
    expect(series[0].hours).toBeNull();
    expect(series[0].rollingAvg).toBeCloseTo(9);
    expect(series[1].rollingAvg).toBeCloseTo(7.5);
  });

  it('rolling average is null when no nights fall in the window', () => {
    const series = buildSleepTrendSeries([], 3, NOW);
    expect(series.every((p) => p.rollingAvg === null && p.hours === null)).toBe(true);
  });
});

describe('computeSleepTrendStats', () => {
  it('computes 7- and 30-day averages over logged nights only', () => {
    const stats = computeSleepTrendStats([entry(0, 6), entry(3, 8), entry(20, 4)], NOW);
    expect(stats.avg7).toBeCloseTo(7); // (6+8)/2 — the day-20 night is outside
    expect(stats.avg30).toBeCloseTo(6); // (6+8+4)/3
    expect(stats.nightsLogged30).toBe(3);
  });

  it('week-over-week delta requires 3+ logged nights in BOTH weeks', () => {
    // This week: 3 nights. Prior week: only 2 → no trend claimed.
    const sparse = computeSleepTrendStats(
      [entry(0, 7), entry(1, 7), entry(2, 7), entry(8, 6), entry(9, 6)],
      NOW
    );
    expect(sparse.deltaPerWeek).toBeNull();
    expect(sparse.direction).toBeNull();

    const dense = computeSleepTrendStats(
      [
        entry(0, 7.5), entry(1, 7.5), entry(2, 7.5),
        entry(7, 6.5), entry(8, 6.5), entry(9, 6.5),
      ],
      NOW
    );
    expect(dense.deltaPerWeek).toBeCloseTo(1);
    expect(dense.direction).toBe('up');
  });

  it('applies the ±15-minute dead zone before calling a direction', () => {
    const nights = (thisWeek: number, lastWeek: number): SleepLogEntry[] => [
      entry(0, thisWeek), entry(1, thisWeek), entry(2, thisWeek),
      entry(7, lastWeek), entry(8, lastWeek), entry(9, lastWeek),
    ];
    expect(computeSleepTrendStats(nights(7.2, 7), NOW).direction).toBe('steady');
    expect(
      computeSleepTrendStats(nights(7 - SLEEP_TREND_THRESHOLD_HOURS - 0.1, 7), NOW).direction
    ).toBe('down');
  });

  it('counts quality over the trailing 30 days', () => {
    const stats = computeSleepTrendStats(
      [entry(0, 7, 'good'), entry(1, 6, 'poor'), entry(2, 7, 'good'), entry(40, 5, 'poor')],
      NOW
    );
    expect(stats.qualityCounts30).toEqual({ poor: 1, ok: 0, good: 2 });
  });

  it('returns nulls with no data', () => {
    const stats = computeSleepTrendStats([], NOW);
    expect(stats.avg7).toBeNull();
    expect(stats.avg30).toBeNull();
    expect(stats.deltaPerWeek).toBeNull();
    expect(stats.direction).toBeNull();
    expect(stats.nightsLogged30).toBe(0);
  });
});
