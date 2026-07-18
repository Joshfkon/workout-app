'use client';

/**
 * Phase editor chart: the FULL weight history (all available data, no 30/90d
 * clamp) on a true time scale, with training-phase spans as translucent
 * background bands and DEXA scan dates as dots — the same visual language as
 * the Body tab trend chart (phaseStyle.ts).
 */

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
} from 'recharts';
import type { TrainingPhase } from '@/types/schema';
import { PHASE_STYLE, PHASE_BAND_OPACITY } from '@/components/body/phaseStyle';
import { parseLocalDay } from '@/lib/date/localDay';

export interface PhaseChartWeighIn {
  /** localDay YYYY-MM-DD */
  day: string;
  /** Weight in the display unit. */
  weight: number;
}

interface PhaseHistoryChartProps {
  weighIns: PhaseChartWeighIn[];
  /** DEXA scan days (localDay) rendered as dots on the weight line. */
  scanDays: string[];
  phases: Pick<TrainingPhase, 'phaseType' | 'startDay' | 'endDay'>[];
  unitLabel: 'lb' | 'kg';
}

function toTs(day: string): number {
  return parseLocalDay(day).getTime();
}

export function PhaseHistoryChart({ weighIns, scanDays, phases, unitLabel }: PhaseHistoryChartProps) {
  const rows = useMemo(
    () =>
      [...weighIns]
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((w) => ({ ts: toTs(w.day), weight: w.weight })),
    [weighIns]
  );

  // DEXA dots ride on the weight line: each scan day takes the nearest
  // weigh-in's value so the dot sits on the curve even without a same-day
  // weigh-in.
  const scanDots = useMemo(() => {
    if (rows.length === 0) return [];
    return scanDays
      .map((day) => {
        const ts = toTs(day.slice(0, 10));
        let nearest = rows[0];
        for (const row of rows) {
          if (Math.abs(row.ts - ts) < Math.abs(nearest.ts - ts)) nearest = row;
        }
        return { ts, scanWeight: nearest.weight };
      })
      .filter((dot) => dot.ts >= rows[0].ts && dot.ts <= rows[rows.length - 1].ts);
  }, [scanDays, rows]);

  const bands = useMemo(() => {
    if (rows.length === 0) return [];
    const minTs = rows[0].ts;
    const maxTs = rows[rows.length - 1].ts;
    return phases
      .map((p) => ({
        key: `${p.phaseType}-${p.startDay}`,
        color: PHASE_STYLE[p.phaseType].band,
        x1: Math.max(toTs(p.startDay), minTs),
        x2: Math.min(p.endDay ? toTs(p.endDay) : maxTs, maxTs),
      }))
      .filter((b) => b.x1 < b.x2);
  }, [phases, rows]);

  if (rows.length < 2) {
    return (
      <p className="text-sm text-surface-500 py-8 text-center">
        Not enough weight data to chart yet.
      </p>
    );
  }

  const formatTick = (ts: number) =>
    new Date(ts).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

  return (
    <div className="h-56" data-testid="phase-history-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={formatTick}
            stroke="#9ca3af"
            fontSize={11}
            minTickGap={32}
          />
          <YAxis stroke="#9ca3af" fontSize={11} domain={['auto', 'auto']} width={40} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
              color: '#f3f4f6',
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => [
              `${Number(value).toFixed(1)} ${unitLabel}`,
              name === 'scanWeight' ? 'DEXA scan' : 'Weight',
            ]}
            labelFormatter={(ts: number) =>
              new Date(ts).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            }
          />
          {bands.map((band) => (
            <ReferenceArea
              key={band.key}
              x1={band.x1}
              x2={band.x2}
              fill={band.color}
              fillOpacity={PHASE_BAND_OPACITY}
              stroke="none"
            />
          ))}
          <Line
            type="monotone"
            dataKey="weight"
            stroke="#0ea5e9"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 4, fill: '#0ea5e9' }}
          />
          <Scatter data={scanDots} dataKey="scanWeight" fill="#f3f4f6" shape="circle" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
