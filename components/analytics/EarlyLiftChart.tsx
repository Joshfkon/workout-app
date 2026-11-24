'use client';

import { MIN_SESSIONS_FOR_TREND, type EarlyLiftPoint } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { parseLocalDay } from '@/lib/date/localDay';
import { setLabel } from './liftTrendFormat';

/** "Nov 18" from a local day (or an ISO timestamp's date part). */
export function shortDay(date: string): string {
  const d = parseLocalDay(date.slice(0, 10));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The chart's accessible summary: each workout's best set, then what's next. */
export function earlyLiftChartLabel(name: string, points: readonly EarlyLiftPoint[], units: 'lb' | 'kg'): string {
  const sets = points.map((p) => `${shortDay(p.date)}: ${setLabel(p.weightKg, p.topSetReps, units)}`).join('; ');
  const left = Math.max(0, MIN_SESSIONS_FOR_TREND - points.length);
  const next = left > 0 ? ` A trend line appears after ${MIN_SESSIONS_FOR_TREND} workouts (${left} more).` : '';
  return `${name}, best set per workout. ${sets}.${next}`;
}

const W = 300;
const H = 64;
const PAD_X = 24;
const TOP = 10;
const BOTTOM = 34;

/**
 * A lift's first one or two workouts as a small chart: one dot per workout
 * (its best set's estimated max), joined when there are two, and a dashed
 * empty slot for the workout that unlocks the trend. Before this a lift with
 * fewer than 3 workouts had no chart at all, only text (UX panel r22, Maya:
 * "only a basic comparison and no chart").
 */
export function EarlyLiftChart({
  points,
  units,
  name,
}: {
  points: readonly EarlyLiftPoint[];
  units: 'lb' | 'kg';
  name: string;
}) {
  const shown = points.slice(-(MIN_SESSIONS_FOR_TREND - 1));
  if (shown.length === 0) return null;
  const slots = MIN_SESSIONS_FOR_TREND;
  const x = (i: number) => PAD_X + (i * (W - PAD_X * 2)) / (slots - 1);
  const values = shown.map((p) => p.e1rmKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  // Equal values (or one workout) sit mid-height rather than on an edge.
  const y = (v: number) => (span > 0 ? TOP + (1 - (v - min) / span) * (BOTTOM - TOP) : (TOP + BOTTOM) / 2);
  const ghostIndex = shown.length;
  return (
    <figure className="mt-1" data-testid="early-lift-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={earlyLiftChartLabel(name, shown, units)}
      >
        {shown.length === 2 && (
          <line
            x1={x(0)}
            y1={y(values[0])}
            x2={x(1)}
            y2={y(values[1])}
            strokeWidth={2}
            strokeLinecap="round"
            className="stroke-action"
          />
        )}
        {ghostIndex < slots && (
          <>
            <line
              x1={x(ghostIndex - 1)}
              y1={y(values[values.length - 1])}
              x2={x(ghostIndex)}
              y2={(TOP + BOTTOM) / 2}
              strokeWidth={1.5}
              strokeDasharray="3 4"
              className="stroke-ink-3"
            />
            <circle cx={x(ghostIndex)} cy={(TOP + BOTTOM) / 2} r={5} fill="none" strokeWidth={1.5} strokeDasharray="2 2" className="stroke-ink-3" />
          </>
        )}
        {shown.map((p, i) => (
          <circle key={`${p.date}-${i}`} cx={x(i)} cy={y(p.e1rmKg)} r={5} className="fill-action" data-testid="early-lift-chart-point" />
        ))}
        {shown.map((p, i) => (
          <text key={`l-${p.date}-${i}`} x={x(i)} y={BOTTOM + 14} textAnchor="middle" fontSize={11} className="fill-ink-2">
            {setLabel(p.weightKg, p.topSetReps, units)}
          </text>
        ))}
        {shown.map((p, i) => (
          <text key={`d-${p.date}-${i}`} x={x(i)} y={BOTTOM + 27} textAnchor="middle" fontSize={10} className="fill-ink-3">
            {shortDay(p.date)}
          </text>
        ))}
        {ghostIndex < slots && (
          <text x={x(ghostIndex)} y={BOTTOM + 14} textAnchor="middle" fontSize={11} className="fill-ink-3">
            Trend after {slots}
          </text>
        )}
      </svg>
    </figure>
  );
}
