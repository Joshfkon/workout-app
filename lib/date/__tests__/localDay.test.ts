import {
  WEEK_STARTS_ON,
  localDay,
  startOfLocalDay,
  localWeekStart,
  localWeekKey,
  rollingWindowStart,
  rollingWindowStartISO,
  localDaysBetween,
} from '@/lib/date/localDay';

// All fixtures use the local-time Date constructor (new Date(y, m, d, h)), so
// every assertion is timezone-agnostic: it holds in whatever TZ Jest runs in.

describe('localDay', () => {
  it('formats the local calendar day as YYYY-MM-DD', () => {
    expect(localDay(new Date(2026, 0, 15, 9, 30))).toBe('2026-01-15');
    expect(localDay(new Date(2026, 11, 3, 0, 0))).toBe('2026-12-03');
  });

  it('keeps a 9 PM local timestamp on the same local day (the toISOString bug)', () => {
    // toISOString() on this instant can report the NEXT day in positive-offset
    // timezones. localDay must not: it stays on the 15th everywhere.
    const ninePM = new Date(2026, 0, 15, 21, 0, 0);
    expect(localDay(ninePM)).toBe('2026-01-15');
  });
});

describe('startOfLocalDay', () => {
  it('returns local midnight of the given day', () => {
    const d = startOfLocalDay(new Date(2026, 0, 15, 21, 45));
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });
});

describe('localWeekStart / localWeekKey (Monday start)', () => {
  it('documents Monday as the week start', () => {
    expect(WEEK_STARTS_ON).toBe(1);
  });

  it('maps every day Mon..Sun back to the same Monday', () => {
    // 2026-01-12 is a Monday; 2026-01-18 is the Sunday closing that week.
    for (let day = 12; day <= 18; day++) {
      expect(localWeekKey(new Date(2026, 0, day, 13, 0))).toBe('2026-01-12');
    }
  });

  it('rolls to the previous Monday for a Sunday before the boundary', () => {
    // 2026-01-11 is a Sunday -> belongs to the week starting Mon 2026-01-05.
    expect(localWeekKey(new Date(2026, 0, 11, 23, 59))).toBe('2026-01-05');
  });

  it('time of day does not affect the week key', () => {
    const morning = localWeekKey(new Date(2026, 0, 15, 6, 0));
    const night = localWeekKey(new Date(2026, 0, 15, 21, 0));
    expect(morning).toBe(night);
  });

  it('localWeekStart returns local midnight of the week-start day', () => {
    const start = localWeekStart(new Date(2026, 0, 15, 21, 0));
    expect(start.getDay()).toBe(WEEK_STARTS_ON);
    expect(start.getHours()).toBe(0);
    expect(localDay(start)).toBe('2026-01-12');
  });
});

describe('rollingWindowStart (relaunch invariance)', () => {
  it('anchors the trailing 7-day window to local midnight, not the wall clock', () => {
    const start = rollingWindowStart(7, new Date(2026, 0, 15, 21, 0));
    // 7 days INCLUDING today => today - 6 days at 00:00 local.
    expect(localDay(start)).toBe('2026-01-09');
    expect(start.getHours()).toBe(0);
  });

  it('is identical for two different times on the SAME local day', () => {
    // This is the core regression assertion for the 71->87 bug: the window
    // (and therefore the set count queried against it) cannot change between a
    // morning render and an evening force-quit/relaunch on the same day.
    const morning = rollingWindowStartISO(7, new Date(2026, 0, 15, 6, 15));
    const evening = rollingWindowStartISO(7, new Date(2026, 0, 15, 21, 50));
    expect(morning).toBe(evening);
  });

  it('advances by exactly one day across a local-midnight rollover', () => {
    const before = rollingWindowStart(7, new Date(2026, 0, 15, 23, 59));
    const after = rollingWindowStart(7, new Date(2026, 0, 16, 0, 1));
    expect(localDaysBetween(before, after)).toBe(1);
  });

  it('honours a custom window length', () => {
    const start = rollingWindowStart(1, new Date(2026, 0, 15, 12, 0));
    expect(localDay(start)).toBe('2026-01-15'); // 1-day window = today only
  });
});

describe('localDaysBetween', () => {
  it('counts whole local days regardless of time of day', () => {
    expect(localDaysBetween(new Date(2026, 0, 10, 23, 0), new Date(2026, 0, 15, 1, 0))).toBe(5);
    expect(localDaysBetween(new Date(2026, 0, 15, 1, 0), new Date(2026, 0, 15, 23, 0))).toBe(0);
  });
});
