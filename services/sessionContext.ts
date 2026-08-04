/**
 * SESSION CONTEXT — the circumstances a past session was performed under.
 *
 * A logged set is a number plus the state the lifter was in when they hit it.
 * Two of those circumstances are already recorded elsewhere in the app and just
 * need joining up at display time:
 *
 *   - TIME OF DAY: `set_logs.logged_at` is stamped client-side the moment a set
 *     is logged, so the first working set of an exercise dates that exercise
 *     within the session far more precisely than the session's `completed_at`.
 *   - SLEEP: `sleep_log` holds one entry per LOCAL day, logged against the
 *     morning the night ended (see supabase/migrations/…_sleep_log.sql). So the
 *     night before a session on local day D is the entry for local day D.
 *
 * Pure — no DB, no React. Callers pass timestamps in.
 */

import { localDay, addLocalDays } from '@/lib/date/localDay';

/**
 * Sessions starting before this LOCAL hour belong to the previous day's night.
 *
 * Someone training at 1am has not yet slept the night that `sleep_log` will
 * record against today's date — their most recent completed night is
 * yesterday's entry. Without this, a 1am session reads the sleep of the night
 * that came AFTER it (or, more often, shows nothing because that entry didn't
 * exist yet when the set was logged).
 */
export const OVERNIGHT_SESSION_CUTOFF_HOUR = 4;

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The `sleep_log.local_day` whose entry is "the night before" a session that
 * started at `startedAt`. Null when the timestamp is missing or unparseable —
 * callers render no sleep line rather than guessing a day.
 */
export function sleepDayForSession(startedAt: string | Date | null | undefined): string | null {
  const date = toDate(startedAt);
  if (!date) return null;
  const day = localDay(date);
  return date.getHours() < OVERNIGHT_SESSION_CUTOFF_HOUR ? addLocalDays(day, -1) : day;
}

/**
 * Wall-clock time of day ("6:42 PM") in the viewer's timezone, or null when the
 * timestamp is missing/unparseable.
 *
 * Note this renders in the VIEWER's current timezone, not the timezone the set
 * was logged in — a set logged at 6pm local then reviewed three timezones away
 * shows the shifted hour. Storing an offset per set would be the fix; until
 * then this is right for the overwhelmingly common case (training and reviewing
 * in one place).
 */
export function formatSessionTimeOfDay(
  startedAt: string | Date | null | undefined,
  locale: string = 'en-US'
): string | null {
  const date = toDate(startedAt);
  if (!date) return null;
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Earliest timestamp among a session's sets for one exercise — when that
 * exercise was actually worked, which in a long session can be an hour or more
 * after the session started. Falls back through the caller-supplied session
 * timestamps so a session logged before per-set stamps existed still resolves.
 */
export function resolveExerciseStartedAt(
  setTimestamps: (string | null | undefined)[],
  sessionStartedAt?: string | null,
  sessionCompletedAt?: string | null
): string | null {
  let earliest: { iso: string; ms: number } | null = null;
  for (const iso of setTimestamps) {
    const date = toDate(iso);
    if (!date) continue;
    const ms = date.getTime();
    if (!earliest || ms < earliest.ms) earliest = { iso: iso as string, ms };
  }
  if (earliest) return earliest.iso;
  return toDate(sessionStartedAt) ? sessionStartedAt! : toDate(sessionCompletedAt) ? sessionCompletedAt! : null;
}
