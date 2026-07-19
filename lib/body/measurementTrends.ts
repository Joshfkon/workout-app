/**
 * Per-site tape measurement trends for the Body hub "Measurement Trends"
 * list — the measurement analog of the Strength tab's liftTrends module
 * (same visual language: direction badge + rate + sparkline). Pure: callers
 * pass the queried body_measurements rows in; no React, no Supabase.
 */

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
  /** Null while the site has fewer than MIN_POINTS_FOR_TREND entries. */
  direction: MeasurementDirection | null;
  /** Fitted change per 30 days, cm (least-squares slope). 0 when unclassified. */
  monthlyChangeCm: number;
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
 * Weekly change (% of current value) within ±this band counts as flat. Tape
 * sites move far slower than E1RM, so the band is tighter than liftTrends'.
 */
const FLAT_BAND_PCT_PER_WEEK = 0.05;

/** Sites where a DECREASE is the improvement (mirrors the compare grid). */
const SHRINK_IS_GOOD = new Set(['waist']);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Least-squares slope of valueCm over days. Returns cm/day. */
function slopeCmPerDay(points: MeasurementTrendPoint[]): number {
  const t0 = new Date(`${points[0].date}T00:00:00`).getTime();
  const xs = points.map((p) => (new Date(`${p.date}T00:00:00`).getTime() - t0) / MS_PER_DAY);
  const ys = points.map((p) => p.valueCm);
  const n = points.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - meanX) * (ys[i] - meanY);
    varX += (xs[i] - meanX) ** 2;
  }
  return varX === 0 ? 0 : cov / varX;
}

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

    if (history.length < MIN_POINTS_FOR_TREND) {
      sites.push({
        site: field.key,
        label: field.label,
        direction: null,
        monthlyChangeCm: 0,
        currentCm,
        pointCount: history.length,
        history,
        improving: null,
      });
      continue;
    }

    const slope = slopeCmPerDay(history);
    const weeklyPct = currentCm > 0 ? ((slope * 7) / currentCm) * 100 : 0;
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
      monthlyChangeCm: Math.round(slope * 30 * 100) / 100,
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
