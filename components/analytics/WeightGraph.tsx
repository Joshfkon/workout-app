'use client';

import { useMemo, useState } from 'react';
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
import { formatDate } from '@/lib/utils';

type Timeframe = '7d' | '30d' | '90d';

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

export function WeightGraph({ weightHistory, preferredUnit, className }: WeightGraphProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('30d');

  const timeframeDays: Record<Timeframe, number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
  };

  // Convert weight to preferred unit with validation
  const convertWeight = (weight: number, fromUnit: string | null | undefined): number => {
    // If unit is missing, try to infer from weight value
    // If weight > 300 in preferred unit 'lb', it's likely in kg
    // If weight > 150 in preferred unit 'kg', it's likely in lb
    if (!fromUnit) {
      if (preferredUnit === 'lb' && weight > 300) {
        // Likely stored in kg, convert
        return weight * 2.20462;
      } else if (preferredUnit === 'kg' && weight > 150) {
        // Likely stored in lb, convert
        return weight / 2.20462;
      }
      // Assume already in preferred unit
      return weight;
    }
    
    // Validate: if unit says 'lb' but weight > 500, it's probably in kg
    // If unit says 'kg' but weight > 250, it's probably in lb
    if (fromUnit === 'lb' && weight > 500) {
      // Probably stored in kg, convert
      return weight * 2.20462;
    } else if (fromUnit === 'kg' && weight > 250) {
      // Probably stored in lb, convert
      return weight / 2.20462;
    }
    
    // Normal conversion
    if (fromUnit === preferredUnit) return weight;
    return fromUnit === 'kg' ? weight * 2.20462 : weight / 2.20462;
  };

  // Filter and prepare chart data based on timeframe
  const chartData = useMemo(() => {
    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(now.getDate() - timeframeDays[timeframe]);

    const filtered = weightHistory
      .filter((entry) => new Date(entry.date) >= cutoffDate)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    const mapped = filtered.map((entry) => {
      const convertedWeight = convertWeight(entry.weight, entry.unit);
      
      // Debug logging for Dec 19 specifically
      if (entry.date === '2025-12-19' || entry.date?.includes('2025-12-19')) {
        console.log(`[WeightGraph Debug] Dec 19 conversion:`, {
          date: entry.date,
          originalWeight: entry.weight,
          originalUnit: entry.unit,
          preferredUnit: preferredUnit,
          convertedWeight: convertedWeight,
        });
      }
      
      return {
        date: entry.date,
        displayDate: formatDate(entry.date, { month: 'short', day: 'numeric' }),
        weight: Number(convertedWeight.toFixed(1)),
        originalWeight: entry.weight,
        originalUnit: entry.unit,
      };
    });
    
    console.log(`[WeightGraph Debug] Chart data for ${timeframe}:`, mapped);
    return mapped;
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

  // Calculate stats
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;

    const weights = chartData.map((d) => d.weight);
    const current = weights[weights.length - 1];
    const max = Math.max(...weights);
    const min = Math.min(...weights);
    const avg = weights.reduce((a, b) => a + b, 0) / weights.length;

    return { current, max, min, avg };
  }, [chartData]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0].payload;

    return (
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-3 shadow-lg">
        <p className="text-sm text-surface-400 mb-1">{formatDate(data.date)}</p>
        <p className="text-surface-100 font-semibold">
          {data.weight} <span className="text-surface-400 font-normal">{preferredUnit}</span>
        </p>
      </div>
    );
  };

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
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
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
              domain={['dataMin - 2', 'dataMax + 2']}
              tickFormatter={(v) => `${v}`}
              width={35}
            />
            <Tooltip content={<CustomTooltip />} />
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
}
