import {
  DURATION_MODEL,
  computePaceFactor,
  estimateWorkoutDuration,
  formatDurationDelta,
  formatDurationEstimate,
  type DurationBlockInput,
} from '../workoutDurationEstimator';

function block(overrides: Partial<DurationBlockInput> & { id: string }): DurationBlockInput {
  return {
    targetSets: 3,
    restSeconds: 120,
    mechanic: 'compound',
    ...overrides,
  };
}

describe('estimateWorkoutDuration', () => {
  it('returns an empty estimate for no exercises', () => {
    const estimate = estimateWorkoutDuration([]);
    expect(estimate.totalSeconds).toBe(0);
    expect(estimate.remainingSeconds).toBe(0);
    expect(estimate.totalSets).toBe(0);
    expect(estimate.exerciseCount).toBe(0);
  });

  it('counts work plus rest BETWEEN sets, not after the last one', () => {
    // 3 compound sets: 3 x 45s work + 2 x 120s rest = 375s. No transition
    // (single exercise), no warmups requested.
    const estimate = estimateWorkoutDuration([block({ id: 'a', targetSets: 3, restSeconds: 120 })]);
    expect(estimate.totalSeconds).toBe(3 * 45 + 2 * 120);
  });

  it('charges isolation work less than compound work', () => {
    const compound = estimateWorkoutDuration([block({ id: 'a', mechanic: 'compound' })]);
    const isolation = estimateWorkoutDuration([block({ id: 'a', mechanic: 'isolation' })]);
    expect(isolation.totalSeconds).toBeLessThan(compound.totalSeconds);
    expect(compound.totalSeconds - isolation.totalSeconds).toBe(
      3 * (DURATION_MODEL.workSecondsCompound - DURATION_MODEL.workSecondsIsolation)
    );
  });

  it('charges timed holds more than rep-based sets', () => {
    const hold = estimateWorkoutDuration([
      block({ id: 'a', mechanic: 'isolation', exerciseType: 'duration_based' }),
    ]);
    const reps = estimateWorkoutDuration([
      block({ id: 'a', mechanic: 'isolation', exerciseType: 'rep_based' }),
    ]);
    expect(hold.totalSeconds).toBeGreaterThan(reps.totalSeconds);
  });

  it('adds one transition between exercises, not after the last', () => {
    const one = estimateWorkoutDuration([block({ id: 'a' })]);
    const two = estimateWorkoutDuration([block({ id: 'a' }), block({ id: 'b' })]);
    expect(two.totalSeconds - one.totalSeconds).toBe(
      one.totalSeconds + DURATION_MODEL.transitionSeconds
    );
  });

  it('falls back to a default rest when a block has none prescribed', () => {
    const estimate = estimateWorkoutDuration([block({ id: 'a', targetSets: 2, restSeconds: null })]);
    expect(estimate.totalSeconds).toBe(2 * 45 + DURATION_MODEL.defaultRestSeconds);
  });

  it('includes remaining warmup sets with their own shorter rest', () => {
    const withWarmup = estimateWorkoutDuration([
      block({ id: 'a', warmupSetsRemaining: 2, warmupRestSeconds: 30 }),
    ]);
    const without = estimateWorkoutDuration([block({ id: 'a' })]);
    expect(withWarmup.totalSeconds - without.totalSeconds).toBe(
      2 * (DURATION_MODEL.warmupWorkSeconds + 30)
    );
  });

  it('excludes skipped exercises entirely', () => {
    const estimate = estimateWorkoutDuration([
      block({ id: 'a' }),
      block({ id: 'b', skipped: true }),
    ]);
    expect(estimate).toMatchObject({ exerciseCount: 1, totalSets: 3 });
    expect(estimate.totalSeconds).toBe(estimateWorkoutDuration([block({ id: 'a' })]).totalSeconds);
  });

  it('makes a superset cheaper than the same two exercises run separately', () => {
    const separate = estimateWorkoutDuration([
      block({ id: 'a', targetSets: 3 }),
      block({ id: 'b', targetSets: 3 }),
    ]);
    const supersetted = estimateWorkoutDuration([
      block({ id: 'a', targetSets: 3, supersetGroupId: 'g1' }),
      block({ id: 'b', targetSets: 3, supersetGroupId: 'g1' }),
    ]);
    expect(supersetted.totalSeconds).toBeLessThan(separate.totalSeconds);
    // Same work, but 3 changeovers replace 3 rests and the pair is one unit.
    expect(supersetted.totalSeconds).toBe(
      6 * 45 + 2 * 120 + 3 * DURATION_MODEL.supersetChangeoverSeconds
    );
  });

  it('counts remaining work only for sets not yet logged', () => {
    const estimate = estimateWorkoutDuration([
      block({ id: 'a', targetSets: 3, completedSets: 3 }),
      block({ id: 'b', targetSets: 4, completedSets: 1 }),
    ]);
    expect(estimate).toMatchObject({ totalSets: 7, completedSets: 4, remainingSets: 3 });
    // 3 remaining sets on one active exercise: 3 x 45 + 2 x 120.
    expect(estimate.remainingSeconds).toBe(3 * 45 + 2 * 120);
  });

  it('treats over-logged sets as complete rather than negative remaining', () => {
    const estimate = estimateWorkoutDuration([
      block({ id: 'a', targetSets: 3, completedSets: 5 }),
    ]);
    expect(estimate.remainingSets).toBe(0);
    expect(estimate.remainingSeconds).toBe(0);
    expect(estimate.completedSets).toBe(3);
  });

  it('leaves the estimate uncalibrated until enough sets are logged', () => {
    const estimate = estimateWorkoutDuration(
      [block({ id: 'a', targetSets: 4, completedSets: 2 })],
      { elapsedSeconds: 3600 }
    );
    expect(estimate.isCalibrated).toBe(false);
    expect(estimate.paceFactor).toBe(1);
  });

  it('stretches the remaining estimate for a slower-than-modelled user', () => {
    const blocks = [block({ id: 'a', targetSets: 8, completedSets: 4, restSeconds: 120 })];
    const modelled = estimateWorkoutDuration(blocks);
    // Model for 4 completed sets (minus the anchor set): 3 x 45 + 3 x 120 = 495s.
    const slow = estimateWorkoutDuration(blocks, { elapsedSeconds: 990 });
    expect(slow.isCalibrated).toBe(true);
    expect(slow.paceFactor).toBeCloseTo(2, 5);
    expect(slow.remainingSeconds).toBe(modelled.remainingSeconds * 2);
  });

  it('clamps pace calibration so one long break cannot double the session', () => {
    const estimate = estimateWorkoutDuration(
      [block({ id: 'a', targetSets: 8, completedSets: 4 })],
      { elapsedSeconds: 6 * 3600 }
    );
    expect(estimate.paceFactor).toBe(DURATION_MODEL.maxPaceFactor);
  });

  it('projects finish time as elapsed plus remaining once underway', () => {
    const estimate = estimateWorkoutDuration(
      [block({ id: 'a', targetSets: 6, completedSets: 3 })],
      { elapsedSeconds: 600 }
    );
    expect(estimate.projectedTotalSeconds).toBe(600 + estimate.remainingSeconds);
  });

  it('projects the full planned duration before the timer starts', () => {
    const blocks = [block({ id: 'a' }), block({ id: 'b' })];
    const estimate = estimateWorkoutDuration(blocks);
    expect(estimate.projectedTotalSeconds).toBe(estimate.totalSeconds);
  });
});

