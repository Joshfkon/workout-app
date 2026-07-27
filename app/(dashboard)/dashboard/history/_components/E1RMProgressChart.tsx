'use client';

/**
 * E1RM progress chart for the exercise-history modal. Split out of the
 * history page (P1-2, perf): recharts is ~100KB and only needed once a user
 * opens an exercise's detail — the page dynamic-imports this component so
 * the chart library stays out of history's first-load bundle.
 */

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

export interface E1RMChartPoint {
  date: string;
  /** Trend value; null on deload days (the point moves to `deloadE1rm`). */
  e1rm: number | null;
  /** Deload-day value, rendered as a muted dot outside the trend line. */
  deloadE1rm?: number | null;
}

export default function E1RMProgressChart({
  chartData,
  unit,
  prLine,
  seriesLabel = 'Est. 1RM',
}: {
  chartData: E1RMChartPoint[];
  unit: string;
  /** All-time max E1RM already converted to display units. */
  prLine: number;
  /**
   * Tooltip label for the plotted series. Duration exercises reuse this chart
   * to plot longest hold per session ("Longest Hold", unit "s") — e1RM is
   * explicitly excluded for them.
   */
  seriesLabel?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="date"
          stroke="#9CA3AF"
          tick={{ fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis
          stroke="#9CA3AF"
          tick={{ fontSize: 11 }}
          domain={['auto', 'auto']}
          tickFormatter={(value) => `${value}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1F2937',
            border: '1px solid #374151',
            borderRadius: '8px',
          }}
          labelStyle={{ color: '#9CA3AF' }}
          formatter={(value: number, name: string) => [
            `${value} ${unit}`,
            name === 'deloadE1rm' ? 'Deload (not in trend)' : seriesLabel,
          ]}
        />
        <Line
          type="monotone"
          dataKey="e1rm"
          stroke="#8B5CF6"
          strokeWidth={2}
          dot={{ fill: '#8B5CF6', strokeWidth: 0, r: 4 }}
          activeDot={{ r: 6 }}
          connectNulls
        />
        {/* Deload sessions: visible as muted dots, excluded from the trend line */}
        <Line
          dataKey="deloadE1rm"
          stroke="none"
          dot={{ fill: '#6B7280', strokeWidth: 0, r: 4 }}
          activeDot={{ r: 5, fill: '#9CA3AF' }}
        />
        <ReferenceLine
          y={prLine}
          stroke="#22C55E"
          strokeDasharray="5 5"
          label={{ value: 'PR', fill: '#22C55E', fontSize: 11 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
