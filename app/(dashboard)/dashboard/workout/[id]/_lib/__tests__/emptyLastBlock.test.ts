import {
  buildExerciseHistories,
  type HistoryBlockRow,
} from '../suggestions';

/**
 * "Last workout" must resolve to the most recent block that actually HAS
 * working sets.
 *
 * A completed session can contain an empty block for an exercise — the user
 * skipped it that day (exercise_blocks.skipped_at) or finished the workout
 * without logging it — and the batched history query returns that block
 * (set_logs is a left join, skipped blocks aren't filtered). Anchoring
 * lastWorkoutSets on historyBlocks[0] unconditionally blanked the card's
 * "last session …" meta line and Last Workout card while the exercise detail
 * sheet (useExerciseDetailHistory, which drops set-less sessions) still
 * showed real history one session back — the live inconsistency this file
 * regression-tests.
 */

type SetLogRow = NonNullable<HistoryBlockRow['set_logs']>[number];

function setLog(
  weightKg: number,
  reps: number,
  loggedAt: string,
  overrides: Partial<SetLogRow> = {}
): SetLogRow {
  return {
    weight_kg: weightKg,
    reps,
    rpe: 8,
    is_warmup: false,
    set_number: 1,
    set_type: 'normal',
    logged_at: loggedAt,
    location_id: null,
    ...overrides,
  };
}

function blockRow(
  sessionId: string,
  completedAt: string,
  setLogs: ReturnType<typeof setLog>[]
): HistoryBlockRow {
  return {
    id: `blk-${sessionId}`,
    exercise_id: 'wrist-curl',
    workout_sessions: {
      id: sessionId,
      completed_at: completedAt,
      state: 'completed',
      user_id: 'u1',
      is_deload: false,
    },
    set_logs: setLogs,
  };
}

const NEWER = '2026-07-18T10:00:00Z';
const MIDDLE = '2026-07-14T10:00:00Z';
const OLDER = '2026-07-11T10:00:00Z';

describe('empty most-recent block (skipped / unlogged exercise in a completed session)', () => {
  it('falls back to the newest block WITH working sets for last-workout data', () => {
    const blocks: HistoryBlockRow[] = [
      blockRow('s-newer', NEWER, []), // skipped that day
      blockRow('s-older', OLDER, [
        setLog(9, 30, OLDER),
        setLog(15.9, 15, OLDER, { set_number: 2 }),
      ]),
    ];

    const history = buildExerciseHistories(blocks)['wrist-curl'];
    expect(history.lastWorkoutDate).toBe(OLDER);
    expect(history.lastWorkoutSets).toEqual([
      { weightKg: 9, reps: 30, rpe: 8 },
      { weightKg: 15.9, reps: 15, rpe: 8 },
    ]);
    // Both sets (30 reps, 15 reps @ RPE 8) exceed the canonical estimator's
    // 15-effective-rep domain: this history has real sets but NO valid e1RM
    // anchor. 0 is the numeric-compat "no estimate" — the card renders it as
    // absent and prescriptions fall back to the last-session path.
    expect(history.estimatedE1RM).toBe(0);
  });

  it('treats a warmup-only newest block the same as an empty one', () => {
    const blocks: HistoryBlockRow[] = [
      blockRow('s-newer', NEWER, [setLog(5, 10, NEWER, { is_warmup: true })]),
      blockRow('s-older', OLDER, [setLog(15.9, 15, OLDER)]),
    ];

    const history = buildExerciseHistories(blocks)['wrist-curl'];
    expect(history.lastWorkoutDate).toBe(OLDER);
    expect(history.lastWorkoutSets).toEqual([{ weightKg: 15.9, reps: 15, rpe: 8 }]);
  });

  it('does not count set-less sessions toward totalSessions (matches the detail sheet)', () => {
    const blocks: HistoryBlockRow[] = [
      blockRow('s-newer', NEWER, []),
      blockRow('s-older', OLDER, [setLog(15.9, 15, OLDER)]),
    ];

    const history = buildExerciseHistories(blocks)['wrist-curl'];
    expect(history.totalSessions).toBe(1);
  });

  it('skips an empty middle block when resolving the prior session (regression path)', () => {
    const blocks: HistoryBlockRow[] = [
      blockRow('s-newest', NEWER, [setLog(16, 14, NEWER)]),
      blockRow('s-middle', MIDDLE, []), // skipped
      blockRow('s-older', OLDER, [setLog(15, 15, OLDER)]),
    ];

    const history = buildExerciseHistories(blocks)['wrist-curl'];
    expect(history.lastWorkoutDate).toBe(NEWER);
    expect(history.priorWorkoutSets).toEqual([{ weightKg: 15, reps: 15, rpe: 8 }]);
  });

  it('an all-empty history degrades to cold start (totalSessions 0, no anchor)', () => {
    const blocks: HistoryBlockRow[] = [
      blockRow('s-newer', NEWER, []),
      blockRow('s-older', OLDER, [setLog(5, 10, OLDER, { is_warmup: true })]),
    ];

    const history = buildExerciseHistories(blocks)['wrist-curl'];
    expect(history.totalSessions).toBe(0);
    expect(history.lastWorkoutDate).toBe('');
    expect(history.lastWorkoutSets).toEqual([]);
    expect(history.estimatedE1RM).toBe(0);
  });

  it('normal history (newest block has sets) is unchanged', () => {
    const blocks: HistoryBlockRow[] = [
      blockRow('s-newer', NEWER, [setLog(16, 14, NEWER)]),
      blockRow('s-older', OLDER, [setLog(15, 15, OLDER)]),
    ];

    const history = buildExerciseHistories(blocks)['wrist-curl'];
    expect(history.lastWorkoutDate).toBe(NEWER);
    expect(history.lastWorkoutSets).toEqual([{ weightKg: 16, reps: 14, rpe: 8 }]);
    expect(history.totalSessions).toBe(2);
  });
});
