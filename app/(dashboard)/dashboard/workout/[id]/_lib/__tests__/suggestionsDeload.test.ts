import {
  buildExerciseHistories,
  type HistoryBlockRow,
} from '../suggestions';

/**
 * A deload session is held light on purpose. The suggestion engine must anchor
 * the next non-deload session to the last NORMAL session's weights/reps — never
 * the deload's — otherwise next week's suggestion regresses to deload loads.
 */

function block(
  exerciseId: string,
  sessionId: string,
  weightKg: number,
  reps: number,
  completedAt: string,
  isDeload: boolean
): HistoryBlockRow {
  return {
    id: `${sessionId}-${exerciseId}`,
    exercise_id: exerciseId,
    workout_sessions: {
      id: sessionId,
      completed_at: completedAt,
      state: 'completed',
      user_id: 'u1',
      is_deload: isDeload,
    },
    set_logs: [
      {
        weight_kg: weightKg,
        reps,
        rpe: 8,
        is_warmup: false,
        set_number: 1,
        set_type: 'normal',
        logged_at: completedAt,
        location_id: null,
      },
    ],
  };
}

const SQUAT = 'squat';

describe('buildExerciseHistories — deload exclusion', () => {
  it('anchors "last session" to the most recent NON-deload session', () => {
    // Most recent session (Jan 10) was a deload at 60kg; the prior normal
    // session (Jan 03) was 100kg. Blocks are ordered most-recent-first.
    const blocks = [
      block(SQUAT, 'deload', 60, 12, '2026-01-10', true),
      block(SQUAT, 'normal', 100, 8, '2026-01-03', false),
    ];

    const histories = buildExerciseHistories(blocks);

    // Last-session reference is the normal 100kg × 8, not the deload's 60kg.
    expect(histories[SQUAT].lastWorkoutSets).toEqual([{ weightKg: 100, reps: 8, rpe: 8 }]);
    expect(histories[SQUAT].lastWorkoutDate).toBe('2026-01-03');
    // Only the normal session counts toward the session tally / e1RM.
    expect(histories[SQUAT].totalSessions).toBe(1);
    expect(histories[SQUAT].personalRecord?.weightKg).toBe(100);
  });

  it('a deload session does not drag the estimated e1RM down', () => {
    const withDeload = buildExerciseHistories([
      block(SQUAT, 'deload', 60, 12, '2026-01-10', true),
      block(SQUAT, 'normal', 100, 8, '2026-01-03', false),
    ]);
    const normalOnly = buildExerciseHistories([
      block(SQUAT, 'normal', 100, 8, '2026-01-03', false),
    ]);

    // Excluding the deload leaves the e1RM identical to the normal-only history
    // (no false regression from the light week).
    expect(withDeload[SQUAT].estimatedE1RM).toBeCloseTo(normalOnly[SQUAT].estimatedE1RM, 5);
  });

  it('an all-deload history degrades to empty rather than seeding from deload weights', () => {
    const histories = buildExerciseHistories([
      block(SQUAT, 'deload1', 60, 12, '2026-01-10', true),
      block(SQUAT, 'deload2', 55, 12, '2026-01-03', true),
    ]);

    // No SQUAT entry is produced from deload-only history.
    expect(histories[SQUAT]?.lastWorkoutSets ?? []).toEqual([]);
    expect(histories[SQUAT]?.estimatedE1RM ?? 0).toBe(0);
  });
});
