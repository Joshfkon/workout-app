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
  /** null = no estimable set that day — rendered as a gap, never a 0. */
  e1rm: number | null;
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
   * to plot longest hold per session ("Longest hold", unit "s") — e1RM is
   * explicitly excluded for them.
   */
  seriesLabel?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--ht-sep))" />
        <XAxis
          dataKey="date"
          stroke="rgb(var(--ht-ink-3))"
          tick={{ fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis
          stroke="rgb(var(--ht-ink-3))"
          tick={{ fontSize: 11 }}
          domain={['auto', 'auto']}
          tickFormatter={(value) => `${value}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'rgb(var(--ht-card))',
            border: '1px solid rgb(var(--ht-sep))',
            borderRadius: '8px',
          }}
          labelStyle={{ color: 'rgb(var(--ht-ink-3))' }}
          formatter={(value: number, name: string) => [
            `${value} ${unit}`,
            name === 'e1rm' ? seriesLabel : 'Best weight',
          ]}
        />
        <Line
          type="monotone"
          dataKey="e1rm"
          stroke="rgb(var(--ht-action))"
          strokeWidth={2}
          dot={{ fill: 'rgb(var(--ht-action))', strokeWidth: 0, r: 4 }}
          activeDot={{ r: 6 }}
        />
        <ReferenceLine
          y={prLine}
          stroke="rgb(var(--ht-ok))"
          strokeDasharray="5 5"
          label={{ value: 'PR', fill: 'rgb(var(--ht-ok))', fontSize: 11 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
