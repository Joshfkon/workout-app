import { computeLiftTrends, type LiftTrendSessionRow } from '../liftTrends';

/** Build a completed session with one exercise block and one working top set. */
function session(
  id: string,
  completedAt: string,
  exercise: { id: string; name: string },
  weightKg: number,
  reps: number
): LiftTrendSessionRow {
  return {
    id,
    completed_at: completedAt,
    exercise_blocks: [
      {
        exercises: exercise,
        set_logs: [
          { weight_kg: weightKg, reps, is_warmup: false },
          // Warmups must be ignored even when heavier-rep
          { weight_kg: weightKg / 2, reps: 12, is_warmup: true },
        ],
      },
    ],
  };
}

const bench = { id: 'ex-bench', name: 'Bench Press' };
const squat = { id: 'ex-squat', name: 'Squat' };

describe('computeLiftTrends', () => {
  it('classifies a steadily improving lift as rising', () => {
    const sessions = [
      session('s1', '2026-06-01T10:00:00Z', bench, 80, 8),
      session('s2', '2026-06-08T10:00:00Z', bench, 82.5, 8),
      session('s3', '2026-06-15T10:00:00Z', bench, 85, 8),
      session('s4', '2026-06-22T10:00:00Z', bench, 87.5, 8),
    ];

    const summary = computeLiftTrends(sessions, 'bulk', new Date('2026-06-23'));

    expect(summary.lifts).toHaveLength(1);
    expect(summary.lifts[0]).toMatchObject({ name: 'Bench Press', direction: 'rising' });
    expect(summary.rising).toBe(1);
    expect(summary.stalled).toBeNull();
  });

  it('flags a flat lift on a bulk as stalled with weeks since progress', () => {
    const sessions = [
      session('s1', '2026-05-25T10:00:00Z', bench, 100, 5),
      session('s2', '2026-06-01T10:00:00Z', bench, 100, 5),
      session('s3', '2026-06-08T10:00:00Z', bench, 100, 5),
      session('s4', '2026-06-15T10:00:00Z', bench, 100, 5),
      session('s5', '2026-06-22T10:00:00Z', bench, 100, 5),
    ];

    const summary = computeLiftTrends(sessions, 'bulk', new Date('2026-06-23'));

    expect(summary.flat).toBe(1);
    expect(summary.stalled).not.toBeNull();
    expect(summary.stalled!.name).toBe('Bench Press');
    expect(summary.stalled!.weeks).toBeGreaterThanOrEqual(1);
  });

  it('skips lifts with fewer than 3 sessions and orders rising before down', () => {
    const sessions = [
      // Squat declining across 4 sessions
      session('q1', '2026-06-01T10:00:00Z', squat, 140, 5),
      session('q2', '2026-06-08T10:00:00Z', squat, 135, 5),
      session('q3', '2026-06-15T10:00:00Z', squat, 130, 5),
      session('q4', '2026-06-22T10:00:00Z', squat, 125, 5),
      // Bench rising but only 2 sessions — not enough history
      session('b1', '2026-06-15T10:00:00Z', bench, 80, 8),
      session('b2', '2026-06-22T10:00:00Z', bench, 85, 8),
    ];

    const summary = computeLiftTrends(sessions, undefined, new Date('2026-06-23'));

    expect(summary.lifts.map((l) => l.exerciseId)).toEqual(['ex-squat']);
    expect(summary.down).toBe(1);
  });

  it('ignores bodyweight/zero-load sets instead of zeroing the trend', () => {
    const sessions = [
      session('s1', '2026-06-01T10:00:00Z', bench, 80, 8),
      session('s2', '2026-06-08T10:00:00Z', bench, 82.5, 8),
      {
        id: 's3',
        completed_at: '2026-06-15T10:00:00Z',
        exercise_blocks: [
          { exercises: bench, set_logs: [{ weight_kg: 0, reps: 15, is_warmup: false }] },
        ],
      },
      session('s4', '2026-06-22T10:00:00Z', bench, 85, 8),
    ];

    const summary = computeLiftTrends(sessions, 'bulk', new Date('2026-06-23'));

    expect(summary.lifts).toHaveLength(1);
    expect(summary.lifts[0].direction).toBe('rising');
  });
});
