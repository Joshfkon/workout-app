/**
 * Tests for the application clock seam (`lib/clock`) and the controllable
 * clock the simulation harness drives it with (`test-utils/clock`).
 *
 * Three things are under test:
 *   1. the timezone convention `today()` promises (runtime-zone calendar day,
 *      never a UTC day) and the explicit-`timeZone` escape hatch;
 *   2. the date model — days advance by CALENDAR day, hours by absolute
 *      duration, and the two disagree across a DST boundary on purpose;
 *   3. that installing a clock actually moves the app's date helpers, i.e. the
 *      seam is wired through `getLocalDateString` and the `localDay` family
 *      rather than merely existing.
 *
 * The suite runs in America/Denver (jest.config.js pins TZ) — a negative-offset
 * zone with DST, which is what makes assertions 1 and 2 meaningful.
 */
import {
  systemClock,
  getClock,
  setClock,
  resetClock,
  now,
  today,
  localDateIn,
} from '@/lib/clock';
import { ControllableClock, createTestClock } from '@/test-utils/clock';
import { getLocalDateString } from '@/lib/utils';
import {
  localDay,
  localWeekKey,
  localWeekStart,
  startOfLocalDay,
  rollingWindowStart,
} from '@/lib/date/localDay';

afterEach(resetClock);

describe('default clock', () => {
  it('is the system clock', () => {
    expect(getClock()).toBe(systemClock);
  });

  it('tracks the wall clock', () => {
    const before = Date.now();
    const t = now().getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });

  it('resetClock restores it after a swap', () => {
    setClock(createTestClock('2020-01-01'));
    expect(getClock()).not.toBe(systemClock);
    resetClock();
    expect(getClock()).toBe(systemClock);
  });
});

describe('today() timezone convention', () => {
  it('is the LOCAL calendar day, not the UTC day', () => {
    // 11 PM local on Jan 5 in Denver is Jan 6 in UTC. The whole reason this
    // convention exists is that an evening session must not move to tomorrow.
    setClock(createTestClock('2026-01-05T23:30:00'));
    expect(today()).toBe('2026-01-05');
    expect(now().toISOString().slice(0, 10)).toBe('2026-01-06');
  });

  it('resolves an explicit IANA zone when given one', () => {
    // Same instant, three zones, three different calendar days.
    const instant = new Date('2026-01-06T05:30:00Z');
    expect(localDateIn(instant, 'America/Denver')).toBe('2026-01-05');
    expect(localDateIn(instant, 'UTC')).toBe('2026-01-06');
    expect(localDateIn(instant, 'Pacific/Auckland')).toBe('2026-01-06');
  });

  it('omitting timeZone matches getLocalDateString exactly', () => {
    for (const iso of [
      '2026-01-05T00:00:00',
      '2026-01-05T23:59:59',
      '2026-03-08T02:30:00',
      '2026-11-01T01:30:00',
      '2026-12-31T18:00:00',
    ]) {
      const d = new Date(iso);
      expect(localDateIn(d)).toBe(getLocalDateString(d));
    }
  });

  it('zero-pads single-digit months and days', () => {
    setClock(createTestClock('2026-03-07T12:00:00'));
    expect(today()).toBe('2026-03-07');
  });
});

describe('ControllableClock construction', () => {
  it('parses YYYY-MM-DD as LOCAL midnight, not UTC midnight', () => {
    const clock = new ControllableClock('2026-01-05');
    expect(clock.today()).toBe('2026-01-05');
    expect(clock.now().getHours()).toBe(0);
  });

  it('parses a bare datetime as local and a Z datetime as UTC', () => {
    expect(new ControllableClock('2026-01-05T09:00:00').now().getHours()).toBe(9);
    expect(new ControllableClock('2026-01-05T09:00:00Z').now().getUTCHours()).toBe(9);
  });

  it('accepts a Date and epoch milliseconds', () => {
    const d = new Date('2026-01-05T09:00:00');
    expect(new ControllableClock(d).now().getTime()).toBe(d.getTime());
    expect(new ControllableClock(d.getTime()).now().getTime()).toBe(d.getTime());
  });

  it('does not alias the Date it was constructed from', () => {
    const d = new Date('2026-01-05T09:00:00');
    const clock = new ControllableClock(d);
    d.setFullYear(1999);
    expect(clock.today()).toBe('2026-01-05');
  });

  it('hands out a fresh Date each call, so callers cannot mutate the clock', () => {
    const clock = new ControllableClock('2026-01-05T09:00:00');
    const first = clock.now();
    first.setFullYear(1999);
    expect(clock.today()).toBe('2026-01-05');
    expect(clock.now()).not.toBe(first);
  });

  it('rejects an unparseable start value', () => {
    expect(() => new ControllableClock('not a date')).toThrow(/unparseable/);
  });
});

