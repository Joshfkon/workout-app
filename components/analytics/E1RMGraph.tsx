'use client';

import React, { useMemo, memo } from 'react';
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
import { Card, Badge } from '@/components/ui';
import type { ExercisePerformanceSnapshot } from '@/types/schema';
import type { RechartsTooltipProps } from '@/types/database-queries';
import { formatDate } from '@/lib/utils';

interface E1RMDataPoint {
  date: string;
  displayDate: string;
  e1rm: number;
  weight: number;
  reps: number;
  rpe: number;
}

interface E1RMGraphProps {
  exerciseName: string;
  snapshots: ExercisePerformanceSnapshot[];
  showTrend?: boolean;
}

// Moved outside component to prevent re-creation on every render
const CustomTooltip = memo(function CustomTooltip({ active, payload }: RechartsTooltipProps<E1RMDataPoint>) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload as E1RMDataPoint;

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg p-3 shadow-lg">
      <p className="text-sm text-surface-400 mb-2">{formatDate(data.date)}</p>
      <div className="space-y-1">
        <p className="text-surface-100">
          E1RM: <span className="font-mono text-primary-400 font-bold">{data.e1rm}kg</span>
        </p>
        <p className="text-xs text-surface-500">
          {data.weight}kg × {data.reps} @ RPE {data.rpe}
        </p>
      </div>
    </div>
  );
});

export const E1RMGraph = memo(function E1RMGraph({ exerciseName, snapshots, showTrend = true }: E1RMGraphProps) {
  const chartData = useMemo(() => {
    return [...snapshots]
      .sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime())
      .map((s) => ({
        date: s.sessionDate,
        displayDate: formatDate(s.sessionDate, { month: 'short', day: 'numeric' }),
        e1rm: s.estimatedE1RM,
        weight: s.topSetWeightKg,
        reps: s.topSetReps,
        rpe: s.topSetRpe,
      }));
  }, [snapshots]);

  // Calculate trend
  const trend = useMemo(() => {
    if (chartData.length < 2) return null;

    const first = chartData[0].e1rm;
    const last = chartData[chartData.length - 1].e1rm;
    const change = last - first;
    const percentChange = ((change / first) * 100).toFixed(1);

    return {
      change,
      percentChange,
      isPositive: change > 0,
    };
  }, [chartData]);

  // Calculate max and current
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;

    const current = chartData[chartData.length - 1].e1rm;
    const max = Math.max(...chartData.map((d) => d.e1rm));
    const min = Math.min(...chartData.map((d) => d.e1rm));

    return { current, max, min };
  }, [chartData]);

  if (chartData.length === 0) {
    return (
      <Card>
        <div className="text-center py-8">
          <p className="text-surface-400">No performance data yet</p>
          <p className="text-sm text-surface-500 mt-1">
            Complete workouts to see your progress
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-surface-100">{exerciseName}</h3>
          <p className="text-sm text-surface-400">Estimated 1RM Progress</p>
        </div>
        {trend && showTrend && (
          <Badge variant={trend.isPositive ? 'success' : 'danger'}>
            {trend.isPositive ? '+' : ''}{trend.change.toFixed(1)}kg ({trend.percentChange}%)
          </Badge>
        )}
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-surface-800/50 rounded-lg">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-400">{stats.current}kg</p>
            <p className="text-xs text-surface-500">Current E1RM</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-success-400">{stats.max}kg</p>
            <p className="text-xs text-surface-500">Peak E1RM</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-surface-400">{chartData.length}</p>
            <p className="text-xs text-surface-500">Sessions</p>
          </div>
        </div>
      )}

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="displayDate"
              stroke="#71717a"
              fontSize={11}
              tickLine={false}
            />
            <YAxis
              stroke="#71717a"
              fontSize={11}
              tickLine={false}
              domain={['dataMin - 5', 'dataMax + 5']}
              tickFormatter={(v) => `${v}kg`}
            />
            <Tooltip content={<CustomTooltip />} />
            {stats && (
              <ReferenceLine
                y={stats.max}
                stroke="#22c55e"
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
            )}
            <Line
              type="monotone"
              dataKey="e1rm"
              stroke="#0ea5e9"
              strokeWidth={2}
              dot={{ fill: '#0ea5e9', strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6, fill: '#0ea5e9', stroke: '#fff', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
});

// Compact sparkline version - memoized to prevent re-renders
export const E1RMSparkline = memo(function E1RMSparkline({
  snapshots,
  className,
}: {
  snapshots: ExercisePerformanceSnapshot[];
  className?: string;
}) {
  const chartData = useMemo(() => {
    return [...snapshots]
      .sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime())
      .slice(-10) // Last 10 sessions
      .map((s) => ({
        e1rm: s.estimatedE1RM,
      }));
  }, [snapshots]);

  if (chartData.length < 2) return null;

  return (
    <div className={`h-8 ${className}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="e1rm"
            stroke="#0ea5e9"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

