'use client';

import React, { useMemo, useState, memo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { formatDate, formatChartTickDate, dateTickStep, showDateTick, parseLocalDate } from '@/lib/utils';
import { now as clockNow } from '@/lib/clock';
import { DAY_MS, weighInsInWindow, weightTrendLine } from './weightTrend';
import type { RechartsTooltipProps } from '@/types/database-queries';
import type { PhaseType } from '@/types/schema';
import { PHASE_STYLE, PHASE_BAND_OPACITY } from '@/components/body/phaseStyle';

type Timeframe = '7d' | '14d' | '30d' | '90d';

interface WeightChartDataPoint {
  date: string;
  displayDate: string;
  weight: number;
}

const TIMEFRAME_DAYS: Record<Timeframe, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
};

interface WeightEntry {
  date: string;
  weight: number;
  unit: string;
}

/** A training-phase span rendered as a translucent background band. */
export interface PhaseBandSpan {
  phaseType: PhaseType;
  /** localDay YYYY-MM-DD */
  startDay: string;
  /** null = active phase (band extends to the newest point) */
  endDay: string | null;
}

interface WeightGraphProps {
  weightHistory: WeightEntry[];
  preferredUnit: 'lb' | 'kg';
  className?: string;
  /** Optional phase spans, drawn as colored background bands. */
  phases?: PhaseBandSpan[];
}

/**
 * Smallest y-axis span (in the display unit). Normal day-to-day bodyweight
 * noise is ~1–2 lb, so a window narrower than this would blow water-weight
 * wiggle up into a cliff. Wider than this and a real 1 lb/month trend reads
 * as a flat line next to a "-0.8 lb/wk" label.
 */
export const MIN_WEIGHT_AXIS_SPAN: Record<'lb' | 'kg', number> = { lb: 4, kg: 2 };

/**
 * Y-axis domain for the weight line: the data range plus 15% headroom each
 * side, never narrower than MIN_WEIGHT_AXIS_SPAN, centred on the data and
 * snapped outward to whole units (lb) or half units (kg) so ticks are clean.
 */
export function weightAxisDomain(weights: number[], unit: 'lb' | 'kg'): [number, number] {
  if (weights.length === 0) return [0, 100];
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min;
  const span = Math.max(range * 1.3, MIN_WEIGHT_AXIS_SPAN[unit]);
  const mid = (min + max) / 2;
  const step = unit === 'kg' ? 0.5 : 1;
  return [Math.floor((mid - span / 2) / step) * step, Math.ceil((mid + span / 2) / step) * step];
}

/**
 * Headline facts for the visible window: the newest weigh-in, and the
 * first → newest change with the real number of days it covers.
 */
export function weightWindowSummary(data: WeightChartDataPoint[]): {
  current: number;
  currentDate: string;
  start: number;
  days: number;
} | null {
  if (data.length === 0) return null;
  const first = data[0];
  const last = data[data.length - 1];
  return {
    current: last.weight,
    currentDate: last.date,
    start: first.weight,
    days: Math.round((parseLocalDate(last.date).getTime() - parseLocalDate(first.date).getTime()) / DAY_MS),
  };
}

const formatAxisWeight = (v: number) => (Number.isInteger(v) ? v.toString() : v.toFixed(1));

const WeightTooltip = memo(function WeightTooltip({
  active,
  payload,
  preferredUnit,
}: RechartsTooltipProps<WeightChartDataPoint> & { preferredUnit: string }) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload as WeightChartDataPoint;

  return (
    <div className="bg-fill border border-sep rounded-lg p-3 shadow-lg">
      <p className="text-subhead text-ink-2 mb-1">{formatDate(data.date)}</p>
      <p className="text-ink font-semibold">
        {data.weight.toFixed(1)} <span className="text-ink-2 font-normal">{preferredUnit}</span>
      </p>
    </div>
  );
});

