import { computeWeekSessions } from '../weekSessions';

describe('computeWeekSessions', () => {
  const startDate = '2026-06-29'; // week 1 = Jun 29 – Jul 5

  it('counts completed vs planned sessions inside the current mesocycle week', () => {
    const sessions = [
      { planned_date: '2026-06-29', state: 'completed', completed_at: '2026-06-29T18:00:00Z' },
      { planned_date: '2026-07-01', state: 'completed', completed_at: '2026-07-01T18:00:00Z' },
      { planned_date: '2026-07-03', state: 'planned', completed_at: null },
      { planned_date: '2026-07-05', state: 'planned', completed_at: null },
      // Next week's session must not count
      { planned_date: '2026-07-07', state: 'planned', completed_at: null },
    ];

    expect(computeWeekSessions(sessions, startDate, 1, 4)).toEqual({ done: 2, total: 4 });
  });

  it('falls back to days_per_week when no sessions are planned in the window', () => {
    expect(computeWeekSessions([], startDate, 1, 4)).toEqual({ done: 0, total: 4 });
  });

  it('counts a completed session by completion date when it has no planned date', () => {
    const sessions = [
      { planned_date: null, state: 'completed', completed_at: '2026-07-02T18:00:00Z' },
    ];

    expect(computeWeekSessions(sessions, startDate, 1, 4)).toEqual({ done: 1, total: 4 });
  });

  it('uses the requested week window, and planned sessions win over days_per_week', () => {
    const sessions = [
      { planned_date: '2026-07-06', state: 'completed', completed_at: '2026-07-06T18:00:00Z' },
      { planned_date: '2026-07-08', state: 'planned', completed_at: null },
    ];

    // Only 2 sessions are scheduled in week 2, so the denominator is 2, not 4.
    expect(computeWeekSessions(sessions, startDate, 2, 4)).toEqual({ done: 1, total: 2 });
  });

  it('returns null for an unparsable start date or an empty week', () => {
    expect(computeWeekSessions([], 'not-a-date', 1, 4)).toBeNull();
    expect(computeWeekSessions([], startDate, 1, 0)).toBeNull();
  });
});
