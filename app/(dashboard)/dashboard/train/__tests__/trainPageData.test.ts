/**
 * The Train page's cached payload → what it shows. The payload is persisted,
 * so it may be read back on a later day: the week window and "today" are
 * re-applied at render time, not baked in at fetch time.
 */

import { activeDurationMin, mesoProgress, toRecentWorkouts, weekStats } from '../trainPageData';

describe('weekStats', () => {
  const rows = [
    { started_at: '2026-11-20T10:00:00Z', completed_at: '2026-11-20T11:00:00Z', duration_seconds: 3000 },
    { started_at: '2026-11-22T10:00:00Z', completed_at: '2026-11-22T10:45:00Z', duration_seconds: null },
    // Legacy row with no usable duration: counts as a session, not as time.
    { started_at: null, completed_at: '2026-11-23T10:00:00Z', duration_seconds: null },
  ];

  it('counts sessions and time in the window, and averages only usable durations', () => {
    const s = weekStats(rows, '2026-11-17T00:00:00Z');
    expect(s.sessionsThisWeek).toBe(3);
    expect(s.weekTime.totalMin).toBe(50 + 45);
    expect(s.weekTime.avgMin).toBe(47.5);
  });

  it('drops sessions that have left the window since the payload was fetched', () => {
    const s = weekStats(rows, '2026-11-21T00:00:00Z');
    expect(s.sessionsThisWeek).toBe(2);
    expect(s.weekTime.totalMin).toBe(45);
  });

  it('has no average before any session has a duration', () => {
    expect(weekStats([], '2026-11-17T00:00:00Z')).toEqual({
      sessionsThisWeek: 0,
      weekTime: { totalMin: 0, avgMin: null },
    });
  });
});

describe('activeDurationMin', () => {
  it('prefers the paused-excluded snapshot, else the wall-clock span', () => {
    expect(activeDurationMin({ started_at: null, completed_at: '2026-11-20T11:00:00Z', duration_seconds: 600 })).toBe(10);
    expect(
      activeDurationMin({ started_at: '2026-11-20T10:00:00Z', completed_at: '2026-11-20T10:30:00Z', duration_seconds: 0 })
    ).toBe(30);
    expect(activeDurationMin({ started_at: null, completed_at: '2026-11-20T11:00:00Z', duration_seconds: null })).toBeNull();
  });
});

describe('mesoProgress', () => {
  const completed = [
    { started_at: '2026-11-10T10:00:00Z', planned_date: '2026-11-10' },
    { started_at: '2026-11-12T10:00:00Z', planned_date: '2026-11-12' },
    { started_at: '2026-11-24T07:00:00Z', planned_date: '2026-11-24' },
  ];

  it('counts the block, today’s sessions and when this slot was last done', () => {
    const p = mesoProgress(completed, 2, '2026-11-24');
    expect(p.mesoCompletedCount).toBe(3);
    expect(p.completedTodayCount).toBe(1);
    expect(p.lastCycleDone?.toISOString()).toBe('2026-11-12T10:00:00.000Z');
  });

  it('reads "today" at render time, not from when the payload was fetched', () => {
    expect(mesoProgress(completed, 2, '2026-11-25').completedTodayCount).toBe(0);
  });

  it('is empty with no mesocycle', () => {
    expect(mesoProgress(null, null, '2026-11-24')).toEqual({
      mesoCompletedCount: null,
      completedTodayCount: 0,
      lastCycleDone: null,
    });
  });
});

describe('toRecentWorkouts', () => {
  it('turns stored rows into list rows (working sets only, minutes rounded)', () => {
    const [w] = toRecentWorkouts([
      {
        id: 's1',
        completed_at: '2026-11-22T11:00:00Z',
        started_at: '2026-11-22T10:00:00Z',
        duration_seconds: 2970,
        exercise_blocks: [
          {
            exercise_id: 'bench',
            order: 1,
            suggestion_reason: null,
            exercises: { name: 'Bench Press', primary_muscle: 'chest' },
            set_logs: [
              { is_warmup: true, weight_kg: 40, reps: 10 },
              { is_warmup: false, weight_kg: 80, reps: 8 },
              { is_warmup: false, weight_kg: 80, reps: 7 },
            ],
          },
        ],
      },
    ]);
    expect(w.id).toBe('s1');
    expect(w.setCount).toBe(2);
    expect(w.durationMin).toBe(50);
    expect(w.completedAt).toBeInstanceOf(Date);
    expect(w.exercises.length).toBe(1);
  });
});
