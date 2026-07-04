import {
  computeCurrentWeekFromSessions,
  computeCurrentWeek,
  sessionIndexFromCompleted,
} from '../mesocycleProgress';

describe('computeCurrentWeekFromSessions (session-based advancement)', () => {
  const DAYS = 4;
  const WEEKS = 5;

  it('starts at week 1 before any sessions are completed', () => {
    expect(computeCurrentWeekFromSessions(0, DAYS, WEEKS)).toEqual({ week: 1, isComplete: false });
  });

  it('stays in week 1 until daysPerWeek sessions are done', () => {
    expect(computeCurrentWeekFromSessions(1, DAYS, WEEKS).week).toBe(1);
    expect(computeCurrentWeekFromSessions(3, DAYS, WEEKS).week).toBe(1);
  });

  it('advances a week once daysPerWeek sessions are completed', () => {
    expect(computeCurrentWeekFromSessions(4, DAYS, WEEKS).week).toBe(2);
    expect(computeCurrentWeekFromSessions(7, DAYS, WEEKS).week).toBe(2);
    expect(computeCurrentWeekFromSessions(8, DAYS, WEEKS).week).toBe(3);
  });

  it('clamps to totalWeeks and is not complete until the last week is fully trained', () => {
    // 19 of 20 sessions: deload week reached but not finished
    expect(computeCurrentWeekFromSessions(19, DAYS, WEEKS)).toEqual({ week: 5, isComplete: false });
  });

  it('marks complete after totalWeeks * daysPerWeek sessions', () => {
    expect(computeCurrentWeekFromSessions(20, DAYS, WEEKS)).toEqual({ week: 5, isComplete: true });
    expect(computeCurrentWeekFromSessions(25, DAYS, WEEKS).isComplete).toBe(true);
  });

  it('guards against non-positive inputs', () => {
    expect(computeCurrentWeekFromSessions(-3, 0, 0)).toEqual({ week: 1, isComplete: false });
    expect(computeCurrentWeekFromSessions(5, 0, 1).week).toBe(1); // daysPerWeek treated as 1, clamped to 1 week
  });
});

describe('sessionIndexFromCompleted (within-week session slot)', () => {
  const DAYS = 4;

  it('walks through the week in order', () => {
    expect(sessionIndexFromCompleted(0, DAYS)).toBe(0);
    expect(sessionIndexFromCompleted(1, DAYS)).toBe(1);
    expect(sessionIndexFromCompleted(3, DAYS)).toBe(3);
  });

  it('wraps to the first session of the next week', () => {
    expect(sessionIndexFromCompleted(4, DAYS)).toBe(0);
    expect(sessionIndexFromCompleted(7, DAYS)).toBe(3);
  });

  it('resumes at the missed slot after an under-completed calendar week', () => {
    // User finished only 2 of 4 sessions "last week": next session is
    // still index 2 — nothing gets dropped by the calendar rolling over.
    expect(sessionIndexFromCompleted(2, DAYS)).toBe(2);
  });

  it('guards against non-positive inputs', () => {
    expect(sessionIndexFromCompleted(-1, DAYS)).toBe(0);
    expect(sessionIndexFromCompleted(5, 0)).toBe(0); // daysPerWeek treated as 1
  });
});

describe('computeCurrentWeek (date-based, kept for reference)', () => {
  const start = '2026-01-01';

  it('is week 1 on the start day', () => {
    expect(computeCurrentWeek(start, 5, new Date(2026, 0, 1))).toEqual({ week: 1, isComplete: false });
  });

  it('advances by calendar weeks', () => {
    expect(computeCurrentWeek(start, 5, new Date(2026, 0, 8)).week).toBe(2); // +7 days
    expect(computeCurrentWeek(start, 5, new Date(2026, 0, 15)).week).toBe(3); // +14 days
  });

  it('completes once the full duration elapses', () => {
    expect(computeCurrentWeek(start, 5, new Date(2026, 1, 5)).isComplete).toBe(true); // +35 days
  });
});
