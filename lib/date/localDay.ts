/**
 * localDay — the single source of truth for how the app buckets time into
 * "days" and "weeks" in the USER'S LOCAL timezone.
 *
 * Why this module exists
 * ----------------------
 * Dashboard cards were each defining "today" and "this week" independently.
 * Some used `getLocalDateString()` (local), some used `new Date().toISOString()`
 * (UTC instant), some anchored a rolling window to the current wall-clock
 * instant (so the window slid every second and a force-quit/relaunch recomputed
 * a *different* window with the same underlying data — the 71→87 Weekly Volume
 * bug). Routing every card through this module makes bucketing:
 *
 *   1. LOCAL   — a "day" is a calendar day in the viewer's timezone, never UTC.
 *   2. STABLE  — a window depends only on WHICH local day it is computed on, not
 *                on the time of day. Two computations on the same local day with
 *                the same input data return byte-identical results. This is what
 *                makes card values relaunch-invariant.
 *   3. SHARED  — a card and its detail page import the same helper, so the number
 *                the user taps is the number they land on.
 *
 * Everything here is pure (no React, no Supabase) and safe on both server and
 * client. NOTE: "local" resolves to the RUNTIME's timezone. On the client that
 * is the device timezone (correct). In a server action it is the server's
 * timezone — see docs/ note in fix-date-handling/CARDS.md about the residual
 * server-vs-device day-boundary caveat for server-seeded initial data.
 *
 * "NOW" COMES FROM `lib/clock`. Every helper below still takes an explicit
 * `date`; only the DEFAULT reads the clock, via `clockNow()` instead of
 * `new Date()`. In production that is the system clock and the output is
 * byte-identical to before. A simulation installs a controllable clock
 * (`setClock`) and every zero-argument call here moves with simulated time —
 * which is what lets a six-month simulated run bucket its days and weeks the
 * way the real app would have.
 */
import { now as clockNow } from '@/lib/clock';

/**
 * Day the training week starts on, as a JS `Date.getDay()` value
 * (0 = Sunday, 1 = Monday, … 6 = Saturday).
 *
 * MONDAY (1) is the documented, explicit constant for the whole app: it matches
 * the ISO-8601 week, the mesocycle/deload cadence, and the "this week" framing
 * users expect from a training log. Change this in ONE place and every
 * `localWeekKey` / `localWeekStart` consumer moves together — that single-source
 * property is the entire point, so do not hard-code a different week start
 * anywhere else.
 */
export const WEEK_STARTS_ON = 1 as const; // Monday

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Local calendar day as `YYYY-MM-DD` (viewer timezone). Identical output to
 * `lib/utils.getLocalDateString`; re-exported here so callers can depend on the
 * localDay module alone for all bucketing.
 */
export function localDay(date: Date = clockNow()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Midnight (00:00:00.000) at the start of `date`'s local calendar day. */
export function startOfLocalDay(date: Date = clockNow()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Midnight at the start of the local calendar week containing `date`, using
 * {@link WEEK_STARTS_ON}. e.g. with Monday start, any moment Mon–Sun maps back
 * to that week's Monday 00:00 local.
 */
export function localWeekStart(date: Date = clockNow()): Date {
  const start = startOfLocalDay(date);
  // Days elapsed since the most recent week-start day (0..6).
  const offset = (start.getDay() - WEEK_STARTS_ON + 7) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

/**
 * Stable identity for "the local week containing `date`": the `YYYY-MM-DD` of
 * that week's start day. Two timestamps in the same local week always produce
 * the same key regardless of time of day — use it to group entries into weeks,
 * compare "is this the current week", and key caches without any UTC drift.
 */
export function localWeekKey(date: Date = clockNow()): string {
  return localDay(localWeekStart(date));
}

/**
 * Start instant of a trailing N-day window (default 7) anchored to the START of
 * the local day — NOT to the current wall-clock instant. "Rolling 7 days
 * including today" therefore means `[startOfLocalDay(today) - 6 days,  now]`,
 * and the lower bound is constant for the whole local day.
 *
 * This is the window the Weekly Volume / atrophy card and its detail view use.
 * Anchoring to local midnight (instead of `new Date()` at query time) is what
 * makes the set count identical across a force-quit/relaunch on the same day:
 * the query's lower bound no longer depends on the minute you happened to open
 * the app.
 */
export function rollingWindowStart(days = 7, date: Date = clockNow()): Date {
  const start = startOfLocalDay(date);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

/** {@link rollingWindowStart} serialized as an ISO string for DB range filters. */
export function rollingWindowStartISO(days = 7, date: Date = clockNow()): string {
  return rollingWindowStart(days, date).toISOString();
}

/** Number of whole local days between two dates (b - a), by calendar day. */
export function localDaysBetween(a: Date, b: Date): number {
  return Math.round((startOfLocalDay(b).getTime() - startOfLocalDay(a).getTime()) / DAY_MS);
}

// === localDay STRING helpers ===
//
// Entities that store days as `YYYY-MM-DD` strings (weight_log.logged_at,
// dexa_scans.scan_date, training_phases.start_day/end_day) need day arithmetic
// without ever round-tripping through UTC. Parsing with `new Date('YYYY-MM-DD')`
// is the classic bug: the spec makes that UTC midnight, which is the PREVIOUS
// local day in negative-offset timezones. These helpers pin parsing to local
// midnight so `parse → format` is always the identity.

/** Parse a `YYYY-MM-DD` localDay string to local midnight of that day. */
export function parseLocalDay(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** `day + days` as a localDay string (days may be negative). */
export function addLocalDays(day: string, days: number): string {
  const date = parseLocalDay(day);
  date.setDate(date.getDate() + days);
  return localDay(date);
}

/** Whole calendar days from localDay string `a` to `b` (b − a). */
export function localDaysBetweenDays(a: string, b: string): number {
  return localDaysBetween(parseLocalDay(a), parseLocalDay(b));
}
