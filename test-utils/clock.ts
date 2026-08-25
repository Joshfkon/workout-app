/**
 * ControllableClock — a {@link Clock} whose "now" only moves when you move it.
 *
 * Lives in `test-utils/` rather than `lib/` on purpose: it is harness and test
 * machinery, and keeping it out of `lib/clock.ts` keeps it out of any bundle
 * that imports the production seam.
 *
 * Usage:
 *
 *   const clock = new ControllableClock('2026-01-05T09:00:00');
 *   setClock(clock);
 *   afterEach(resetClock);
 *
 *   clock.advanceDays(2);   // same wall-clock time, two calendar days later
 *   clock.advanceMinutes(3) // rest between sets
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DATE MODEL — why days and hours advance differently
 * ────────────────────────────────────────────────────────────────────────────
 * The app buckets time into CALENDAR days in the runtime timezone (see
 * `lib/clock.ts`). So:
 *
 *  - `advanceDays(n)` / `advanceWeeks(n)` move the CALENDAR date and keep the
 *    wall-clock time of day. Across a DST boundary that is 23 or 25 hours in
 *    absolute terms — which is exactly what "same time tomorrow" means to a
 *    lifter, and what the app's day/week bucketing assumes. Implementing it as
 *    +24h would silently shift the time of day by an hour twice a year, and an
 *    evening session would start landing on the wrong local day.
 *  - `advanceHours` / `advanceMinutes` / `advanceSeconds` / `advanceMs` move by
 *    ABSOLUTE duration. An hour is an hour; rest periods and session durations
 *    are real elapsed time, not calendar arithmetic.
 *
 * Spring-forward caveat: `advanceDays` can land on a wall-clock time that does
 * not exist in the runtime zone (02:30 on the spring-forward day). The runtime
 * normalises it forward, as JS `Date.setDate` always has. The calendar day
 * still advances by exactly one, which is the property everything downstream
 * depends on; the clock makes no promise about the surviving time of day in
 * that one case.
 */
import type { Clock, LocalDate } from '@/lib/clock';
import { localDateIn } from '@/lib/clock';

/**
 * Accepted start values:
 *  - a `Date`
 *  - `'YYYY-MM-DD'` — LOCAL midnight of that day (never UTC midnight; parsing
 *    a bare date string with `new Date()` is the classic off-by-one-day bug in
 *    negative-offset zones)
 *  - any other string — handed to `new Date()` as-is, so
 *    `'2026-01-05T09:00:00'` is 9 AM local and `'2026-01-05T09:00:00Z'` is 9 AM
 *    UTC, per the usual JS rules
 *  - epoch milliseconds
 */
export type ClockStart = Date | string | number;

function parseStart(start: ClockStart): Date {
  if (start instanceof Date) return new Date(start.getTime());
  if (typeof start === 'number') return new Date(start);
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    const [y, m, d] = start.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const parsed = new Date(start);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`ControllableClock: unparseable start value ${JSON.stringify(start)}`);
  }
  return parsed;
}

export class ControllableClock implements Clock {
  private current: Date;

  constructor(start: ClockStart = new Date()) {
    this.current = parseStart(start);
  }

  now(): Date {
    // A fresh Date every call: handing out the internal instance would let a
    // caller mutate the clock through it (Date is mutable), and an engine that
    // stashed the reference would see it change under them on the next advance.
    return new Date(this.current.getTime());
  }

  today(timeZone?: string): LocalDate {
    return localDateIn(this.current, timeZone);
  }

  /** Epoch milliseconds — the `Date.now()` equivalent. */
  nowMs(): number {
    return this.current.getTime();
  }

  // --- absolute-duration advancement -------------------------------------

  advanceMs(ms: number): this {
    this.current = new Date(this.current.getTime() + ms);
    return this;
  }

  advanceSeconds(seconds: number): this {
    return this.advanceMs(seconds * 1000);
  }

  advanceMinutes(minutes: number): this {
    return this.advanceMs(minutes * 60_000);
  }

  advanceHours(hours: number): this {
    return this.advanceMs(hours * 3_600_000);
  }

  // --- calendar advancement ----------------------------------------------

  /** Move `days` calendar days, preserving the wall-clock time of day. */
  advanceDays(days: number): this {
    const next = new Date(this.current.getTime());
    next.setDate(next.getDate() + days);
    this.current = next;
    return this;
  }

  /** Move `weeks` calendar weeks (7 calendar days each). */
  advanceWeeks(weeks: number): this {
    return this.advanceDays(weeks * 7);
  }

  // --- absolute positioning ----------------------------------------------

  /** Jump to an explicit instant. */
  set(instant: ClockStart): this {
    this.current = parseStart(instant);
    return this;
  }

  /** Jump to a wall-clock time on the current calendar day (24h, local). */
  setTimeOfDay(hours: number, minutes = 0, seconds = 0, ms = 0): this {
    const next = new Date(this.current.getTime());
    next.setHours(hours, minutes, seconds, ms);
    this.current = next;
    return this;
  }
}

/** Convenience: a clock started at `start`. */
export function createTestClock(start?: ClockStart): ControllableClock {
  return new ControllableClock(start);
}
