import {
  sleepDayForSession,
  formatSessionTimeOfDay,
  resolveExerciseStartedAt,
  OVERNIGHT_SESSION_CUTOFF_HOUR,
} from '../sessionContext';

/** Local-midnight-safe constructor: the tests are about LOCAL wall clock. */
function localISO(y: number, m: number, d: number, h: number, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

describe('sleepDayForSession', () => {
  it('maps an evening session to that session"s own local day', () => {
    // sleep_log stores a night against the morning it ended, so a session on
    // day D was preceded by day D's entry.
    expect(sleepDayForSession(localISO(2026, 7, 21, 18, 30))).toBe('2026-07-21');
  });

  it('maps a normal morning session to its own local day', () => {
    expect(sleepDayForSession(localISO(2026, 7, 21, 6, 15))).toBe('2026-07-21');
  });

  it('attributes a small-hours session to the PREVIOUS night', () => {
    // 1am on the 21st: the night sleep_log will record against the 21st hasn't
    // happened yet — the most recent completed night is the 20th's entry.
    expect(sleepDayForSession(localISO(2026, 7, 21, 1, 5))).toBe('2026-07-20');
  });

  it('flips exactly at the cutoff hour', () => {
    const before = localISO(2026, 7, 21, OVERNIGHT_SESSION_CUTOFF_HOUR - 1, 59);
    const at = localISO(2026, 7, 21, OVERNIGHT_SESSION_CUTOFF_HOUR, 0);
    expect(sleepDayForSession(before)).toBe('2026-07-20');
    expect(sleepDayForSession(at)).toBe('2026-07-21');
  });

  it('crosses a month boundary backwards', () => {
    expect(sleepDayForSession(localISO(2026, 8, 1, 2, 0))).toBe('2026-07-31');
  });

  it('returns null for missing or unparseable timestamps', () => {
    expect(sleepDayForSession(null)).toBeNull();
    expect(sleepDayForSession(undefined)).toBeNull();
    expect(sleepDayForSession('')).toBeNull();
    expect(sleepDayForSession('not a date')).toBeNull();
  });
});

describe('formatSessionTimeOfDay', () => {
  it('renders a 12-hour clock time', () => {
    expect(formatSessionTimeOfDay(localISO(2026, 7, 21, 18, 42))).toBe('6:42 PM');
    expect(formatSessionTimeOfDay(localISO(2026, 7, 21, 6, 5))).toBe('6:05 AM');
  });

  it('returns null when there is no timestamp to show', () => {
    expect(formatSessionTimeOfDay(null)).toBeNull();
    expect(formatSessionTimeOfDay('nonsense')).toBeNull();
  });
});

describe('resolveExerciseStartedAt', () => {
  const a = localISO(2026, 7, 21, 18, 40);
  const b = localISO(2026, 7, 21, 18, 55);

  it('picks the earliest set stamp, not the first in the array', () => {
    expect(resolveExerciseStartedAt([b, a])).toBe(a);
  });

  it('ignores unusable stamps among usable ones', () => {
    expect(resolveExerciseStartedAt([null, 'bad', b, a])).toBe(a);
  });

  it('falls back to the session start, then completion', () => {
    const started = localISO(2026, 7, 21, 17, 0);
    const completed = localISO(2026, 7, 21, 19, 30);
    expect(resolveExerciseStartedAt([], started, completed)).toBe(started);
    expect(resolveExerciseStartedAt([null], null, completed)).toBe(completed);
  });

  it('returns null when nothing is available', () => {
    expect(resolveExerciseStartedAt([], null, null)).toBeNull();
    expect(resolveExerciseStartedAt([undefined])).toBeNull();
  });
});
