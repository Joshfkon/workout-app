/**
 * Per-exercise location overrides in the history read.
 *
 * A session happens at one gym, but one exercise can be on a machine that gym
 * doesn't otherwise represent — the annex adduction machine, the second leg
 * press, the Smith rack upstairs. `exercise_blocks.location_id` pins that
 * exercise, and these tests hold the line that the pin actually redirects
 * which history the suggestion math reads: pinning without redirecting would
 * write sets to one track while reading targets off another, which is worse
 * than not pinning at all.
 */
import { buildExerciseHistories, type HistoryBlockRow } from '../suggestions';

/** Build a completed-session history block with one working set. */
function block(
  exerciseId: string,
  sessionId: string,
  weightKg: number,
  locationId: string | null,
  completedAt: string
): HistoryBlockRow {
  return {
    id: `${sessionId}-${exerciseId}`,
    exercise_id: exerciseId,
    workout_sessions: {
      id: sessionId,
      completed_at: completedAt,
      state: 'completed',
      user_id: 'u1',
    },
    set_logs: [
      {
        weight_kg: weightKg,
        reps: 12,
        rpe: 8,
        is_warmup: false,
        set_number: 1,
        set_type: 'normal',
        logged_at: completedAt,
        location_id: locationId,
      },
    ],
  };
}

const ADDUCTION = 'hip-adduction-machine'; // local scope — the machine matters
const SQUAT = 'barbell-squat'; // global scope — a barbell is a barbell

const scopeForExercise = (id: string) =>
  id === ADDUCTION ? ('local' as const) : ('global' as const);

const MAIN_FLOOR = 'loc-main';
const ANNEX = 'loc-annex';

describe('buildExerciseHistories — per-exercise location override', () => {
  // Newest first, as the history query returns them (ordered by
  // workout_sessions.completed_at descending).
  const history = [
    block(ADDUCTION, 's2', 100, ANNEX, '2026-01-03'),
    block(ADDUCTION, 's1', 145, MAIN_FLOOR, '2026-01-02'),
  ];

  it('reads the pinned machine track, not the session gym', () => {
    const histories = buildExerciseHistories(history, {
      currentLocationId: MAIN_FLOOR,
      scopeForExercise,
      locationForExercise: (id) => (id === ADDUCTION ? ANNEX : null),
    });

    // The annex machine's 100kg, even though the session is on the main floor
    // where this lift has run at 145kg.
    expect(histories[ADDUCTION].lastWorkoutSets).toEqual([
      expect.objectContaining({ weightKg: 100 }),
    ]);
    expect(histories[ADDUCTION].estimatedFromOtherLocation).toBe(false);
  });

  it('falls back to the session location when the override is null', () => {
    const histories = buildExerciseHistories(history, {
      currentLocationId: MAIN_FLOOR,
      scopeForExercise,
      // "Same as workout" — the picker's inherit row stores null.
      locationForExercise: () => null,
    });

    expect(histories[ADDUCTION].lastWorkoutSets).toEqual([
      expect.objectContaining({ weightKg: 145 }),
    ]);
  });

  it('behaves identically to no override when the callback is omitted', () => {
    const withCallback = buildExerciseHistories(history, {
      currentLocationId: MAIN_FLOOR,
      scopeForExercise,
      locationForExercise: () => undefined,
    });
    const without = buildExerciseHistories(history, {
      currentLocationId: MAIN_FLOOR,
      scopeForExercise,
    });

    expect(withCallback[ADDUCTION].lastWorkoutSets).toEqual(
      without[ADDUCTION].lastWorkoutSets
    );
  });

  it('leaves a global-scope exercise on full cross-location history', () => {
    const squatHistory = [
      block(SQUAT, 's2', 150, ANNEX, '2026-01-03'),
      block(SQUAT, 's1', 140, MAIN_FLOOR, '2026-01-02'),
    ];
    const histories = buildExerciseHistories(squatHistory, {
      currentLocationId: MAIN_FLOOR,
      scopeForExercise,
      // Even an explicit pin cannot fragment a barbell lift's trend: scope
      // decides whether location is consulted at all.
      locationForExercise: () => ANNEX,
    });

    expect(histories[SQUAT].lastWorkoutSets).toEqual([
      expect.objectContaining({ weightKg: 150 }),
    ]);
    expect(histories[SQUAT].estimatedFromOtherLocation).toBe(false);
  });

  it('flags a first session on a newly pinned machine as an estimate', () => {
    const mainFloorOnly = [block(ADDUCTION, 's1', 145, MAIN_FLOOR, '2026-01-02')];

    const histories = buildExerciseHistories(mainFloorOnly, {
      currentLocationId: MAIN_FLOOR,
      scopeForExercise,
      locationForExercise: (id) => (id === ADDUCTION ? ANNEX : null),
    });

    // Nothing logged on the annex machine yet, so the main floor's history
    // seeds it — softened and flagged as a starting point, not a target.
    expect(histories[ADDUCTION].estimatedFromOtherLocation).toBe(true);
  });

  it('scopes an override even when the session itself has no location', () => {
    // A legacy/blank session still honors an explicit pin — the pin is the
    // user telling us this lift's history is its own track.
    const histories = buildExerciseHistories(history, {
      currentLocationId: null,
      scopeForExercise,
      locationForExercise: (id) => (id === ADDUCTION ? ANNEX : null),
    });

    expect(histories[ADDUCTION].lastWorkoutSets).toEqual([
      expect.objectContaining({ weightKg: 100 }),
    ]);
  });
});
