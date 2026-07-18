/**
 * localDay STRING helper tests, including the naive-UTC regression cases.
 *
 * The TZ is forced to a negative-offset zone (America/Denver) BEFORE the
 * module is required, so the "11 PM local crosses UTC midnight" cases below
 * genuinely fail under any implementation that routes through
 * toISOString()/Date('YYYY-MM-DD') UTC parsing. If the platform ignores the
 * runtime TZ change the suite skips rather than asserting the wrong thing.
 */

process.env.TZ = 'America/Denver';

// Required (not imported) so the TZ assignment above precedes module load —
// ES imports would hoist over it.
const {
  localDay,
  parseLocalDay,
  addLocalDays,
  localDaysBetweenDays,
} = require('@/lib/date/localDay');

// July: Denver is UTC-6, so offset > 0 confirms the TZ took effect.
const tzApplied = new Date(2026, 6, 17, 12).getTimezoneOffset() > 0;
const describeTz = tzApplied ? describe : describe.skip;

describeTz('localDay in a negative-offset timezone (UTC-crossing regression)', () => {
  it('keeps an 11 PM local weigh-in on its local day, not the next UTC day', () => {
    const elevenPmLocal = new Date(2026, 6, 17, 23, 0);
    // Naive UTC handling stores the NEXT day for this instant:
    expect(elevenPmLocal.toISOString().slice(0, 10)).toBe('2026-07-18');
    // localDay must not:
    expect(localDay(elevenPmLocal)).toBe('2026-07-17');
  });

  it('parseLocalDay pins YYYY-MM-DD to LOCAL midnight (UTC parse is off by one)', () => {
    const parsed = parseLocalDay('2026-07-18');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(6);
    expect(parsed.getDate()).toBe(18);
    expect(parsed.getHours()).toBe(0);
    // The classic bug this guards against: spec-parsing the same string is
    // UTC midnight, which is still the PREVIOUS local day in Denver.
    expect(localDay(new Date('2026-07-18'))).toBe('2026-07-17');
  });

  it('localDay(parseLocalDay(d)) is the identity for every day string', () => {
    for (const d of ['2026-01-01', '2026-02-28', '2026-02-29', '2026-07-18', '2026-12-31']) {
      // 2026 is not a leap year: 02-29 normalizes to 03-01 — skip identity there.
      if (d === '2026-02-29') continue;
      expect(localDay(parseLocalDay(d))).toBe(d);
    }
  });
});

describe('addLocalDays / localDaysBetweenDays', () => {
  it('adds and subtracts days across month and year boundaries', () => {
    expect(addLocalDays('2026-07-18', 1)).toBe('2026-07-19');
    expect(addLocalDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addLocalDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('is stable across the US DST spring-forward (a 23-hour local day)', () => {
    // 2026-03-08 is the US spring-forward date.
    expect(addLocalDays('2026-03-07', 3)).toBe('2026-03-10');
    expect(localDaysBetweenDays('2026-03-07', '2026-03-10')).toBe(3);
  });

  it('measures signed whole-day distances', () => {
    expect(localDaysBetweenDays('2026-07-01', '2026-07-18')).toBe(17);
    expect(localDaysBetweenDays('2026-07-18', '2026-07-01')).toBe(-17);
    expect(localDaysBetweenDays('2026-07-18', '2026-07-18')).toBe(0);
  });
});
