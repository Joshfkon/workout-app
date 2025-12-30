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
} from 'recharts';
import { formatDate, convertWeight } from '@/lib/utils';
import type { RechartsTooltipProps } from '@/types/database-queries';

type Timeframe = '7d' | '30d' | '90d';

interface WeightChartDataPoint {
  date: string;
  displayDate: string;
  weight: number;
}

const TIMEFRAME_DAYS: Record<Timeframe, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

interface WeightEntry {
  date: string;
  weight: number;
  unit: string;
}

interface WeightGraphProps {
  weightHistory: WeightEntry[];
  preferredUnit: 'lb' | 'kg';
  className?: string;
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

export const WeightGraph = memo(function WeightGraph({ weightHistory, preferredUnit, className }: WeightGraphProps) {
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

    return filtered.map((entry) => {
      // Simple conversion: from stored unit to display unit
      const storedUnit = (entry.unit || 'lb') as 'kg' | 'lb';
      const displayWeight = convertWeight(entry.weight, storedUnit, preferredUnit);

      return {
        date: entry.date,
        displayDate: formatDate(entry.date, { month: 'short', day: 'numeric' }),
        weight: Number(displayWeight.toFixed(1)),
      };
    });
  }, [weightHistory, timeframe, preferredUnit]);

  // Calculate trend
  const trend = useMemo(() => {
    if (chartData.length < 2) return null;

    const first = chartData[0].weight;
    const last = chartData[chartData.length - 1].weight;
    const change = last - first;

    return {
      change,
      isPositive: change > 0,
      isNegative: change < 0,
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
              {trend.change > 0 ? '+' : ''}
              {trend.change.toFixed(1)} {preferredUnit}
            </span>
          )}
        </div>
        <div className="flex gap-1 bg-surface-800 rounded-lg p-0.5">
          {(['7d', '30d', '90d'] as Timeframe[]).map((tf) => (
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
              interval="preserveStartEnd"
              tickMargin={8}
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
