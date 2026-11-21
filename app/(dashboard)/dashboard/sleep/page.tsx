'use client';

/**
 * Sleep detail page — the tap-through behind the home Sleep tile.
 *
 * One chart (nightly hours as bars, smoothed 7-day average as a line, 7h
 * target reference), stat tiles (last night / 7-day avg / 30-day avg /
 * week-over-week trend) and a 30-day quality breakdown. Unlogged nights stay
 * as gaps — never zero-hour bars. Logging stays one tap away via the same
 * quick-log sheet the home tile used to open directly.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { IconMoon } from '@tabler/icons-react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import { Button, Card, CardContent, CardHeader, CardTitle, Modal, PageHeader } from '@/components/ui';
import { SleepQuickLog, SLEEP_QUALITY_DOT_CLASS, SLEEP_QUALITY_LABELS } from '@/components/dashboard/SleepQuickLog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSleepHistory } from '@/hooks/useSleepHistory';
import { formatSleepHours } from '@/lib/sleep/formatSleep';
import {
  buildSleepTrendSeries,
  computeSleepTrendStats,
  type SleepTrendPoint,
} from '@/lib/sleep/sleepTrends';
import { getLocalDateString } from '@/lib/utils';
import { SLEEP_QUALITIES, type SleepQuality } from '@/types/schema';

/** Same hue the Wellness Trends card plots sleep in. */
const SLEEP_BAR_COLOR = '#8b5cf6';
/** Lighter step of the same hue for the derived 7-day average line. */
const SLEEP_AVG_COLOR = '#ddd6fe';
const TARGET_HOURS = 7;

const RANGES = [
  { days: 14, label: '2W' },
  { days: 30, label: '1M' },
  { days: 90, label: '3M' },
] as const;

