'use client';

/**
 * Per-site tape measurement trends (Body hub). A Lift-Trends-style list —
 * one row per measured site with a direction badge, current value, fitted
 * monthly rate, and sparkline — plus a detail line chart for the selected
 * row. The detail chart overlays a rolling trend line (the same time-aware
 * EWMA the body-weight/waist analytics use) once the site has enough entries,
 * so the signal reads through day-to-day tape noise. Site list identical to
 * the entry form / ratio analytics (MEASUREMENT_FIELDS). Self-fetching;
 * refetches when refreshKey bumps (after the unified log sheet or the
 * measurements grid saves).
 *
 * The detail view also hosts the per-entry editor (SiteEntriesEditor) — the
 * fix path for a mislogged value (e.g. a calf logged as a thigh): each
 * historical entry for the selected site can be corrected inline or deleted.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { findLowConfidenceGaps } from '@/services/bodyCompAnchor';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import {
  MEASUREMENT_FIELDS,
  type Measurements,
} from '@/components/dashboard/BodyMeasurements';
import {
  computeMeasurementTrends,
  MEASUREMENT_LOW_CONFIDENCE_GAP_DAYS,
  MIN_POINTS_FOR_TREND,
  type MeasurementSiteTrend,
} from '@/lib/body/measurementTrends';
import { cmToIn, getLocalDateString } from '@/lib/utils';
import { computeEwmaTrend } from '@/services/waistTrend';
import { SiteEntriesEditor } from '@/components/body/SiteEntriesEditor';

interface MeasurementTrendCardProps {
  /** Tape unit follows the app-wide weight unit (lb → in, kg → cm). */
  tapeUnit: 'in' | 'cm';
  refreshKey?: number;
  /** Called after an entry is edited/deleted so sibling widgets refetch. */
  onDataChanged?: () => void;
}

type MeasurementRow = Measurements & { logged_at: string };

// Selectable chart windows. `days: null` = no cutoff (full history).
const DATE_RANGES = [
  { key: '1m', label: '1M', subtitle: 'last month', days: 30 },
  { key: '3m', label: '3M', subtitle: 'last 3 months', days: 91 },
  { key: '6m', label: '6M', subtitle: 'last 6 months', days: 182 },
  { key: '1y', label: '1Y', subtitle: 'last 12 months', days: 365 },
  { key: 'all', label: 'All', subtitle: 'all time', days: null },
] as const;
type DateRangeKey = (typeof DATE_RANGES)[number]['key'];

