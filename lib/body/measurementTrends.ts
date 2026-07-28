/**
 * Per-site tape measurement trends for the Body hub "Measurement Trends"
 * list — the measurement analog of the Strength tab's liftTrends module
 * (same visual language: direction badge + rate + sparkline). Pure: callers
 * pass the queried body_measurements rows in; no React, no Supabase.
 *
 * Slopes come from the canonical robust estimator (services/shared/trend):
 * Theil–Sen over ELAPSED DAYS, impossible values (≤ 0 cm) hard-rejected,
 * single-entry tape errors MAD-excluded and SURFACED via excludedDates so
 * the chart can mark them instead of silently dropping data.
 *
 * Honesty rule for rates (see the trend-robustness task, 6b): a per-month
 * figure is only rendered when the observed span actually supports it
 * (confidence 'high'). A 17-day span with 3 entries reports the raw delta
 * ("+0.9 in over 17 days"), never an extrapolated "+1.5 in/mo".
 */

import { computeTrend } from '@/services/shared/trend';

export type MeasurementDirection = 'rising' | 'flat' | 'down';

export interface MeasurementTrendPoint {
  /** Local entry date, YYYY-MM-DD. */
  date: string;
  valueCm: number;
}

export interface MeasurementSiteField {
  key: string;
  label: string;
}

export interface MeasurementSiteTrend {
  site: string;
  label: string;
  /** Null while the site has fewer than MIN_POINTS_FOR_TREND usable entries. */
  direction: MeasurementDirection | null;
  /** Fitted change per 30 days, cm (robust Theil–Sen slope). 0 when unclassified. */
  monthlyChangeCm: number;
  /**
   * Whether monthlyChangeCm may be RENDERED as a rate. False when the
   * observed span is too short for the per-month unit (or the series is
   * gappy) — callers show observedDeltaCm over spanDays instead.
   */
  rateIsReliable: boolean;
  /** First-to-last observed change across the fitted entries, cm. */
  observedDeltaCm: number;
  /** Days between the first and last fitted entries. */
  spanDays: number;
  /** Entry dates rejected as outliers (e.g. a −1.6" single-week tape error). */
  excludedDates: string[];
  /** Latest entry in the window, cm. */
  currentCm: number;
  pointCount: number;
  /** Entries in the window, oldest first (sparkline/detail source). */
  history: MeasurementTrendPoint[];
  /**
   * Whether the fitted direction is good for this site — waist shrinking is
   * an improvement, every other site growing is. Null when flat/unclassified.
   */
  improving: boolean | null;
}

export interface MeasurementTrendsSummary {
  /** Sites with data in the window, ordered rising → flat → down → building. */
  sites: MeasurementSiteTrend[];
  /** Classified-site counts (the headline line). */
  rising: number;
  flat: number;
  down: number;
  /** Sites with data but fewer than MIN_POINTS_FOR_TREND entries in range. */
  building: number;
}

/** Entries required before a site's trend is classified. */
export const MIN_POINTS_FOR_TREND = 3;

/**
 * Observed span (days) below which a per-MONTH rate is not rendered — a
 * 17-day span reported as in/mo is a 1.8× extrapolation dressed up as a
 * measurement. The direction badge still shows; the rate becomes the raw
 * observed delta.
 */
export const MIN_SPAN_DAYS_FOR_MONTHLY_RATE = 21;

/**
 * Gap (days) between consecutive tape entries beyond which the series —
 * and any chart segment across it — is low-confidence (dashed rendering,
 * no rate). Same convention as the Body Composition chart's dashed spans.
 */
export const MEASUREMENT_LOW_CONFIDENCE_GAP_DAYS = 45;

/**
 * Weekly change (% of current value) within ±this band counts as flat. Tape
 * sites move far slower than E1RM, so the band is tighter than liftTrends'.
 */
const FLAT_BAND_PCT_PER_WEEK = 0.05;

