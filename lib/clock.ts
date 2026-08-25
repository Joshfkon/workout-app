/**
 * clock — the application's single source of "now".
 *
 * WHY THIS EXISTS
 * ---------------
 * Long-horizon simulation (and any deterministic test of progression, volume,
 * recovery or staleness behaviour) needs to move the application through weeks
 * of simulated time. Every `new Date()` / `Date.now()` scattered through the
 * code is a hidden read of the wall clock, and each one pins the app to "right
 * now". This module is the seam: production reads the system clock, a harness
 * swaps in a controllable one, and the behaviour of everything downstream is
 * identical either way.
 *
 * It is deliberately dependency-free (no React, no Supabase, no date library)
 * so it is safe to import from anywhere, on server and client alike.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT `today()` MEANS — the application's timezone convention
 * ────────────────────────────────────────────────────────────────────────────
 * A "day" is a CALENDAR DAY in the RUNTIME's timezone, formatted `YYYY-MM-DD`.
 * Never a UTC day. This is the convention `lib/date/localDay.ts` already
 * documents and `lib/utils.getLocalDateString` already implements — this module
 * does not introduce a new one, it just names it and makes it swappable.
 *
 * Consequences worth stating out loud, because they are load-bearing:
 *
 *  - On the client the runtime timezone is the device's, which is what the user
 *    means by "today". In a server action it is the SERVER's — the residual
 *    day-boundary caveat already noted in `lib/date/localDay.ts`. Passing an
 *    explicit `timeZone` to `today()` resolves that ambiguity where a caller
 *    knows the user's zone; omitting it preserves today's exact behaviour.
 *  - A session logged at 11 PM local belongs to that local day, not to the
 *    following UTC day. This is precisely why weekly volume attribution has to
 *    go through this convention rather than `toISOString().slice(0,10)`.
 *  - The training week starts MONDAY (`localDay.WEEK_STARTS_ON`). That constant
 *    stays in `localDay.ts`; it is a week-bucketing rule, not a clock concern.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ADVANCING TIME (see `test-utils/clock.ts`)
 * ────────────────────────────────────────────────────────────────────────────
 * "Advance one day" is NOT +24 hours. The app's date model is calendar days in
 * the runtime zone, so a controllable clock advances days by moving the
 * calendar date and keeping the wall-clock time of day — across a DST boundary
 * that is a 23- or 25-hour jump in absolute terms, which is the correct
 * simulation of "same time tomorrow". Hours, minutes and seconds advance by
 * absolute duration, because an hour is an hour regardless of DST.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SCOPE
 * ────────────────────────────────────────────────────────────────────────────
 * Introducing the seam changes no production behaviour: the default clock is
 * the system clock and every routed call site produces byte-identical results.
 * Routing the remaining call sites (the `now` / `today` parameters on the
 * training data layer) is deliberately a separate step.
 */

/**
 * A calendar day as `YYYY-MM-DD`, in the sense defined above. Kept a plain
 * `string` alias rather than a branded type: the codebase already passes these
 * around as strings (`planned_date`, `start_day`, `scan_date`, …) and a brand
 * would force casts at every boundary for no safety we don't already get from
 * the helpers in `lib/date/localDay.ts`.
 */
export type LocalDate = string;

export interface Clock {
  /** The current instant. */
  now(): Date;
  /**
   * The current calendar day as `YYYY-MM-DD`. Omit `timeZone` for the runtime
   * zone (the application convention); pass an IANA zone name to resolve the
   * day in that zone instead.
   */
  today(timeZone?: string): LocalDate;
}

/**
 * `date` as `YYYY-MM-DD`.
 *
 * With no `timeZone` this is character-for-character what
 * `lib/utils.getLocalDateString` produces — the runtime-zone calendar day.
 * With a `timeZone` it resolves the calendar day in that IANA zone via
 * `Intl.DateTimeFormat`, reading the numeric parts by type (never by string
 * order), so the result does not depend on the ambient locale. `en-US` pins the
 * Gregorian calendar, so a locale with a non-Gregorian default can't shift it.
 */
export function localDateIn(date: Date, timeZone?: string): LocalDate {
  if (!timeZone) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The production clock: reads the host's wall clock. */
export const systemClock: Clock = {
  now: () => new Date(),
  today: (timeZone?: string) => localDateIn(new Date(), timeZone),
};

let current: Clock = systemClock;

/** The clock currently installed. Production always sees {@link systemClock}. */
export function getClock(): Clock {
  return current;
}

/**
 * Current instant. Use this instead of `new Date()` wherever the value can
 * influence application behaviour (prescription, fatigue/recovery, progression,
 * trends, staleness) or is persisted as a record timestamp. Purely visual reads
 * — animations, rest-timer readouts, relative-time labels — may keep using
 * `new Date()`; routing them buys nothing and only widens the diff.
 */
export function now(): Date {
  return current.now();
}

/** Today's calendar day, per the convention documented above. */
export function today(timeZone?: string): LocalDate {
  return current.today(timeZone);
}

/**
 * Install a different clock. **Never called from production code** — this
 * exists for the simulation harness and for tests, mirroring the
 * `__setDriverForTests` seam in `lib/offline/setOutbox.ts`.
 *
 * The installed clock is module-global, so it is shared by everything in one
 * module registry. Simulation runs therefore isolate at the PROCESS level (one
 * Jest worker = one clock); do not try to run two differently-timed simulations
 * inside a single process.
 *
 * Always pair with {@link resetClock} in an `afterEach`, or a leaked fake clock
 * will silently re-date every subsequent test in the file.
 */
export function setClock(clock: Clock): void {
  current = clock;
}

/** Restore the system clock. */
export function resetClock(): void {
  current = systemClock;
}
