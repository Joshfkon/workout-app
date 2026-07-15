'use client';

import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';
import {
  formatDate,
  formatChartTickDate,
  dateTickStep,
  showDateTick,
} from '@/lib/utils';
import { groupByDay, type BloodPressurePeriod } from '@/services/bloodPressure';
import type { BloodPressureEntry } from '@/types/schema';

/**
 * BloodPressureGraph — systolic + diastolic plotted over time. One point per
 * local day (the day's average, so multiple readings collapse to a single
 * trend point). The parent owns the period filter so the chart and the stats
 * header stay in sync; this component just draws the already-filtered set.
 */

interface BloodPressureGraphProps {
  /** Readings already filtered to the selected period (any order). */
  readings: BloodPressureEntry[];
  period: BloodPressurePeriod;
  className?: string;
}

interface ChartPoint {
  localDay: string;
  displayDate: string;
  systolic: number;
  diastolic: number;
}

const SYSTOLIC_COLOR = '#0ea5e9'; // primary / sky
const DIASTOLIC_COLOR = '#a855f7'; // violet

const PERIOD_SPAN_DAYS: Record<BloodPressurePeriod, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: 365,
};

const BPTooltip = memo(function BPTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
}) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg p-3 shadow-lg">
      <p className="text-sm text-surface-400 mb-1">{formatDate(data.localDay)}</p>
      <p className="text-surface-100 font-semibold tabular-nums">
        {data.systolic}/{data.diastolic}{' '}
        <span className="text-surface-400 font-normal">mmHg</span>
      </p>
    </div>
  );
});

export const BloodPressureGraph = memo(function BloodPressureGraph({
  readings,
  period,
  className,
}: BloodPressureGraphProps) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const chartData = useMemo<ChartPoint[]>(() => {
    const days = groupByDay(readings);
    // Oldest -> newest for a left-to-right trend.
    const ascending = [...days].sort((a, b) => a.localDay.localeCompare(b.localDay));
    const spansYear =
      ascending.length > 0 &&
      new Date(ascending[0].localDay).getFullYear() !==
        new Date(ascending[ascending.length - 1].localDay).getFullYear();
    return ascending.map((d) => ({
      localDay: d.localDay,
      displayDate: formatChartTickDate(d.localDay, spansYear),
      systolic: d.average.systolic,
      diastolic: d.average.diastolic,
    }));
  }, [readings]);

  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [40, 160];
    const values = chartData.flatMap((d) => [d.systolic, d.diastolic]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max(8, (max - min) * 0.1);
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData]);

  if (!isMounted) {
    return <div className={className}><div className="h-48" /></div>;
  }

  if (chartData.length === 0) {
    return (
      <div className={className}>
        <div className="text-center py-8">
          <p className="text-surface-400 text-sm">No readings for this period</p>
        </div>
      </div>
    );
  }

  const spanDays = PERIOD_SPAN_DAYS[period];

  return (
    <div className={className}>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
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
                showDateTick(index, chartData.length, dateTickStep(spanDays)) ? value : ''
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
            <Tooltip content={<BPTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }}
              iconType="plainline"
            />
            {/* Reference thresholds (systolic 120 / 130, diastolic 80). */}
            <ReferenceLine y={120} stroke="#3f3f46" strokeDasharray="2 4" strokeOpacity={0.6} />
            <ReferenceLine y={80} stroke="#3f3f46" strokeDasharray="2 4" strokeOpacity={0.6} />
            <Line
              name="Systolic"
              type="monotone"
              dataKey="systolic"
              stroke={SYSTOLIC_COLOR}
              strokeWidth={2}
              dot={{ fill: SYSTOLIC_COLOR, strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, fill: SYSTOLIC_COLOR, stroke: '#fff', strokeWidth: 2 }}
            />
            <Line
              name="Diastolic"
              type="monotone"
              dataKey="diastolic"
              stroke={DIASTOLIC_COLOR}
              strokeWidth={2}
              dot={{ fill: DIASTOLIC_COLOR, strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, fill: DIASTOLIC_COLOR, stroke: '#fff', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
