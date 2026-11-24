import {
  MIN_SESSIONS_FOR_TREND,
  type EarlyLift,
  type LiftNotEnoughData,
  type LiftTrend,
  type LiftTrendPoint,
} from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { UNASSIGNED_TRACK_KEY } from '@/services/locationTracks';
import { formatWeight } from '@/lib/utils';
import { formatLoad } from '@/lib/mcp/summaries';
import { MIN_TREND_SPAN_DAYS } from '@/services/plateauDetector';
import { E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS, E1RM_MAX_EFFECTIVE_REPS, rirForE1RM } from '@/services/shared/e1rm';

/** Shared copy/colour rules for a lift's trend: Strength rows and the lift screen. */

const DIRECTION_LABEL: Record<LiftTrend['direction'], string> = {
  rising: 'Rising',
  flat: 'Flat',
  down: 'Down',
};

/**
 * A lift's weekly change in plain words: "+1.2% per week" (UX panel r20:
 * "%/wk" read as jargon to a beginner). Only for a REAL rate — a lift with
 * `notEnoughData` shows notEnoughDataLine instead.
 */
export const signedPct = (n: number) =>
  // A real rate that rounds to zero reads "no change", not "0.0% per week",
  // which looked like missing data (UX panel r20/r21).
  Math.abs(n) < 0.05 ? 'no change per week' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}% per week`;

/**
 * What counts toward a trend, in the user's terms (UX panel r20: "I couldn't
 * tell what counts as a workout"). The thresholds come from the code that
 * applies them.
 */
export const TREND_RULE =
  `A trend needs the lift in at least ${MIN_SESSIONS_FOR_TREND} workouts, spread over at least ${MIN_TREND_SPAN_DAYS} days, ` +
  `so one good or bad day can't fake a change.`;

/** What counts as "a workout" for a lift's trend. */
export const WORKOUT_COUNTS_RULE =
  'Any workout where you log the lift counts. All its sets in one workout count once.';

/**
 * The short "not enough data" line a lift row shows instead of a 0.0% rate:
 * "Not enough data yet · 1 more workout on or after Dec 4". `today` is a
 * local YYYY-MM-DD day.
 */
export function notEnoughDataLine(nd: LiftNotEnoughData, today: string): string {
  if (nd.reason === 'short_span' && nd.readyOn && nd.readyOn > today) {
    return `Not enough data yet · ${moreWorkouts(nd.workoutsNeeded)} on or after ${shortDay(nd.readyOn)}`;
  }
  return `Not enough data yet · ${moreWorkouts(nd.workoutsNeeded)}`;
}

/**
 * Why there's no rate yet, in plain words, for the lift's own screen:
 * "Your 3 workouts with this lift were all on the same day. …"
 */
export function notEnoughDataWhy(nd: LiftNotEnoughData, sessions: number): string {
  const count = `${sessions} workout${sessions === 1 ? '' : 's'}`;
  if (nd.reason === 'short_span') {
    const spread =
      nd.spanDays === 0
        ? `were all on the same day`
        : `are only ${nd.spanDays} day${nd.spanDays === 1 ? '' : 's'} apart`;
    return `Your ${count} with this lift ${spread}, too close together to say whether it's going up. ${TREND_RULE}`;
  }
  return `Some of your ${count} with this lift can't be used for a trend yet (an outlier, or a reset after an equipment change). ${TREND_RULE}`;
}

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
  if (lift.lowConfidence) return { label: 'Rebuilding', pill: 'bg-fill text-ink-2', stroke: 'stroke-ink-3' };
  if (lift.notEnoughData) return { label: 'Too early', pill: 'bg-fill text-ink-2', stroke: 'stroke-ink-3' };
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
  const head = `Estimated max ${formatWeight(e1rmKg, units)}`;
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
 * one, in plain words: "Log Squat in 1 more workout to see if it's going up." Null
 * when there is no not-yet-trended lift.
 */
export function nextTrendHint(earlyLifts: readonly EarlyLift[] | null | undefined): string | null {
  if (!earlyLifts || earlyLifts.length === 0) return null;
  const closest = earlyLifts.reduce((a, b) => (b.sessions > a.sessions ? b : a));
  const n = workoutsUntilTrend(closest.sessions);
  if (n === 0) return null;
  return `Log ${closest.name} in ${moreWorkouts(n)} to see if it's going up.`;
}