export const WeightGraph = memo(function WeightGraph({ weightHistory, preferredUnit, className, phases }: WeightGraphProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('30d');

  // Simple, straightforward conversion - no guessing
  const chartData = useMemo(() => {
    // Whole local days, display unit, one decimal — shared with the
    // Progress summary line (weightTrend.weighInsInWindow).
    const filtered = weighInsInWindow(weightHistory, preferredUnit, TIMEFRAME_DAYS[timeframe], clockNow());

    // Include the year in tick labels only when the range crosses a year boundary.
    const spansYear =
      filtered.length > 0 &&
      parseLocalDate(filtered[0].date).getFullYear() !==
        parseLocalDate(filtered[filtered.length - 1].date).getFullYear();

    return filtered.map((entry) => ({
      date: entry.date,
      displayDate: formatChartTickDate(entry.date, spansYear),
      weight: entry.weight,
    }));
  }, [weightHistory, timeframe, preferredUnit]);

  // Phase spans clipped to the visible window, expressed as category-axis
  // endpoints (first/last visible point inside each span). Rendered as
  // translucent ReferenceArea bands behind the line.
  const phaseBands = useMemo(() => {
    if (!phases || phases.length === 0 || chartData.length === 0) return [];
    const bands: { key: string; x1: string; x2: string; color: string }[] = [];
    for (const span of phases) {
      const start = span.startDay;
      const end = span.endDay ?? chartData[chartData.length - 1].date.slice(0, 10);
      const inSpan = chartData.filter((d) => {
        const day = d.date.slice(0, 10);
        return day >= start && day <= end;
      });
      if (inSpan.length < 2) continue;
      bands.push({
        key: `${span.phaseType}-${start}`,
        x1: inSpan[0].displayDate,
        x2: inSpan[inSpan.length - 1].displayDate,
        color: PHASE_STYLE[span.phaseType].band,
      });
    }
    return bands;
  }, [phases, chartData]);

  // Weekly rolling trend: least-squares slope of weight over the visible
  // window, expressed per week. Robust to noisy endpoints, unlike last - first.
  // The same fit is drawn as a dashed line so the number and the picture agree.
  const trend = useMemo(() => weightTrendLine(chartData), [chartData]);

  const summary = useMemo(() => weightWindowSummary(chartData), [chartData]);

  const yDomain = useMemo(
    () => weightAxisDomain(chartData.map((d) => d.weight), preferredUnit),
    [chartData, preferredUnit]
  );

  const timeframeSelector = (
    <div className="flex gap-1 bg-fill rounded-lg p-0.5" role="group" aria-label="Weight chart range">
      {(['7d', '14d', '30d', '90d'] as Timeframe[]).map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => setTimeframe(tf)}
          aria-pressed={timeframe === tf}
          className={`px-2 py-1 text-caption rounded-md transition-colors ${
            timeframe === tf ? 'bg-action text-on-action' : 'text-ink-2 hover:text-ink'
          }`}
        >
          {tf}
        </button>
      ))}
    </div>
  );

  if (chartData.length === 0 || !summary) {
    // Keep the range control: the user needs a way out to a wider window.
    return (
      <div className={className}>
        <div className="flex justify-end mb-3">{timeframeSelector}</div>
        <div className="text-center py-4">
          <p className="text-ink-2 text-subhead">
            No weigh-ins in the last {TIMEFRAME_DAYS[timeframe]} days. Pick a longer range to see older ones.
          </p>
        </div>
      </div>
    );
  }

  // The change line reads off the same fitted trend the chart draws, so a
  // zigzag of water swings can't show "±0.0" next to a line that clearly
  // moves (or the reverse). Raw endpoints only when there's no fit.
  const changeStart = trend ? trend.fitStart : summary.start;
  const changeEnd = trend ? trend.fitEnd : summary.current;
  const change = changeEnd - changeStart;
  const sign = change > 0 ? '+' : change < 0 ? '−' : '±';

  return (
    <div className={className} data-testid="weight-graph">
      {/* Headline: current weight + its unit, then the window's change. */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <p className="text-[28px] font-bold leading-9 tracking-tight text-ink tabular-nums" data-testid="weight-current">
            {summary.current.toFixed(1)}
            <span className="ml-1 text-subhead font-normal text-ink-2">{preferredUnit}</span>
          </p>
          <p className="text-caption text-ink-2">Latest · {formatDate(summary.currentDate, { year: undefined })}</p>
        </div>
        {timeframeSelector}
      </div>
      <p className="text-subhead text-ink tabular-nums" data-testid="weight-change">
        {chartData.length >= 2 ? (
          <>
            {changeStart.toFixed(1)} → {changeEnd.toFixed(1)} {preferredUnit}{' '}
            <span className="text-ink-2">
              ({sign}
              {Math.abs(change).toFixed(1)}) in the last {TIMEFRAME_DAYS[timeframe]} days
            </span>
          </>
        ) : (
          <span className="text-ink-2">One weigh-in in this range — log another to see a change.</span>
        )}
      </p>
      {trend && (
        <p className="text-caption text-ink-2 mb-2" data-testid="weight-trend">
          Trend line{' '}
          <span
            className={
              trend.isNegative ? 'text-status-ok' : trend.isPositive ? 'text-status-warn' : 'text-ink-2'
            }
          >
            {trend.perWeek > 0 ? '+' : trend.perWeek < 0 ? '−' : ''}
            {Math.abs(trend.perWeek).toFixed(1)} {preferredUnit}/wk
          </span>{' '}
          · smooths out day-to-day water swings
        </p>
      )}

      {/* Chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis
              dataKey="displayDate"
              stroke="#71717a"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              interval={0}
              minTickGap={0}
              tickFormatter={(value: string, index: number) =>
                showDateTick(index, chartData.length, dateTickStep(TIMEFRAME_DAYS[timeframe]))
                  ? value
                  : ''
              }
              angle={-35}
              textAnchor="end"
              height={38}
              tickMargin={4}
            />
            <YAxis
              stroke="#71717a"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              domain={yDomain}
              allowDecimals={preferredUnit === 'kg'}
              tickCount={5}
              tickFormatter={(v: number) => `${formatAxisWeight(v)} ${preferredUnit}`}
              width={52}
            />
            <Tooltip content={<WeightTooltip preferredUnit={preferredUnit} />} />
            {phaseBands.map((band) => (
              <ReferenceArea
                key={band.key}
                x1={band.x1}
                x2={band.x2}
                fill={band.color}
                fillOpacity={PHASE_BAND_OPACITY}
                stroke="none"
              />
            ))}
            {trend && chartData.length >= 2 && (
              <ReferenceLine
                segment={[
                  { x: chartData[0].displayDate, y: trend.fitStart },
                  { x: chartData[chartData.length - 1].displayDate, y: trend.fitEnd },
                ]}
                stroke="#a1a1aa"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                ifOverflow="extendDomain"
              />
            )}
            <Line
              type="monotone"
              dataKey="weight"
              stroke="#0ea5e9"
              strokeWidth={2}
              dot={{ fill: '#0ea5e9', strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, fill: '#0ea5e9', stroke: '#fff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-caption text-ink-3">Tap the line to see each weigh-in · dashed = trend line</p>
    </div>
  );
});