describe('advancement — absolute duration', () => {
  it('advances ms, seconds, minutes and hours by real elapsed time', () => {
    const clock = new ControllableClock('2026-01-05T09:00:00');
    const start = clock.nowMs();
    clock.advanceMs(500).advanceSeconds(30).advanceMinutes(3).advanceHours(2);
    expect(clock.nowMs() - start).toBe(500 + 30_000 + 180_000 + 7_200_000);
  });

  it('rolls the calendar day over when hours cross midnight', () => {
    const clock = new ControllableClock('2026-01-05T23:00:00');
    clock.advanceHours(2);
    expect(clock.today()).toBe('2026-01-06');
  });

  it('supports negative advancement', () => {
    const clock = new ControllableClock('2026-01-05T09:00:00');
    clock.advanceHours(-10);
    expect(clock.today()).toBe('2026-01-04');
  });
});

describe('advancement — calendar days (the date model)', () => {
  it('keeps the wall-clock time of day', () => {
    const clock = new ControllableClock('2026-01-05T18:30:00');
    clock.advanceDays(3);
    expect(clock.today()).toBe('2026-01-08');
    expect(clock.now().getHours()).toBe(18);
    expect(clock.now().getMinutes()).toBe(30);
  });

  it('crosses month and year boundaries', () => {
    const clock = new ControllableClock('2026-12-30T08:00:00');
    clock.advanceDays(3);
    expect(clock.today()).toBe('2027-01-02');
  });

  it('handles a leap day', () => {
    const clock = new ControllableClock('2028-02-28T08:00:00');
    clock.advanceDays(1);
    expect(clock.today()).toBe('2028-02-29');
  });

  it('advanceWeeks moves seven calendar days per week', () => {
    const clock = new ControllableClock('2026-01-05T18:30:00');
    clock.advanceWeeks(3);
    expect(clock.today()).toBe('2026-01-26');
    expect(clock.now().getHours()).toBe(18);
  });

  it('spring-forward: one day is 23 absolute hours, NOT 24', () => {
    // 2026-03-08 is the US spring-forward. An evening session "same time
    // tomorrow" is 23 hours later in absolute terms. Implementing advanceDays
    // as +24h would land at 19:30 and, repeated, would eventually walk an
    // evening session onto the wrong local day.
    const clock = new ControllableClock('2026-03-07T18:30:00');
    const before = clock.nowMs();
    clock.advanceDays(1);
    expect(clock.today()).toBe('2026-03-08');
    expect(clock.now().getHours()).toBe(18);
    expect(clock.nowMs() - before).toBe(23 * 3_600_000);
  });

  it('fall-back: one day is 25 absolute hours, NOT 24', () => {
    const clock = new ControllableClock('2026-10-31T18:30:00');
    const before = clock.nowMs();
    clock.advanceDays(1);
    expect(clock.today()).toBe('2026-11-01');
    expect(clock.now().getHours()).toBe(18);
    expect(clock.nowMs() - before).toBe(25 * 3_600_000);
  });

  it('advancing across a DST boundary a day at a time never skips or repeats a day', () => {
    const clock = new ControllableClock('2026-03-05T18:30:00');
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push(clock.today());
      clock.advanceDays(1);
    }
    expect(seen).toEqual([
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
  });

  it('a nonexistent spring-forward wall time still advances exactly one calendar day', () => {
    // 02:30 on 2026-03-08 does not exist in Denver; the runtime normalises it.
    // The clock promises the calendar day, not the surviving time of day.
    const clock = new ControllableClock('2026-03-07T02:30:00');
    clock.advanceDays(1);
    expect(clock.today()).toBe('2026-03-08');
  });
});

describe('absolute positioning', () => {
  it('set() jumps to an explicit instant', () => {
    const clock = new ControllableClock('2026-01-05');
    clock.set('2026-06-15T07:45:00');
    expect(clock.today()).toBe('2026-06-15');
    expect(clock.now().getHours()).toBe(7);
  });

  it('setTimeOfDay() moves within the current calendar day', () => {
    const clock = new ControllableClock('2026-01-05T09:00:00');
    clock.setTimeOfDay(21, 15);
    expect(clock.today()).toBe('2026-01-05');
    expect(clock.now().getHours()).toBe(21);
    expect(clock.now().getMinutes()).toBe(15);
  });
});

describe('the seam is actually wired into the app date helpers', () => {
  it('getLocalDateString() follows the installed clock', () => {
    setClock(createTestClock('2026-04-20T14:00:00'));
    expect(getLocalDateString()).toBe('2026-04-20');
  });

  it('an explicit argument still wins over the clock', () => {
    setClock(createTestClock('2026-04-20T14:00:00'));
    expect(getLocalDateString(new Date('2026-08-01T10:00:00'))).toBe('2026-08-01');
  });

  it('localDay() follows the installed clock', () => {
    setClock(createTestClock('2026-04-20T14:00:00'));
    expect(localDay()).toBe('2026-04-20');
  });

  it('startOfLocalDay() follows the installed clock', () => {
    setClock(createTestClock('2026-04-20T14:00:00'));
    const start = startOfLocalDay();
    expect(localDay(start)).toBe('2026-04-20');
    expect(start.getHours()).toBe(0);
  });

  it('localWeekStart()/localWeekKey() follow the clock and still start on Monday', () => {
    // 2026-04-20 is a Monday; 2026-04-24 is the Friday of the same week.
    setClock(createTestClock('2026-04-24T14:00:00'));
    expect(localWeekKey()).toBe('2026-04-20');
    expect(localWeekStart().getDay()).toBe(1);
  });

  it('rollingWindowStart() follows the clock and anchors to local midnight', () => {
    setClock(createTestClock('2026-04-24T23:45:00'));
    const start = rollingWindowStart(7);
    expect(localDay(start)).toBe('2026-04-18');
    expect(start.getHours()).toBe(0);
  });

  it('the window is stable across the day — the relaunch-invariance property', () => {
    const clock = createTestClock('2026-04-24T00:00:01');
    setClock(clock);
    const atMidnight = rollingWindowStart(7).getTime();
    clock.advanceHours(23);
    expect(rollingWindowStart(7).getTime()).toBe(atMidnight);
  });

  it('advancing a week moves the week key by exactly one week', () => {
    const clock = createTestClock('2026-04-22T10:00:00');
    setClock(clock);
    expect(localWeekKey()).toBe('2026-04-20');
    clock.advanceWeeks(1);
    expect(localWeekKey()).toBe('2026-04-27');
  });

  it('a late-evening session and the next morning bucket into different days', () => {
    // The weekly-volume attribution case called out in lib/clock.ts.
    const clock = createTestClock('2026-04-24T23:30:00');
    setClock(clock);
    const evening = getLocalDateString();
    clock.advanceHours(1);
    expect(getLocalDateString()).not.toBe(evening);
    expect(getLocalDateString()).toBe('2026-04-25');
  });

  it('Sunday still belongs to the week that started the previous Monday', () => {
    // 2026-04-26 is a Sunday. With a Monday week start it must key to 04-20,
    // not to itself — the boundary that a Sunday-start implementation gets
    // wrong and that six months of simulated weeks would amplify.
    setClock(createTestClock('2026-04-26T20:00:00'));
    expect(localWeekKey()).toBe('2026-04-20');
  });
});

describe('production behaviour is unchanged by the seam', () => {
  it('the system clock produces the same value the raw wall clock would', () => {
    // Guards the one thing this refactor must not break: with no clock
    // installed, every routed helper is byte-identical to `new Date()`.
    const direct = new Date();
    const viaSeam = getLocalDateString();
    const expected = `${direct.getFullYear()}-${String(direct.getMonth() + 1).padStart(2, '0')}-${String(direct.getDate()).padStart(2, '0')}`;
    expect(viaSeam).toBe(expected);
    expect(systemClock.today()).toBe(expected);
    expect(localDay()).toBe(expected);
  });
});
