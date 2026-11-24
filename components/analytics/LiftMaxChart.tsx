'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { convertWeight, formatWeight } from '@/lib/utils';
import type { LiftTrendPoint } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import type { RechartsTooltipProps } from '@/types/database-queries';
import { setLabel, shortDay } from './liftTrendFormat';

/** One plotted session: x is local-midnight ms (real time spacing), y in the display unit. */
export interface LiftChartPoint {
  t: number;
  date: string;
  /** Estimated max in the display unit (plotted)… */
  max: number;
  /** …and in kg (labels go through formatWeight). */
  maxKg: number;
  /** "185 lbs × 8" — the set the estimate came from. */
  set: string;
}

/**
 * The per-lift chart's data: one point per workout, estimated max in the
 * user's unit, spaced by real dates (a week off shows as a gap, not as the
 * next tick). Pure; exported for tests.
 */
export function liftChartData(points: readonly LiftTrendPoint[], units: 'lb' | 'kg'): LiftChartPoint[] {
  return points
    .map((p) => ({
      t: new Date(`${p.date}T00:00:00`).getTime(),
      date: p.date,
      max: Math.round(convertWeight(p.e1rmKg, 'kg', units) * 10) / 10,
      maxKg: p.e1rmKg,
      set: setLabel(p.topSetWeightKg, p.topSetReps, units),
    }))
    .filter((p) => Number.isFinite(p.t) && p.max > 0)
    .sort((a, b) => a.t - b.t);
}

/**
 * Y range with headroom, never narrower than a couple of plates, so normal
 * session-to-session wobble doesn't look like a cliff.
 */
export function liftChartDomain(values: readonly number[], units: 'lb' | 'kg'): [number, number] {
  if (values.length === 0) return [0, 100];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const minSpan = units === 'lb' ? 20 : 10;
  const span = Math.max((max - min) * 1.3, minSpan);
  const mid = (min + max) / 2;
  const step = units === 'lb' ? 5 : 2.5;
  return [Math.max(0, Math.floor((mid - span / 2) / step) * step), Math.ceil((mid + span / 2) / step) * step];
}

function ChartTooltip({ active, payload, units }: RechartsTooltipProps & { units: 'lb' | 'kg' }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as unknown as LiftChartPoint;
  return (
    <div className="rounded-lg bg-card px-3 py-2 text-caption text-ink shadow-card tabular-nums">
      <p className="font-semibold">{shortDay(p.date)}</p>
      <p>Estimated max {formatWeight(p.maxKg, units)}</p>
      <p className="text-ink-2">From {p.set}</p>
    </div>
  );
}

/**
 * Estimated max over time for one lift (its own screen). A real chart with
 * dated ticks and a weight axis — the panel couldn't see a lift's trajectory
 * from a bare sparkline or first-vs-latest numbers. Loaded with next/dynamic
 * so Recharts only ships when a lift screen opens.
 */
export function LiftMaxChart({ points, units }: { points: readonly LiftTrendPoint[]; units: 'lb' | 'kg' }) {
  const data = liftChartData(points, units);
  const domain = liftChartDomain(
    data.map((d) => d.max),
    units
  );
  const first = data[0]?.t;
  const last = data[data.length - 1]?.t;
  const ticks = data.length <= 4 ? data.map((d) => d.t) : [first, data[Math.floor(data.length / 2)].t, last];
  return (
    <div
      className="h-48 text-action"
      data-testid="lift-max-chart"
      role="img"
      aria-label={`Estimated max over time: ${data.map((d) => `${shortDay(d.date)} ${d.max} ${units}`).join(', ')}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[first ?? 'auto', last ?? 'auto']}
            ticks={ticks}
            tickFormatter={(t: number) => shortDay(toDay(t))}
            stroke="#71717a"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            padding={{ left: 8, right: 8 }}
          />
          <YAxis
            domain={domain}
            stroke="#71717a"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickCount={4}
            width={56}
            tickFormatter={(v: number) => `${Math.round(v)} ${units}`}
          />
          <Tooltip content={<ChartTooltip units={units} />} />
          <Line
            type="monotone"
            dataKey="max"
            stroke="currentColor"
            strokeWidth={2.5}
            dot={{ r: 3, fill: 'currentColor', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function toDay(t: number): string {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
