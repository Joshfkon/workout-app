import {
  buildExerciseHistories,
  flattenExerciseHistoryRows,
  HISTORY_SESSIONS_PER_EXERCISE,
  type ExerciseHistoryQueryRow,
  type HistoryBlockRow,
} from '../suggestions';

/**
 * Fix 1 (audit failure mode #2): the history fetch window is PER EXERCISE.
 *
 * The old batched query capped rows globally across all of today's exercises
 * (ordered by completed_at desc), so an exercise trained less frequently than
 * its session-mates could get ZERO rows and be treated as a cold start
 * (+15% steps, easy-RIR auto-bumps) despite years of history. The new query
 * returns one row per exercise with that exercise's own last-N blocks
 * embedded; these tests cover the flatten + grouping glue on that shape.
 */

function block(
  exerciseId: string,
  sessionId: string,
  completedAt: string,
  weightKg: number,
  reps: number
): HistoryBlockRow {
  return {
    id: `${sessionId}-${exerciseId}`,
    exercise_id: exerciseId,
    workout_sessions: {
      id: sessionId,
      completed_at: completedAt,
      state: 'completed',
      user_id: 'u1',
      is_deload: false,
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

/** July 2026 dates, most-recent-first: day 17, 16, 15, ... */
function recentDate(i: number): string {
  return `2026-07-${String(17 - i).padStart(2, '0')}T10:00:00Z`;
}

describe('per-exercise history window (Fix 1)', () => {
  // 8 exercises. Seven staples each trained 10 times in the last 2 weeks
  // (70 recent blocks — under the OLD global cap these alone would starve
  // anything older). One exercise ("rear-delt-fly") was last trained months
  // ago, sparsely — its rows are older than every staple row.
  const staples = ['bench', 'squat', 'row', 'ohp', 'curl', 'pushdown', 'raise'];
  const rows: ExerciseHistoryQueryRow[] = [
    ...staples.map((ex) => ({
      id: ex,
      exercise_blocks: Array.from({ length: 10 }, (_, i) =>
        block(ex, `${ex}-s${i}`, recentDate(i), 100, 10)
      ),
    })),
    {
      id: 'rear-delt-fly',
      exercise_blocks: [
        block('rear-delt-fly', 'rdf-s0', '2026-03-02T10:00:00Z', 12.5, 15),
        block('rear-delt-fly', 'rdf-s1', '2026-02-12T10:00:00Z', 12.5, 14),
        block('rear-delt-fly', 'rdf-s2', '2026-01-20T10:00:00Z', 10, 15),
      ],
    },
  ];

  it('a sparsely-trained exercise keeps its real history and is NOT a cold start', () => {
    const histories = buildExerciseHistories(flattenExerciseHistoryRows(rows));

    const sparse = histories['rear-delt-fly'];
    expect(sparse).toBeDefined();
    // Real history: 3 sessions, anchored to the March session — NOT
    // totalSessions === 0, which is what flips ExerciseCard into cold-start
    // mode (isColdStartExercise = totalSessions === 0).
    expect(sparse.totalSessions).toBe(3);
    expect(sparse.lastWorkoutDate).toBe('2026-03-02T10:00:00Z');
    expect(sparse.lastWorkoutSets).toEqual([{ weightKg: 12.5, reps: 15, rpe: 8 }]);
    // All of this exercise's sets are 15+ reps @ RPE 8 (17+ effective reps):
    // real history, but beyond the canonical estimator's domain — no e1RM
    // anchor exists (0 = "no estimate"). Cold-start mode is still OFF because
    // totalSessions > 0, which is what this test protects.
    expect(sparse.estimatedE1RM).toBe(0);
  });

  it('staples still get their own full window alongside the sparse exercise', () => {
    const histories = buildExerciseHistories(flattenExerciseHistoryRows(rows));
    for (const ex of staples) {
      expect(histories[ex].totalSessions).toBe(HISTORY_SESSIONS_PER_EXERCISE);
      expect(histories[ex].lastWorkoutDate).toBe(recentDate(0));
    }
  });

  it('flatten preserves each exercise\'s most-recent-first block order', () => {
    const flat = flattenExerciseHistoryRows(rows);
    const benchBlocks = flat.filter((b) => b.exercise_id === 'bench');
    expect(benchBlocks.map((b) => b.workout_sessions?.completed_at)).toEqual(
      Array.from({ length: 10 }, (_, i) => recentDate(i))
    );
  });

  it('handles exercises with no history (true cold start) and null rows', () => {
    expect(flattenExerciseHistoryRows(null)).toEqual([]);
    const withEmpty: ExerciseHistoryQueryRow[] = [
      { id: 'new-exercise', exercise_blocks: null },
      { id: 'bench', exercise_blocks: [block('bench', 's0', recentDate(0), 100, 10)] },
    ];
    const histories = buildExerciseHistories(flattenExerciseHistoryRows(withEmpty));
    // A truly-never-trained exercise produces no entry → cold start is EARNED.
    expect(histories['new-exercise']).toBeUndefined();
    expect(histories['bench'].totalSessions).toBe(1);
  });
});