/**
 * How est. max is worked out, in plain words. Mirrors
 * services/shared/e1rm (`estimateE1RM`): Brzycki on reps + reps left,
 * clamped at 12, no estimate past 15.
 */
export const EST_MAX_METHOD =
  `Estimated max uses the Brzycki formula: weight × 36 ÷ (37 − reps to failure). ` +
  `Reps to failure = the reps you did plus the reps you had left, read from the RIR (or RPE) you logged; ` +
  `a set with no effort logged counts as taken to failure. ` +
  `Past ${E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS} reps to failure it counts ${E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS}, ` +
  `and past ${E1RM_MAX_EFFECTIVE_REPS} it makes no estimate. ` +
  `Counting the reps you had left is why it reads higher than a plain reps-to-max calculator.`;

/**
 * The method worked through on one of the user's own sets:
 * "Your best set: 180 lbs × 10 with ~2 left ≈ 12 reps to failure → est. max 260.0 lbs."
 * The estimate printed is the stored one (the trend's own number), and the
 * reps-to-failure is the same count the estimator used (`rirForE1RM`). Null
 * without a loaded rep set. A point persisted before its RPE was carried
 * (`topSetRpe` undefined) gets no reps-left clause rather than a guessed one.
 */
export function estMaxExample(
  point: Pick<LiftTrendPoint, 'e1rmKg' | 'topSetWeightKg' | 'topSetReps' | 'topSetRpe'> | null | undefined,
  units: 'lb' | 'kg',
  lead = 'Your best set'
): string | null {
  if (!point || !(point.topSetWeightKg > 0) || !(point.topSetReps > 0) || !(point.e1rmKg > 0)) return null;
  const set = setLabel(point.topSetWeightKg, point.topSetReps, units);
  const max = `estimated max ${formatWeight(point.e1rmKg, units)}`;
  if (point.topSetRpe === undefined) return `${lead}: ${set} → ${max}.`;
  const left = rirForE1RM(point.topSetRpe);
  const toFailure = point.topSetReps + left;
  const counted = Math.min(toFailure, E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS);
  const leftPart = left > 0 ? ` with ~${left} left` : ' taken to failure';
  const capPart = counted < toFailure ? `, counted as ${counted}` : '';
  return `${lead}: ${set}${leftPart} ≈ ${toFailure} reps to failure${capPart} → ${max}.`;
}

/**
 * The point to work the example on: the highest est. max among the lifts'
 * latest sets (the numbers the rows show).
 */
export function exampleSetPoint(lifts: readonly Pick<LiftTrend, 'history'>[]): LiftTrendPoint | null {
  let best: LiftTrendPoint | null = null;
  for (const l of lifts) {
    const p = l.history[l.history.length - 1];
    if (p && p.topSetWeightKg > 0 && p.topSetReps > 0 && (!best || p.e1rmKg > best.e1rmKg)) best = p;
  }
  return best;
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

/** A lift's display name; per-gym tracks carry their gym ("Leg Press (Home)"). */
function trendName(lift: Pick<LiftTrend, 'name' | 'locationLabel'>): string {
  return lift.locationLabel ? `${lift.name} (${lift.locationLabel})` : lift.name;
}

/** "Bench Press, Barbell Row, Hack Squat (+2 more)" — at most `max` names. */
export function shortNameList(names: readonly string[], max = 3): string {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} (+${names.length - max} more)` : shown;
}

/**
 * Which lifts are behind the "N of M rising" count, by name — confident
 * lifts only, the same set the counts use. Panel finding (6/6): "The
 * strength summary only gives a count of lifts rising, not which lifts."
 * e.g. "Rising: Bench Press, Barbell Row, Hack Squat (+2 more). Slipping: Squat."
 * Null when no lift is rising or slipping (flat-only says nothing new).
 */
export function risingSlippingNames(
  lifts: readonly Pick<LiftTrend, 'name' | 'locationLabel' | 'direction' | 'lowConfidence'>[]
): string | null {
  const confident = lifts.filter((l) => !l.lowConfidence);
  const rising = confident.filter((l) => l.direction === 'rising').map(trendName);
  const down = confident.filter((l) => l.direction === 'down').map(trendName);
  const parts: string[] = [];
  if (rising.length > 0) parts.push(`Rising: ${shortNameList(rising)}.`);
  if (down.length > 0) parts.push(`Slipping: ${shortNameList(down)}.`);
  return parts.length > 0 ? parts.join(' ') : null;
}
