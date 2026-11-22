import {
  MIN_SESSIONS_FOR_TREND,
  type EarlyLift,
  type LiftTrend,
} from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { UNASSIGNED_TRACK_KEY } from '@/services/locationTracks';
import { formatWeight } from '@/lib/utils';
import { formatLoad } from '@/lib/mcp/summaries';

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

/**
 * A load that was actually lifted, exact (formatLoad — never rounded to a
 * plate step), with the app's "lbs" suffix. Estimates use formatWeight.
 */
export function loggedLoad(weightKg: number, units: 'lb' | 'kg'): string {
  const exact = formatLoad(weightKg, units);
  return units === 'lb' ? exact.replace(/ lb$/, ' lbs') : exact;
}

/** One logged set as "185 lbs × 8"; a no-load set as "6 reps". */
export function setLabel(weightKg: number, reps: number, units: 'lb' | 'kg'): string {
  return weightKg > 0 ? `${loggedLoad(weightKg, units)} × ${reps}` : `${reps} reps`;
}

/**
 * "Est. max 225 lbs (from 185 lbs × 8)": the estimated one-rep max, labelled
 * as an estimate, with the set it was worked out from when that set is known
 * (summaries persisted before points carried their top set have none).
 */
export function estMaxLabel(
  e1rmKg: number,
  topSet: { weightKg?: number | null; reps?: number | null } | null | undefined,
  units: 'lb' | 'kg'
): string {
  const head = `Est. max ${formatWeight(e1rmKg, units)}`;
  const w = topSet?.weightKg ?? 0;
  // Modality-safe: lift trends skip duration_based exercises (liftTrends.ts),
  // and an est. max only exists for rep-counted lifts.
  const r = topSet?.reps ?? 0;
  return w > 0 && r > 0 ? `${head} (from ${setLabel(w, r, units)})` : head;
}

/** Workouts with this lift still needed before its trend appears. */
export function workoutsUntilTrend(sessions: number): number {
  return Math.max(0, MIN_SESSIONS_FOR_TREND - sessions);
}

/** "1 more workout" / "2 more workouts". */
export function moreWorkouts(n: number): string {
  return `${n} more workout${n === 1 ? '' : 's'}`;
}

/**
 * The one concrete next step toward a first trend, for the lift closest to
 * one: "Log Barbell Back Squat in 1 more workout to see its trend." Null
 * when there is no not-yet-trended lift.
 */
export function nextTrendHint(earlyLifts: readonly EarlyLift[] | null | undefined): string | null {
  if (!earlyLifts || earlyLifts.length === 0) return null;
  const closest = earlyLifts.reduce((a, b) => (b.sessions > a.sessions ? b : a));
  const n = workoutsUntilTrend(closest.sessions);
  if (n === 0) return null;
  return `Log ${closest.name} in ${moreWorkouts(n)} to see its trend.`;
}

/**
 * First vs latest session's top set for a lift without a trend yet:
 * "First 185 lbs × 8 → latest 195 lbs × 8". Weight actually lifted, not an
 * estimate. Null with one session, or for a summary persisted before the
 * first/latest sets were recorded.
 */
export function earlyLiftChange(lift: EarlyLift, units: 'lb' | 'kg'): string | null {
  if (lift.sessions < 2) return null;
  const { firstWeightKg, firstReps, latestWeightKg, latestReps } = lift;
  if (firstWeightKg == null || firstReps == null || latestWeightKg == null || latestReps == null) return null;
  return `First ${setLabel(firstWeightKg, firstReps, units)} → latest ${setLabel(latestWeightKg, latestReps, units)}`;
}