describe('computePaceFactor', () => {
  it('ignores pace with too few sets to judge', () => {
    expect(computePaceFactor(300, 900, DURATION_MODEL.minSetsForPace - 1)).toBe(1);
  });

  it('ignores degenerate inputs', () => {
    expect(computePaceFactor(0, 900, 5)).toBe(1);
    expect(computePaceFactor(300, 0, 5)).toBe(1);
  });

  it('clamps at both ends', () => {
    expect(computePaceFactor(300, 30, 5)).toBe(DURATION_MODEL.minPaceFactor);
    expect(computePaceFactor(300, 30000, 5)).toBe(DURATION_MODEL.maxPaceFactor);
  });
});

describe('formatDurationEstimate', () => {
  it('rounds to 5-minute granularity', () => {
    expect(formatDurationEstimate(43 * 60)).toBe('45 min');
    expect(formatDurationEstimate(41 * 60)).toBe('40 min');
  });

  it('never claims zero minutes of work', () => {
    expect(formatDurationEstimate(10)).toBe('5 min');
    expect(formatDurationEstimate(0)).toBe('5 min');
  });

  it('switches to hours past the hour mark', () => {
    expect(formatDurationEstimate(75 * 60)).toBe('1h 15m');
    expect(formatDurationEstimate(120 * 60)).toBe('2h');
  });

  it('honours a custom rounding step', () => {
    expect(formatDurationEstimate(43 * 60, { roundToMinutes: 1 })).toBe('43 min');
  });
});

describe('formatDurationDelta', () => {
  it('signs the delta', () => {
    expect(formatDurationDelta(10 * 60)).toBe('+10 min');
    expect(formatDurationDelta(-10 * 60)).toBe('-10 min');
  });
});
