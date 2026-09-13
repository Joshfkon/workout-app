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
  reps: number,
  opts?: { isDeload?: boolean; skipped?: boolean; warmupOnly?: boolean }
): HistoryBlockRow {
  return {
    id: `${sessionId}-${exerciseId}`,
    exercise_id: exerciseId,
    workout_sessions: {
      id: sessionId,
      completed_at: completedAt,
      state: 'completed',
      user_id: 'u1',
      is_deload: opts?.isDeload ?? false,
    },
    // A "skipped" block mirrors a completed session where this exercise was
    // planned but never logged — the block row persists with no set_logs.
    set_logs: opts?.skipped
      ? []
      : [
          {
            weight_kg: weightKg,
            reps,
            rpe: 8,
            is_warmup: opts?.warmupOnly ?? false,
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
    expect(sparse.lastWorkoutSets).toEqual([
      expect.objectContaining({ weightKg: 12.5, reps: 15, rpe: 8 }),
    ]);
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

  // The Machine Back Extension failure: real 240-lb sessions in the DB, but
  // every completed session since then carried a planned-but-skipped (empty)
  // block for the exercise. Counted as raw blocks, ten of those filled the
  // whole window → totalSessions === 0 → cold-start mode ("starting point
  // estimated from your training profile", ~50 lbs) on a well-trained lift.
  // The window must be counted in blocks that CARRY SIGNAL.
  it('planned-but-skipped (set-less) blocks do not starve the window into a false cold start', () => {
    const rows: ExerciseHistoryQueryRow[] = [
      {
        id: 'back-ext',
        exercise_blocks: [
          // 12 newer sessions where the exercise was skipped…
          ...Array.from({ length: 12 }, (_, i) =>
            block('back-ext', `skip-s${i}`, recentDate(i), 0, 0, { skipped: true })
          ),
          // …and the real history just past them.
          block('back-ext', 'real-s0', '2026-06-24T10:00:00Z', 109, 13),
          block('back-ext', 'real-s1', '2026-06-17T10:00:00Z', 109, 12),
        ],
      },
    ];

    const history = buildExerciseHistories(flattenExerciseHistoryRows(rows))['back-ext'];
    expect(history.totalSessions).toBe(2);
    expect(history.lastWorkoutDate).toBe('2026-06-24T10:00:00Z');
    expect(history.lastWorkoutSets).toEqual([
      expect.objectContaining({ weightKg: 109, reps: 13 }),
    ]);
    expect(history.estimatedE1RM).toBeGreaterThan(0);
  });

  it('deload and warmup-only blocks do not spend window slots either', () => {
    const rows: ExerciseHistoryQueryRow[] = [
      {
        id: 'bench',
        exercise_blocks: [
          ...Array.from({ length: 6 }, (_, i) =>
            block('bench', `dl-s${i}`, recentDate(i), 60, 10, { isDeload: true })
          ),
          ...Array.from({ length: 6 }, (_, i) =>
            block('bench', `wu-s${i}`, recentDate(6 + i), 40, 8, { warmupOnly: true })
          ),
          block('bench', 'real-s0', '2026-06-20T10:00:00Z', 100, 8),
        ],
      },
    ];

    const history = buildExerciseHistories(flattenExerciseHistoryRows(rows))['bench'];
    expect(history.totalSessions).toBe(1);
    expect(history.lastWorkoutDate).toBe('2026-06-20T10:00:00Z');
    expect(history.estimatedE1RM).toBeGreaterThan(0);
  });

  it('the window still caps at HISTORY_SESSIONS_PER_EXERCISE signal blocks', () => {
    const rows: ExerciseHistoryQueryRow[] = [
      {
        id: 'squat',
        exercise_blocks: Array.from({ length: 14 }, (_, i) =>
          block('squat', `sq-s${i}`, recentDate(i), 140, 5)
        ),
      },
    ];
    const history = buildExerciseHistories(flattenExerciseHistoryRows(rows))['squat'];
    expect(history.totalSessions).toBe(HISTORY_SESSIONS_PER_EXERCISE);
  });

  it('an exercise whose blocks ALL lack signal still gets an empty-shape entry', () => {
    const rows: ExerciseHistoryQueryRow[] = [
      {
        id: 'row',
        exercise_blocks: [
          block('row', 'skip-only', recentDate(0), 0, 0, { skipped: true }),
        ],
      },
    ];
    const history = buildExerciseHistories(flattenExerciseHistoryRows(rows))['row'];
    // Entry exists (so the page doesn't refetch mid-session) but cold start
    // is earned: no signal anywhere.
    expect(history).toBeDefined();
    expect(history.totalSessions).toBe(0);
    expect(history.estimatedE1RM).toBe(0);
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
