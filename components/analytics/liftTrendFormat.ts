import type { LiftTrend } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { UNASSIGNED_TRACK_KEY } from '@/services/locationTracks';

/** Shared copy/colour rules for a lift's trend: Strength rows and the lift screen. */

const DIRECTION_LABEL: Record<LiftTrend['direction'], string> = {
  rising: 'Rising',
  flat: 'Flat',
  down: 'Down',
};

export const signedPct = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%/wk`;

/** "Nov 1" from a local YYYY-MM-DD day. */
export function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The lift's workouts in History (scoped to its gym when trended per gym). */
export function historyHref(lift: LiftTrend): string {
  return lift.locationLabel
    ? `/dashboard/history?exercise=${lift.exerciseId}&gym=${lift.locationId ?? UNASSIGNED_TRACK_KEY}`
    : `/dashboard/history?exercise=${lift.exerciseId}`;
}

/** The lift's own screen. `seriesKey` carries the gym track when split. */
export function liftHref(lift: Pick<LiftTrend, 'seriesKey'>): string {
  return `/dashboard/analytics/lift/${encodeURIComponent(lift.seriesKey)}`;
}

export function statusOf(lift: LiftTrend): { label: string; pill: string; stroke: string } {
  if (lift.lowConfidence) return { label: 'Calibrating', pill: 'bg-fill text-ink-2', stroke: 'stroke-ink-3' };
  if (lift.direction === 'rising') return { label: DIRECTION_LABEL.rising, pill: 'bg-status-ok-tint text-status-ok', stroke: 'stroke-status-ok' };
  if (lift.direction === 'down') return { label: DIRECTION_LABEL.down, pill: 'bg-status-warn-tint text-status-warn', stroke: 'stroke-status-warn' };
  return { label: DIRECTION_LABEL.flat, pill: 'bg-fill text-ink-2', stroke: 'stroke-ink-3' };
}