/** Sites where a DECREASE is the improvement (mirrors the compare grid). */
const SHRINK_IS_GOOD = new Set(['waist']);

/**
 * Classify each measured site's trend over the rows at/after `cutoff`
 * (YYYY-MM-DD; null/undefined = full history). Rows may be sparse — sites a
 * row doesn't include are simply absent from that day's series.
 */
export function computeMeasurementTrends<T extends { logged_at: string }>(
  rows: T[],
  fields: MeasurementSiteField[],
  cutoff?: string | null
): MeasurementTrendsSummary {
  const sorted = [...rows].sort((a, b) => a.logged_at.localeCompare(b.logged_at));

  const sites: MeasurementSiteTrend[] = [];
  for (const field of fields) {
    const history: MeasurementTrendPoint[] = [];
    for (const row of sorted) {
      if (cutoff != null && row.logged_at < cutoff) continue;
      const value = (row as Record<string, unknown>)[field.key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        history.push({ date: row.logged_at, valueCm: value });
      }
    }
    if (history.length === 0) continue;

    const currentCm = history[history.length - 1].valueCm;

    const trend = computeTrend(
      history.map((p) => ({ date: p.date, value: p.valueCm })),
      {
        minPoints: MIN_POINTS_FOR_TREND,
        lowConfidenceSpanDays: MIN_SPAN_DAYS_FOR_MONTHLY_RATE,
        lowConfidenceGapDays: MEASUREMENT_LOW_CONFIDENCE_GAP_DAYS,
        // Tape sites don't level-shift the way equipment-bound e1RM does;
        // a sudden persistent change IS the signal (or a re-measurement
        // convention the outlier pass judges point by point).
        detectDiscontinuity: false,
        label: `measurement:${field.key}`,
      }
    );

    const excludedDates = trend.excludedIndices.map((i) => history[i].date);

    if (trend.confidence === 'insufficient') {
      sites.push({
        site: field.key,
        label: field.label,
        direction: null,
        monthlyChangeCm: 0,
        rateIsReliable: false,
        observedDeltaCm: Math.round(trend.observedDelta * 100) / 100,
        spanDays: Math.round(trend.spanDays),
        excludedDates,
        currentCm,
        pointCount: history.length,
        history,
        improving: null,
      });
      continue;
    }

    const weeklyPct = currentCm > 0 ? ((trend.slopePerDay * 7) / currentCm) * 100 : 0;
    const direction: MeasurementDirection =
      weeklyPct > FLAT_BAND_PCT_PER_WEEK
        ? 'rising'
        : weeklyPct < -FLAT_BAND_PCT_PER_WEEK
        ? 'down'
        : 'flat';
    const improving =
      direction === 'flat' ? null : (direction === 'down') === SHRINK_IS_GOOD.has(field.key);

    sites.push({
      site: field.key,
      label: field.label,
      direction,
      monthlyChangeCm: Math.round(trend.slopePerMonth * 100) / 100,
      rateIsReliable: trend.confidence === 'high',
      observedDeltaCm: Math.round(trend.observedDelta * 100) / 100,
      spanDays: Math.round(trend.spanDays),
      excludedDates,
      currentCm,
      pointCount: history.length,
      history,
      improving,
    });
  }

  const order = (s: MeasurementSiteTrend) =>
    s.direction === 'rising' ? 0 : s.direction === 'flat' ? 1 : s.direction === 'down' ? 2 : 3;
  sites.sort(
    (a, b) => order(a) - order(b) || Math.abs(b.monthlyChangeCm) - Math.abs(a.monthlyChangeCm)
  );

  return {
    sites,
    rising: sites.filter((s) => s.direction === 'rising').length,
    flat: sites.filter((s) => s.direction === 'flat').length,
    down: sites.filter((s) => s.direction === 'down').length,
    building: sites.filter((s) => s.direction === null).length,
  };
}