function formatTick(localDay: string): string {
  // localDay is YYYY-MM-DD; avoid `new Date(str)` UTC-midnight parsing.
  const [, m, d] = localDay.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function formatTooltipDay(localDay: string): string {
  const [y, m, d] = localDay.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Tooltip showing the night's hours + logged quality and the 7-day average. */
function SleepTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as SleepTrendPoint;
  return (
    <div className="bg-fill border border-sep rounded-lg px-3 py-2 text-caption">
      <p className="text-ink-2 font-medium mb-1">{formatTooltipDay(String(label))}</p>
      {point.hours != null ? (
        <p className="text-ink">
          {formatSleepHours(point.hours)} slept
          {point.quality && (
            <span className="text-ink-2"> · {SLEEP_QUALITY_LABELS[point.quality]}</span>
          )}
        </p>
      ) : (
        <p className="text-ink-3">Not logged</p>
      )}
      {point.rollingAvg != null && (
        <p className="text-ink-2 mt-0.5">
          {formatSleepHours(Math.round(point.rollingAvg * 10) / 10)} 7-day avg
        </p>
      )}
    </div>
  );
}

function StatTile({
  label,
  children,
  sub,
}: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-card p-3 shadow-card">
      <p className="text-caption text-ink-3 mb-1">{label}</p>
      <div className="text-headline font-semibold text-ink">{children}</div>
      {sub && <p className="text-caption text-ink-3 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function SleepPage() {
  useDocumentTitle('Sleep');
  const { entries, isLoading } = useSleepHistory();
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [isLogOpen, setIsLogOpen] = useState(false);

  const series = useMemo(() => buildSleepTrendSeries(entries, rangeDays), [entries, rangeDays]);
  const stats = useMemo(() => computeSleepTrendStats(entries), [entries]);

  const todayStr = getLocalDateString();
  const yesterdayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return getLocalDateString(d);
  }, []);
  const lastNight =
    entries.find((e) => e.localDay === todayStr || e.localDay === yesterdayStr) ?? null;

  const loggedInRange = series.filter((p) => p.hours != null).length;
  const round1 = (h: number) => Math.round(h * 10) / 10;

  const trendTile = (() => {
    if (stats.direction === null) {
      return { value: '—', sub: 'log 3+ nights each week to see a trend', color: 'text-ink-2' };
    }
    const delta = stats.deltaPerWeek!;
    if (stats.direction === 'steady') {
      return { value: '→ steady', sub: 'vs last week', color: 'text-ink' };
    }
    const signedDelta = `${delta > 0 ? '+' : '−'}${formatSleepHours(round1(Math.abs(delta)))}`;
    return {
      value: `${stats.direction === 'up' ? '↑' : '↓'} ${signedDelta}`,
      sub: 'avg/night vs last week',
      color: stats.direction === 'up' ? 'text-status-ok' : 'text-status-warn',
    };
  })();

  const hasAnyData = entries.length > 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <Link
        href="/dashboard"
        className="text-subhead text-ink-2 hover:text-ink inline-flex items-center gap-1"
      >
        ← Back to Dashboard
      </Link>

      <PageHeader
        title="Sleep"
        subtitle="Nightly hours, averages and trend"
        actions={
          <Button size="sm" onClick={() => setIsLogOpen(true)} data-testid="sleep-page-log">
            + Log sleep
          </Button>
        }
      />

      {isLoading && !hasAnyData ? (
        // Region-scoped skeleton only — never a full-page spinner.
        <div className="space-y-4 animate-pulse" data-testid="sleep-page-skeleton">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 bg-fill rounded-xl" />
            ))}
          </div>
          <div className="h-64 bg-fill rounded-xl" />
        </div>
      ) : !hasAnyData ? (
        <Card>
          <CardContent className="text-center py-10">
            <IconMoon size={28} className="mx-auto text-ink-3 mb-3" aria-hidden="true" />
            <p className="text-subhead text-ink-2 mb-1">No sleep logged yet</p>
            <p className="text-caption text-ink-3 mb-4">
              Log a night to start tracking your average and trend.
            </p>
            <Button size="sm" onClick={() => setIsLogOpen(true)}>
              Log last night
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stat tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Last night">
              {lastNight ? (
                <span className="flex items-baseline gap-1.5">
                  {formatSleepHours(lastNight.hours)}
                  <span
                    className={`w-2 h-2 rounded-full self-center ${SLEEP_QUALITY_DOT_CLASS[lastNight.quality]}`}
                    title={`Quality: ${SLEEP_QUALITY_LABELS[lastNight.quality]}`}
                  />
                </span>
              ) : (
                <span className="text-ink-2">not logged</span>
              )}
            </StatTile>
            <StatTile label="7-day avg">
              {stats.avg7 != null ? formatSleepHours(round1(stats.avg7)) : '—'}
            </StatTile>
            <StatTile
              label="30-day avg"
              sub={`${stats.nightsLogged30} of 30 nights logged`}
            >
              {stats.avg30 != null ? formatSleepHours(round1(stats.avg30)) : '—'}
            </StatTile>
            <StatTile label="Trend" sub={trendTile.sub}>
              <span className={trendTile.color} data-testid="sleep-trend-value">
                {trendTile.value}
              </span>
            </StatTile>
          </div>

          {/* Chart */}
          <Card data-testid="sleep-trend-card">
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle>Nightly sleep</CardTitle>
                <div className="flex items-center gap-1">
                  {RANGES.map((r) => (
                    <button
                      key={r.days}
                      onClick={() => setRangeDays(r.days)}
                      className={`px-2.5 py-1 text-caption font-medium rounded-lg transition-colors ${
                        rangeDays === r.days
                          ? 'bg-action text-on-action'
                          : 'bg-fill text-ink-2 hover:text-ink'
                      }`}
                      data-testid={`sleep-range-${r.label}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loggedInRange === 0 ? (
                <p className="text-subhead text-ink-3 text-center py-8">
                  No sleep logged in this range.
                </p>
              ) : (
                <>
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={series} barCategoryGap="25%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                        <XAxis
                          dataKey="localDay"
                          stroke="#9ca3af"
                          tick={{ fill: '#9ca3af', fontSize: 10 }}
                          tickFormatter={formatTick}
                          minTickGap={24}
                        />
                        <YAxis
                          stroke="#9ca3af"
                          tick={{ fill: '#9ca3af', fontSize: 10 }}
                          domain={[0, (dataMax: number) => Math.max(9, Math.ceil(dataMax + 0.5))]}
                          width={28}
                          tickFormatter={(v: number) => `${v}h`}
                        />
                        <Tooltip content={<SleepTooltip />} />
                        <Legend
                          wrapperStyle={{ fontSize: 11 }}
                          formatter={(value: string) => (
                            <span className="text-ink-2">{value}</span>
                          )}
                        />
                        <ReferenceLine
                          y={TARGET_HOURS}
                          stroke="#10b981"
                          strokeDasharray="3 3"
                          label={{ value: 'Target', position: 'right', fill: '#10b981', fontSize: 10 }}
                        />
                        <Bar
                          dataKey="hours"
                          name="Nightly hours"
                          fill={SLEEP_BAR_COLOR}
                          fillOpacity={0.8}
                          radius={[3, 3, 0, 0]}
                          isAnimationActive={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="rollingAvg"
                          name="7-day avg"
                          stroke={SLEEP_AVG_COLOR}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-caption text-ink-3 mt-2">
                    Unlogged nights are gaps, not zeros — the average only counts logged nights.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Quality breakdown (trailing 30 days) */}
          {stats.nightsLogged30 > 0 && (
            <Card data-testid="sleep-quality-breakdown">
              <CardHeader>
                <CardTitle>Quality · last 30 days</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2">
                  {([...SLEEP_QUALITIES].reverse() as SleepQuality[]).map((q) => (
                    <div key={q} className="text-center p-2.5 bg-fill/50 rounded-lg">
                      <div className="flex items-center justify-center gap-1.5 text-caption text-ink-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${SLEEP_QUALITY_DOT_CLASS[q]}`}
                          aria-hidden="true"
                        />
                        {SLEEP_QUALITY_LABELS[q]}
                      </div>
                      <p className="text-headline font-semibold text-ink mt-0.5">
                        {stats.qualityCounts30[q]}
                        <span className="text-caption text-ink-3 font-normal">
                          {' '}night{stats.qualityCounts30[q] === 1 ? '' : 's'}
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {isLogOpen && (
        <Modal isOpen onClose={() => setIsLogOpen(false)} title="Log sleep">
          <SleepQuickLog onSaved={() => setIsLogOpen(false)} />
        </Modal>
      )}
    </div>
  );
}
