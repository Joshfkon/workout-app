import { buildExerciseHistories, type HistoryBlockRow } from '../suggestions';

/**
 * Session context on the history the workout card renders: WHEN the last
 * session's work on an exercise happened, so the card can show a time of day
 * and look up the sleep that preceded it (services/sessionContext).
 *
 * The time must come from the exercise's own first working set — in a long
 * session the exercise worked first and the exercise worked last are an hour
 * or more apart, and `completed_at` describes neither.
 */

const BENCH = 'bench';

function block(
  sessionId: string,
  session: { completedAt: string | null; startedAt?: string | null },
  sets: Array<{ weightKg: number; reps: number; rpe: number; loggedAt?: string | null }>
): HistoryBlockRow {
  return {
    id: `${sessionId}-${BENCH}`,
    exercise_id: BENCH,
    workout_sessions: {
      id: sessionId,
      completed_at: session.completedAt,
      started_at: session.startedAt ?? null,
      state: 'completed',
      user_id: 'u1',
      is_deload: false,
    },
    set_logs: sets.map((s, i) => ({
      weight_kg: s.weightKg,
      reps: s.reps,
      rpe: s.rpe,
      is_warmup: false,
      set_number: i + 1,
      set_type: 'normal',
      // Explicit null models a row with no usable stamp; undefined just means
      // "the test doesn't care" and gets the session's own time.
      logged_at: (s.loggedAt === undefined ? session.completedAt : s.loggedAt) as string,
      location_id: null,
    })),
  };
}

describe('last-session timing on ExerciseHistoryData', () => {
  it('dates the exercise by its FIRST working set, not the session end', () => {
    const history = buildExerciseHistories([
      block(
        's1',
        { completedAt: '2026-07-21T20:15:00Z', startedAt: '2026-07-21T18:00:00Z' },
        [
          { weightKg: 60, reps: 9, rpe: 8, loggedAt: '2026-07-21T19:02:00Z' },
          { weightKg: 60, reps: 8, rpe: 8.5, loggedAt: '2026-07-21T19:11:00Z' },
        ]
      ),
    ])[BENCH];

    expect(history.lastWorkoutStartedAt).toBe('2026-07-21T19:02:00Z');
    // Per-set stamps survive to the card, which shows each set's own time.
    expect(history.lastWorkoutSets.map((s) => s.loggedAt)).toEqual([
      '2026-07-21T19:02:00Z',
      '2026-07-21T19:11:00Z',
    ]);
  });

  it('takes the earliest stamp even when sets come back out of order', () => {
    const history = buildExerciseHistories([
      block('s1', { completedAt: '2026-07-21T20:15:00Z' }, [
        { weightKg: 60, reps: 9, rpe: 8, loggedAt: '2026-07-21T19:30:00Z' },
        { weightKg: 60, reps: 8, rpe: 8, loggedAt: '2026-07-21T19:05:00Z' },
      ]),
    ])[BENCH];

    expect(history.lastWorkoutStartedAt).toBe('2026-07-21T19:05:00Z');
  });

  it('falls back to the session start, then its completion, for unstamped rows', () => {
    const withStart = buildExerciseHistories([
      block(
        's1',
        { completedAt: '2026-07-21T20:15:00Z', startedAt: '2026-07-21T18:00:00Z' },
        [{ weightKg: 60, reps: 9, rpe: 8, loggedAt: null }]
      ),
    ])[BENCH];
    expect(withStart.lastWorkoutStartedAt).toBe('2026-07-21T18:00:00Z');

    const completionOnly = buildExerciseHistories([
      block('s1', { completedAt: '2026-07-21T20:15:00Z', startedAt: null }, [
        { weightKg: 60, reps: 9, rpe: 8, loggedAt: null },
      ]),
    ])[BENCH];
    expect(completionOnly.lastWorkoutStartedAt).toBe('2026-07-21T20:15:00Z');
  });

  it('describes the session the sets came from, not a later empty one', () => {
    // A session where this exercise was skipped carries no sets, so "last
    // workout" (and its time) must resolve to the session before it.
    const history = buildExerciseHistories([
      block('skipped', { completedAt: '2026-07-24T20:00:00Z' }, []),
      block('real', { completedAt: '2026-07-21T20:15:00Z' }, [
        { weightKg: 60, reps: 9, rpe: 8, loggedAt: '2026-07-21T19:02:00Z' },
      ]),
    ])[BENCH];

    expect(history.lastWorkoutDate).toBe('2026-07-21T20:15:00Z');
    expect(history.lastWorkoutStartedAt).toBe('2026-07-21T19:02:00Z');
  });
});
