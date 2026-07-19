'use client';

/**
 * Phase editor chart: the FULL weight history (all available data, no 30/90d
 * clamp) on a true time scale, with training-phase spans as translucent
 * background bands and DEXA scan dates as dots — the same visual language as
 * the Body tab trend chart (phaseStyle.ts / BodyHubTrends).
 *
 * Two rendering rules are load-bearing here (see the June-2026 "weight
 * history seems wrong" report):
 *
 * 1. The DEXA Scatter must NOT get its own `data` prop. Inside a
 *    ComposedChart that already has chart-level data, recharts places a
 *    child Scatter's own rows by INDEX — the dots get spread across the
 *    full axis width (first scan pinned to the left edge, last scan to the
 *    right edge) instead of at their dates. Scan markers are therefore
 *    merged into the chart rows and rendered via `dataKey` alone.
 *
 * 2. Spans longer than LOW_CONFIDENCE_GAP_DAYS without weigh-ins render as
 *    dashed low-confidence bridges (same as the Body tab trend) instead of
 *    a confident solid curve — interpolation across a months-long void must
 *    not look like densely-supported history.
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
import { findLowConfidenceGaps } from '@/services/bodyCompAnchor';

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

interface ChartRow {
  ts: number;
  weight: number | null;
  /** Set only on rows that carry a DEXA scan marker. */
  scanWeight?: number;
  [key: `gap${number}`]: number | undefined;
}

function toTs(day: string): number {
  return parseLocalDay(day).getTime();
}

/** Above this count, per-point markers stop aiding readability. */
const MAX_POINT_DOTS = 150;

export function PhaseHistoryChart({ weighIns, scanDays, phases, unitLabel }: PhaseHistoryChartProps) {
  const { rows, gapCount, sparse } = useMemo(() => {
    const sortedWeighIns = [...weighIns].sort((a, b) => a.day.localeCompare(b.day));
    const dataRows: ChartRow[] = sortedWeighIns.map((w) => ({
      ts: toTs(w.day),
      weight: w.weight,
    }));
    if (dataRows.length === 0) return { rows: dataRows, gapCount: 0, sparse: false };

    // DEXA dots ride on the weight line: each scan snaps to the nearest
    // weigh-in row, so the marker sits exactly on the curve even without a
    // same-day weigh-in. Merged into the rows — never a separate Scatter
    // `data` prop (see header comment, rule 1).
    const minTs = dataRows[0].ts;
    const maxTs = dataRows[dataRows.length - 1].ts;
    for (const day of scanDays) {
      const ts = toTs(day.slice(0, 10));
      if (ts < minTs || ts > maxTs) continue;
      let nearest = dataRows[0];
      for (const row of dataRows) {
        if (Math.abs(row.ts - ts) < Math.abs(nearest.ts - ts)) nearest = row;
      }
      nearest.scanWeight = nearest.weight ?? undefined;
    }

    // Long spans without weigh-ins: break the solid line and bridge the two
    // supported endpoints with a dashed segment instead (header rule 2).
    const gaps = findLowConfidenceGaps(sortedWeighIns.map((w) => w.day));
    const breakers: ChartRow[] = gaps.map((gap, k) => {
      dataRows[gap.fromIndex][`gap${k}`] = dataRows[gap.fromIndex].weight ?? undefined;
      dataRows[gap.toIndex][`gap${k}`] = dataRows[gap.toIndex].weight ?? undefined;
      // Synthetic null point mid-gap so the solid line doesn't span it.
      return {
        ts: (dataRows[gap.fromIndex].ts + dataRows[gap.toIndex].ts) / 2,
        weight: null,
      };
    });

    return {
      rows: [...dataRows, ...breakers].sort((a, b) => a.ts - b.ts),
      gapCount: gaps.length,
      sparse: sortedWeighIns.length <= MAX_POINT_DOTS,
    };
  }, [weighIns, scanDays]);

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

  // Explicit month-boundary ticks labeled "Mar '26". Left to its own tick
  // generation, recharts picks near-arbitrary timestamps whose "MMM yy"
  // labels read like calendar dates ("Jun 26") and can omit the newest
  // months entirely, making the chart look like it ends earlier than the
  // data does.
  const ticks = useMemo(() => {
    if (rows.length === 0) return [];
    const firstTs = rows[0].ts;
    const lastTs = rows[rows.length - 1].ts;
    const first = new Date(firstTs);
    const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    if (cursor.getTime() < firstTs) cursor.setMonth(cursor.getMonth() + 1);
    const months: number[] = [];
    while (cursor.getTime() <= lastTs) {
      months.push(cursor.getTime());
      cursor.setMonth(cursor.getMonth() + 1);
    }
    const step = Math.max(1, Math.ceil(months.length / 6));
    return months.filter((_, i) => i % step === 0);
  }, [rows]);

  if (weighIns.length < 2) {
    return (
      <p className="text-sm text-surface-500 py-8 text-center">
        Not enough weight data to chart yet.
      </p>
    );
  }

  const formatTick = (ts: number) => {
    const date = new Date(ts);
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    return `${month} '${String(date.getFullYear()).slice(2)}`;
  };

  const seriesLabel = (name: string) =>
    name === 'scanWeight' ? 'DEXA scan' : name.startsWith('gap') ? 'Weight (sparse data)' : 'Weight';

  return (
    <div className="h-56" data-testid="phase-history-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={ticks}
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
              seriesLabel(name),
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
            dot={sparse ? { r: 2, fill: '#0ea5e9', strokeWidth: 0 } : false}
            activeDot={{ r: 4, fill: '#0ea5e9' }}
            isAnimationActive={false}
          />
          {Array.from({ length: gapCount }, (_, k) => (
            <Line
              key={`gap${k}`}
              type="linear"
              dataKey={`gap${k}`}
              stroke="#0ea5e9"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              strokeOpacity={0.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
          {/* Same DEXA marker as the Body tab trend chart. */}
          <Scatter
            dataKey="scanWeight"
            fill="#22d3ee"
            shape={(props: { cx?: number; cy?: number }) =>
              props.cx != null && props.cy != null ? (
                <circle cx={props.cx} cy={props.cy} r={5} fill="#22d3ee" stroke="#0e7490" strokeWidth={2} />
              ) : (
                <g />
              )
            }
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
