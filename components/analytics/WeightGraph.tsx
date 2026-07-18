'use client';

import React, { useMemo, useState, useEffect, memo } from 'react';
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
import { formatDate, formatChartTickDate, dateTickStep, showDateTick } from '@/lib/utils';
import { getDisplayWeight } from '@/lib/weightUtils';
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

const WeightTooltip = memo(function WeightTooltip({
  active,
  payload,
  preferredUnit,
}: RechartsTooltipProps<WeightChartDataPoint> & { preferredUnit: string }) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload as WeightChartDataPoint;

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg p-3 shadow-lg">
      <p className="text-sm text-surface-400 mb-1">{formatDate(data.date)}</p>
      <p className="text-surface-100 font-semibold">
        {data.weight.toFixed(1)} <span className="text-surface-400 font-normal">{preferredUnit}</span>
      </p>
    </div>
  );
});

export const WeightGraph = memo(function WeightGraph({ weightHistory, preferredUnit, className, phases }: WeightGraphProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('30d');
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Simple, straightforward conversion - no guessing
  const chartData = useMemo(() => {
    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(now.getDate() - TIMEFRAME_DAYS[timeframe]);

    const filtered = weightHistory
      .filter((entry) => new Date(entry.date) >= cutoffDate)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Include the year in tick labels only when the range crosses a year boundary.
    const spansYear =
      filtered.length > 0 &&
      new Date(filtered[0].date).getFullYear() !==
        new Date(filtered[filtered.length - 1].date).getFullYear();

    return filtered.map((entry) => {
      // Use unified weight utility for consistent validation and conversion
      const displayWeight = getDisplayWeight(
        entry.weight,
        entry.unit as 'lb' | 'kg' | null,
        preferredUnit
      );

      return {
        date: entry.date,
        displayDate: formatChartTickDate(entry.date, spansYear),
        weight: Number(displayWeight.toFixed(1)),
      };
    });
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
  const trend = useMemo(() => {
    if (chartData.length < 2) return null;

    const t0 = new Date(chartData[0].date).getTime();
    const points = chartData.map((d) => ({
      x: (new Date(d.date).getTime() - t0) / (1000 * 60 * 60 * 24),
      y: d.weight,
    }));

    const n = points.length;
    const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
    const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
    const denom = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
    if (denom === 0) return null;

    const slopePerDay =
      points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0) / denom;
    const perWeek = slopePerDay * 7;

    return {
      perWeek,
      isPositive: perWeek > 0.05,
      isNegative: perWeek < -0.05,
    };
  }, [chartData]);

  // Calculate stats for reference line
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;

    const weights = chartData.map((d) => d.weight);
    const avg = weights.reduce((a, b) => a + b, 0) / weights.length;

    return { avg };
  }, [chartData]);

  // Calculate Y-axis domain with padding
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];

    const weights = chartData.map((d) => d.weight);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const padding = Math.max(2, (max - min) * 0.1);

    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData]);

  if (chartData.length === 0) {
    return (
      <div className={className}>
        <div className="text-center py-4">
          <p className="text-surface-400 text-sm">No weight data for this period</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Timeframe selector */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs text-surface-500">
          <span>Trend</span>
          {trend && (
            <span
              className={
                trend.isNegative
                  ? 'text-success-400'
                  : trend.isPositive
                  ? 'text-warning-400'
                  : 'text-surface-400'
              }
            >
              {trend.perWeek > 0 ? '+' : ''}
              {trend.perWeek.toFixed(1)} {preferredUnit}/wk
            </span>
          )}
        </div>
        <div className="flex gap-1 bg-surface-800 rounded-lg p-0.5">
          {(['7d', '14d', '30d', '90d'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                timeframe === tf
                  ? 'bg-primary-500 text-white'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
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
              tickFormatter={(v) => Math.round(v).toString()}
              width={40}
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
            {stats && (
              <ReferenceLine
                y={stats.avg}
                stroke="#71717a"
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
            )}
            <Line
              type="monotone"
              dataKey="weight"
              stroke="#0ea5e9"
              strokeWidth={2}
              dot={{ fill: '#0ea5e9', strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, fill: '#0ea5e9', stroke: '#fff', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