/** Tiny per-site trend line (same visual language as the Lift Trends list). */
function SiteSparkline({ trend }: { trend: MeasurementSiteTrend }) {
  const points = trend.history.map((p) => p.valueCm);
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const polyline = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 26 - ((v - min) / range) * 20 - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const colorClass =
    trend.improving == null
      ? 'text-surface-500'
      : trend.improving
      ? 'text-success-400'
      : 'text-danger-400';
  return (
    <svg
      viewBox="0 0 100 26"
      className={`w-24 h-6 flex-shrink-0 ${colorClass}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={polyline}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const DIRECTION_LABEL: Record<'rising' | 'flat' | 'down', string> = {
  rising: 'Rising',
  flat: 'Flat',
  down: 'Down',
};

export function MeasurementTrendCard({
  tapeUnit,
  refreshKey = 0,
  onDataChanged,
}: MeasurementTrendCardProps) {
  const [rows, setRows] = useState<MeasurementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [site, setSite] = useState<keyof Measurements | ''>('');
  const [range, setRange] = useState<DateRangeKey>('1y');
  // Bumped after this card's own entry edits/deletes so the history refetches;
  // refreshKey stays the parent's signal.
  const [localRefreshKey, setLocalRefreshKey] = useState(0);

  useEffect(() => {
    async function fetchAll() {
      try {
        const supabase = createUntypedClient();
        const userId = await getLocalUserId(supabase);
        if (!userId) return;
        // Full history — the range selector filters client-side so "All"
        // and shorter windows never need a refetch.
        const { data } = await supabase
          .from('body_measurements')
          .select('*')
          .eq('user_id', userId)
          .order('logged_at', { ascending: true });
        setRows((data ?? []) as MeasurementRow[]);
      } catch (err) {
        console.error('Failed to load measurement history:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchAll();
  }, [refreshKey, localRefreshKey]);

  // Local-timezone YYYY-MM-DD cutoff for the selected range (string compare
  // works because logged_at is a YYYY-MM-DD date column).
  const rangeCutoff = useMemo(() => {
    const days = DATE_RANGES.find((r) => r.key === range)?.days ?? null;
    if (days == null) return null;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return getLocalDateString(d);
  }, [range]);

  const summary = useMemo(
    () => computeMeasurementTrends(rows, MEASUREMENT_FIELDS, rangeCutoff),
    [rows, rangeCutoff]
  );

  // Default selection: the first listed site with enough data for a chart.
  useEffect(() => {
    if (site && summary.sites.some((s) => s.site === site)) return;
    const withTrend = summary.sites.find((s) => s.pointCount >= 2) ?? summary.sites[0];
    setSite((withTrend?.site as keyof Measurements) ?? '');
  }, [summary, site]);

  const selected = summary.sites.find((s) => s.site === site) ?? null;

  /** All entries for the site regardless of range (for the empty-state copy). */
  const sitePointCount = useMemo(
    () => (site ? rows.filter((row) => row[site] != null).length : 0),
    [rows, site]
  );

  /**
   * Full entry history for the selected site, newest first — the editor list
   * deliberately ignores the chart's date range so a bad entry is fixable
   * without hunting for the window it falls in.
   */
  const siteEntries = useMemo(() => {
    if (!site) return [];
    return rows
      .filter((row) => typeof row[site] === 'number' && Number.isFinite(row[site]))
      .map((row) => ({ date: row.logged_at, valueCm: row[site] as number }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [rows, site]);

  /**
   * Rolling trend (time-aware EWMA, τ=10d — same smoothing as the weight
   * trend), keyed by date. Computed over the site's FULL history, before the
   * range filter, so a short window carries in prior trend state instead of
   * re-seeding on its first visible entry — a date's trend value is the same
   * in every window. Gated on the same entry floor as the badge.
   */
  const trendByDate = useMemo(() => {
    const map = new Map<string, number>();
    if (siteEntries.length < MIN_POINTS_FOR_TREND) return map;
    for (const p of computeEwmaTrend(
      siteEntries.map((e) => ({ date: e.date, value: e.valueCm }))
    )) {
      map.set(p.date, p.trend);
    }
    return map;
  }, [siteEntries]);

  /**
   * Detail-chart rows on a TRUE TIME axis (x = ms epoch): a 6-month gap must
   * be 6 months wide, not one categorical tick. Solid segments break at
   * spans > LOW_CONFIDENCE_GAP_DAYS without entries; each such span is
   * bridged by a dedicated dashed `gapK` series instead (same convention as
   * the Body Composition chart). Outlier-excluded entries plot as marked
   * dots (`excluded`) — visible, never silently dropped — and are omitted
   * from the fitted line.
   */
  const chartData = useMemo(() => {
    if (!selected) return { rows: [] as Record<string, number | null | undefined>[], gapCount: 0 };
    const toUnit = (cm: number) => (tapeUnit === 'in' ? cmToIn(cm) : cm);
    const toTime = (date: string) => new Date(`${date}T00:00:00`).getTime();
    const excludedSet = new Set(selected.excludedDates);

    // Tape-specific gap threshold (45d — tape is logged weekly/monthly, not
    // daily like weigh-ins): spans beyond it render dashed, same convention
    // as the Body Composition chart's low-confidence segments.
    const included = selected.history.filter((p) => !excludedSet.has(p.date));
    const gaps = findLowConfidenceGaps(
      included.map((p) => p.date),
      MEASUREMENT_LOW_CONFIDENCE_GAP_DAYS
    );

    const rows: Record<string, number | null | undefined>[] = [];
    for (const point of selected.history) {
      const trendCm = trendByDate.get(point.date);
      const isExcluded = excludedSet.has(point.date);
      rows.push({
        t: toTime(point.date),
        value: isExcluded ? undefined : Math.round(toUnit(point.valueCm) * 10) / 10,
        excluded: isExcluded ? Math.round(toUnit(point.valueCm) * 10) / 10 : undefined,
        // Trend keeps 2 decimals so the overlay stays smooth; raw stays
        // display-rounded.
        trend: trendCm != null ? Math.round(toUnit(trendCm) * 100) / 100 : undefined,
      });
    }

    // Bridge each sparse span with a dashed gapK series (values only at the
    // two supported endpoints; connectNulls joins them) and break the solid
    // line by interposing a null-value row mid-gap.
    gaps.forEach((gap, k) => {
      const from = included[gap.fromIndex];
      const to = included[gap.toIndex];
      if (!from || !to) return;
      const fromT = toTime(from.date);
      const toT = toTime(to.date);
      const key = `gap${k}`;
      for (const row of rows) {
        if (row.t === fromT) row[key] = Math.round(toUnit(from.valueCm) * 10) / 10;
        if (row.t === toT) row[key] = Math.round(toUnit(to.valueCm) * 10) / 10;
      }
      rows.push({ t: (fromT + toT) / 2, value: null });
    });
    rows.sort((a, b) => (a.t as number) - (b.t as number));

    return { rows, gapCount: gaps.length };
  }, [selected, trendByDate, tapeUnit]);

  const hasTrendLine = chartData.rows.some((d) => d.trend != null);
  const hasExcluded = (selected?.excludedDates.length ?? 0) > 0;
  const formatTick = (t: number) =>
    new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const formatValue = (cm: number) =>
    `${(tapeUnit === 'in' ? cmToIn(cm) : cm).toFixed(1)} ${tapeUnit}`;
  const formatRate = (cmPerMonth: number) => {
    const v = tapeUnit === 'in' ? cmToIn(cmPerMonth) : cmPerMonth;
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)} ${tapeUnit}/mo`;
  };
  /** Raw observed change (no rate unit) for short-span/low-confidence sites. */
  const formatDelta = (cmDelta: number) => {
    const v = tapeUnit === 'in' ? cmToIn(cmDelta) : cmDelta;
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)} ${tapeUnit}`;
  };

  const aggregateParts: string[] = [];
  if (summary.rising + summary.flat + summary.down > 0) {
    aggregateParts.push(
      `${summary.rising} rising`,
      `${summary.flat} flat`,
      `${summary.down} down`
    );
  }
  if (summary.building > 0) aggregateParts.push(`${summary.building} building history`);
  const rangeSubtitle = DATE_RANGES.find((r) => r.key === range)?.subtitle ?? '';

  if (!isLoading && rows.length === 0) return null; // nothing to trend yet

  return (
    <Card>
      <CardHeader>
        <CardTitle>Measurement Trends</CardTitle>
        {!isLoading && summary.sites.length > 0 && (
          <p className="text-xs text-surface-500 mt-1">
            Tape trend per site over the {rangeSubtitle} · {aggregateParts.join(' · ')}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {!isLoading && rows.length > 0 && (
          <div className="flex gap-1 mb-3" role="group" aria-label="Date range">
            {DATE_RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                data-testid={`measurement-trend-range-${r.key}`}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  range === r.key
                    ? 'bg-primary-500 text-white'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                }`}
                aria-pressed={range === r.key}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
        {isLoading ? (
          <div className="h-48 animate-pulse bg-surface-800/50 rounded-lg" />
        ) : summary.sites.length === 0 ? (
          <p className="text-sm text-surface-500 py-6 text-center">
            No measurements in this date range — try a longer range.
          </p>
        ) : (
          <>
            <div className="space-y-1" role="listbox" aria-label="Measurement site trends">
              {summary.sites.map((trend) => (
                <button
                  key={trend.site}
                  type="button"
                  role="option"
                  aria-selected={trend.site === site}
                  onClick={() => setSite(trend.site as keyof Measurements)}
                  data-testid={`measurement-trend-row-${trend.site}`}
                  className={`w-full flex items-center gap-3 p-3 -mx-1 rounded-lg text-left transition-colors ${
                    trend.site === site ? 'bg-surface-800/70' : 'hover:bg-surface-800/50'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-surface-200 truncate">
                        {trend.label}
                      </p>
                      {trend.direction == null ? (
                        <Badge size="sm" variant="default">Building</Badge>
                      ) : (
                        <Badge
                          size="sm"
                          variant={
                            trend.improving == null
                              ? 'default'
                              : trend.improving
                              ? 'success'
                              : 'danger'
                          }
                        >
                          {DIRECTION_LABEL[trend.direction]}
                        </Badge>
                      )}
                    </div>
                    {/* A building site shows NO rate — a slope fitted through
                        one or two tape entries is noise with a decimal point.
                        A short-span site shows the RAW observed delta: a
                        per-month figure off a 17-day span is extrapolation
                        dressed as measurement. */}
                    <p className="text-xs text-surface-500 mt-0.5">
                      {trend.direction == null
                        ? `${formatValue(trend.currentCm)} · ${trend.pointCount} ${
                            trend.pointCount === 1 ? 'entry' : 'entries'
                          } — trends appear after ${MIN_POINTS_FOR_TREND}`
                        : !trend.rateIsReliable
                        ? `${formatValue(trend.currentCm)} · ${formatDelta(trend.observedDeltaCm)} over ${trend.spanDays}d · ${trend.pointCount} entries`
                        : `${formatValue(trend.currentCm)} · ${formatRate(trend.monthlyChangeCm)} · ${trend.pointCount} entries`}
                      {trend.excludedDates.length > 0 &&
                        ` · ${trend.excludedDates.length} outlier excluded`}
                    </p>
                  </div>
                  <SiteSparkline trend={trend} />
                </button>
              ))}
            </div>

            {selected && (
              <div className="mt-4 pt-3 border-t border-surface-800">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-surface-400">
                    {selected.label} detail
                  </p>
                  {(hasTrendLine || chartData.gapCount > 0 || hasExcluded) && (
                    <span
                      className="flex items-center gap-3 text-[10px] text-surface-500"
                      data-testid="measurement-detail-legend"
                    >
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-3 h-0.5 rounded bg-[#818cf8]" />
                        Logged
                      </span>
                      {hasTrendLine && (
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-3 h-0.5 rounded bg-[#fbbf24]" />
                          Trend
                        </span>
                      )}
                      {chartData.gapCount > 0 && (
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-3 border-t border-dashed border-[#818cf8]" />
                          &gt;{MEASUREMENT_LOW_CONFIDENCE_GAP_DAYS}d gap (low confidence)
                        </span>
                      )}
                      {hasExcluded && (
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-2 h-2 rounded-full border border-danger-400" />
                          Excluded outlier
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {selected.history.length < 2 ? (
                  <p className="text-sm text-surface-500 py-6 text-center">
                    {sitePointCount >= 2
                      ? 'Fewer than two entries in this date range — try a longer range.'
                      : 'Log this site a couple of times to see its trend.'}
                  </p>
                ) : (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      {/* True time axis: a 6-month gap renders 6 months wide,
                          never one categorical tick. Straight (linear)
                          segments on sparse tape data — a spline that rises
                          above every observed point is inventing data. */}
                      <LineChart data={chartData.rows}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis
                          dataKey="t"
                          type="number"
                          scale="time"
                          domain={['dataMin', 'dataMax']}
                          tickFormatter={formatTick}
                          stroke="#9ca3af"
                          fontSize={11}
                          minTickGap={24}
                        />
                        <YAxis
                          stroke="#9ca3af"
                          fontSize={11}
                          domain={['auto', 'auto']}
                          width={40}
                          unit={tapeUnit === 'in' ? '"' : ''}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#1f2937',
                            border: '1px solid #374151',
                            borderRadius: '8px',
                            color: '#f3f4f6',
                            fontSize: 12,
                          }}
                          labelFormatter={(t) => formatTick(Number(t))}
                          formatter={(value: number, name: string) => [
                            `${value} ${tapeUnit}`,
                            name.startsWith('gap') ? 'Sparse span (interpolated)' : name,
                          ]}
                        />
                        <Line
                          type="linear"
                          dataKey="value"
                          name="Logged"
                          stroke="#818cf8"
                          strokeWidth={2}
                          strokeOpacity={hasTrendLine ? 0.55 : 1}
                          dot={{ r: 2.5 }}
                          isAnimationActive={false}
                        />
                        {/* Dashed low-confidence bridges across sparse spans —
                            same convention as the Body Composition chart. */}
                        {Array.from({ length: chartData.gapCount }, (_, k) => (
                          <Line
                            key={`gap${k}`}
                            type="linear"
                            dataKey={`gap${k}`}
                            name={`gap${k}`}
                            stroke="#818cf8"
                            strokeWidth={1.5}
                            strokeOpacity={0.45}
                            strokeDasharray="5 4"
                            dot={false}
                            activeDot={false}
                            connectNulls
                            isAnimationActive={false}
                          />
                        ))}
                        {/* Outlier-excluded entries: visible, marked, never in
                            the fitted line — hidden removal is worse than a
                            visible outlier. */}
                        {hasExcluded && (
                          <Line
                            type="linear"
                            dataKey="excluded"
                            name="Excluded outlier"
                            stroke="none"
                            dot={{ r: 3.5, fill: 'none', stroke: '#f87171', strokeWidth: 1.5 }}
                            activeDot={{ r: 5 }}
                            isAnimationActive={false}
                          />
                        )}
                        {hasTrendLine && (
                          <Line
                            type="monotone"
                            dataKey="trend"
                            name="Trend"
                            stroke="#fbbf24"
                            strokeWidth={2}
                            dot={false}
                            activeDot={false}
                            isAnimationActive={false}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <SiteEntriesEditor
                  key={selected.site}
                  site={selected.site}
                  label={selected.label}
                  entries={siteEntries}
                  tapeUnit={tapeUnit}
                  onChanged={() => {
                    setLocalRefreshKey((k) => k + 1);
                    onDataChanged?.();
                  }}
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
