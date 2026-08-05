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
    // 3 remaining sets, each with a rest in FRONT of it — the user is resting
    // right now, having just logged set 1 of exercise b.
    expect(estimate.remainingSeconds).toBe(3 * (120 + 45));
  });

  it('counts the rest the user is currently taking mid-exercise', () => {
    // Just logged set 1 of 4. What is left is rest→set ×3, not set→rest×2→set.
    const midSet = estimateWorkoutDuration([
      block({ id: 'a', targetSets: 4, completedSets: 1, restSeconds: 180 }),
    ]);
    expect(midSet.remainingSeconds).toBe(3 * (180 + 45));

    // Total stays put as sets land — only the split between done and left moves.
    const fresh = estimateWorkoutDuration([
      block({ id: 'a', targetSets: 4, restSeconds: 180 }),
    ]);
    expect(midSet.totalSeconds).toBe(fresh.totalSeconds);
  });

  it('counts the transition ahead when the current exercise just finished', () => {
    const estimate = estimateWorkoutDuration([
      block({ id: 'a', targetSets: 3, completedSets: 3 }),
      block({ id: 'b', targetSets: 3, completedSets: 0 }),
    ]);
    // Walking to the next station is still ahead of the user.
    expect(estimate.remainingSeconds).toBe(
      DURATION_MODEL.transitionSeconds + (3 * 45 + 2 * 120)
    );
  });

  it('keeps done + left equal to the whole session', () => {
    const blocks = [
      block({ id: 'a', targetSets: 3, completedSets: 2, warmupSetsCompleted: 2 }),
      block({ id: 'b', targetSets: 4, completedSets: 0, warmupSetsRemaining: 3 }),
    ];
    const estimate = estimateWorkoutDuration(blocks);
    const completedModel = estimate.totalSeconds - estimate.remainingSeconds;
    expect(completedModel).toBeGreaterThan(0);
    expect(estimate.remainingSeconds + completedModel).toBe(estimate.totalSeconds);
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

  it('reads a user who is exactly on model as on pace', () => {
    // 4 sets logged, 120s rest: elapsed since the first set's log is
    // 3 x (rest + work) = 495s. That is the model, so no correction.
    const estimate = estimateWorkoutDuration(
      [block({ id: 'a', targetSets: 8, completedSets: 4, restSeconds: 120 })],
      { elapsedSeconds: 3 * (120 + 45) }
    );
    expect(estimate.paceFactor).toBe(1);
    expect(estimate.isCalibrated).toBe(false);
  });

  it('does not read logged warmup time as slowness', () => {
    // Timer anchors on the first logged set — a WARMUP here. Elapsed therefore
    // covers 2 more warmups then 3 working sets, all exactly on model.
    const blocks = [
      block({
        id: 'a',
        targetSets: 6,
        completedSets: 3,
        restSeconds: 120,
        warmupSetsCompleted: 3,
        warmupRestSeconds: 45,
      }),
    ];
    const warmupSpan = 2 * (DURATION_MODEL.warmupWorkSeconds + 45) + 45; // 2 warmups + rest into set 1
    const workingSpan = 3 * 45 + 2 * 120;
    const estimate = estimateWorkoutDuration(blocks, {
      elapsedSeconds: warmupSpan + workingSpan,
    });
    expect(estimate.paceFactor).toBe(1);
  });

  it('still detects real slowness in a session that logged warmups', () => {
    const blocks = [
      block({
        id: 'a',
        targetSets: 6,
        completedSets: 3,
        restSeconds: 120,
        warmupSetsCompleted: 3,
        warmupRestSeconds: 45,
      }),
    ];
    // Model span from the anchor: 2 warmups + the rest into set 1, then the
    // three working sets.
    const onModelSpan = 2 * (DURATION_MODEL.warmupWorkSeconds + 45) + 45 + (3 * 45 + 2 * 120);
    expect(estimateWorkoutDuration(blocks, { elapsedSeconds: onModelSpan }).paceFactor).toBe(1);

    const dawdling = estimateWorkoutDuration(blocks, { elapsedSeconds: onModelSpan * 1.5 });
    expect(dawdling.paceFactor).toBeCloseTo(1.5, 5);
  });

  it('counts down through a rest instead of climbing', () => {
    const blocks = [block({ id: 'a', targetSets: 8, completedSets: 4, restSeconds: 120 })];
    // On-model user who has just logged set 4: elapsed = 3 x (rest + work).
    const atLog = estimateWorkoutDuration(blocks, {
      elapsedSeconds: 3 * (120 + 45),
      secondsSinceLastSet: 0,
    });
    // Same user 60s into their 120s rest — a minute of the gap is now served.
    const midRest = estimateWorkoutDuration(blocks, {
      elapsedSeconds: 3 * (120 + 45) + 60,
      secondsSinceLastSet: 60,
    });

    expect(midRest.remainingSeconds).toBe(atLog.remainingSeconds - 60);
    // Resting on schedule is not slowness.
    expect(midRest.paceFactor).toBe(1);
  });

  it('holds an on-model resting user at exactly one throughout the rest', () => {
    const blocks = [block({ id: 'a', targetSets: 8, completedSets: 4, restSeconds: 120 })];
    for (const served of [0, 30, 60, 90, 120]) {
      const estimate = estimateWorkoutDuration(blocks, {
        elapsedSeconds: 3 * (120 + 45) + served,
        secondsSinceLastSet: served,
      });
      expect(estimate.paceFactor).toBe(1);
      // 4 sets left, the last rest fully served at 120.
      expect(estimate.remainingSeconds).toBe(4 * 45 + 4 * 120 - served);
    }
  });

  it('reads overstaying a rest as genuine slowness', () => {
    const blocks = [block({ id: 'a', targetSets: 8, completedSets: 4, restSeconds: 120 })];
    // Five minutes into a two-minute rest: credit caps at the prescription.
    const estimate = estimateWorkoutDuration(blocks, {
      elapsedSeconds: 3 * (120 + 45) + 300,
      secondsSinceLastSet: 300,
    });
    expect(estimate.paceFactor).toBeGreaterThan(1);
    // Remaining never gets credited past the gap's real length.
    expect(estimate.remainingSeconds).toBeGreaterThanOrEqual(4 * 45 + 3 * 120);
  });

  it('credits the transition when the current exercise is finished', () => {
    const blocks = [
      block({ id: 'a', targetSets: 3, completedSets: 3 }),
      block({ id: 'b', targetSets: 3, completedSets: 0 }),
    ];
    const atLog = estimateWorkoutDuration(blocks, { secondsSinceLastSet: 0 });
    const walking = estimateWorkoutDuration(blocks, { secondsSinceLastSet: 30 });
    expect(walking.remainingSeconds).toBe(atLog.remainingSeconds - 30);
  });

  it('has no gap to credit once every set is logged', () => {
    const estimate = estimateWorkoutDuration(
      [block({ id: 'a', targetSets: 3, completedSets: 3 })],
      { secondsSinceLastSet: 600 }
    );
    expect(estimate.remainingSeconds).toBe(0);
  });

  it('credits only a changeover between superset partners', () => {
    const blocks = [
      block({ id: 'a', targetSets: 3, completedSets: 2, supersetGroupId: 'g1' }),
      block({ id: 'b', targetSets: 3, completedSets: 1, supersetGroupId: 'g1' }),
    ];
    // Partner b is up next, reached by a changeover — not a full rest.
    const atLog = estimateWorkoutDuration(blocks, { secondsSinceLastSet: 0 });
    const later = estimateWorkoutDuration(blocks, { secondsSinceLastSet: 600 });
    expect(atLog.remainingSeconds - later.remainingSeconds).toBe(
      DURATION_MODEL.supersetChangeoverSeconds
    );
  });

  it('credits the group rest once a superset round is complete', () => {
    const blocks = [
      block({ id: 'a', targetSets: 3, completedSets: 2, supersetGroupId: 'g1', restSeconds: 90 }),
      block({ id: 'b', targetSets: 3, completedSets: 2, supersetGroupId: 'g1', restSeconds: 150 }),
    ];
    // Both members are level, so the round just closed. supersetFlow rests on
    // the group's LAST member, so the gap being served is b's 150s — not a's.
    const atLog = estimateWorkoutDuration(blocks, { secondsSinceLastSet: 0 });
    const later = estimateWorkoutDuration(blocks, { secondsSinceLastSet: 600 });
    expect(atLog.remainingSeconds - later.remainingSeconds).toBe(150);
  });

  it('treats a trailing superset member that got ahead as a changeover', () => {
    // Not reachable through the normal L→H round-robin, but a reorder or a
    // manually logged set can produce it: the member behind is up next, and
    // reaching them is a changeover rather than a full rest.
    const blocks = [
      block({ id: 'a', targetSets: 3, completedSets: 1, supersetGroupId: 'g1' }),
      block({ id: 'b', targetSets: 3, completedSets: 2, supersetGroupId: 'g1', restSeconds: 150 }),
    ];
    const atLog = estimateWorkoutDuration(blocks, { secondsSinceLastSet: 0 });
    const later = estimateWorkoutDuration(blocks, { secondsSinceLastSet: 600 });
    expect(atLog.remainingSeconds - later.remainingSeconds).toBe(
      DURATION_MODEL.supersetChangeoverSeconds
    );
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
