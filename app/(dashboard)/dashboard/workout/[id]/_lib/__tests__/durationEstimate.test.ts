import type { SetLog } from '@/types/schema';
import {
  ADDED_BLOCK_DEFAULTS,
  estimatePendingAdditionSeconds,
  estimateSessionDuration,
  secondsSinceLastSet,
  toDurationBlocks,
} from '../durationEstimate';
import type { ExerciseBlockWithExercise } from '../types';

type BlockOverrides = Omit<Partial<ExerciseBlockWithExercise>, 'exercise'> & {
  id: string;
  exercise?: Partial<ExerciseBlockWithExercise['exercise']>;
};

function makeBlock(overrides: BlockOverrides): ExerciseBlockWithExercise {
  const { exercise, ...rest } = overrides;
  return {
    workoutSessionId: 'session-1',
    exerciseId: `ex-${rest.id}`,
    order: 1,
    supersetGroupId: null,
    supersetOrder: null,
    targetSets: 3,
    targetRepRange: [8, 12],
    targetRir: 2,
    targetWeightKg: 60,
    targetRestSeconds: 120,
    progressionType: null,
    suggestionReason: '',
    warmupProtocol: [],
    note: null,
    dropsetsPerSet: 0,
    dropPercentage: 0.25,
    ...rest,
    exercise: {
      id: `ex-${rest.id}`,
      name: 'Bench Press',
      primaryMuscle: 'chest',
      secondaryMuscles: [],
      mechanic: 'compound',
      defaultRepRange: [8, 12],
      defaultRir: 2,
      minWeightIncrementKg: 2.5,
      formCues: [],
      commonMistakes: [],
      setupNote: '',
      movementPattern: '',
      equipmentRequired: [],
      ...exercise,
    },
  } as ExerciseBlockWithExercise;
}

let setCounter = 0;

function makeSet(overrides: Partial<SetLog> & { exerciseBlockId: string }): SetLog {
  setCounter += 1;
  return {
    id: `set-${setCounter}`,
    setNumber: 1,
    weightKg: 60,
    reps: 10,
    rpe: 8,
    restSeconds: null,
    isWarmup: false,
    loggedAt: new Date().toISOString(),
    ...overrides,
  } as SetLog;
}

describe('toDurationBlocks', () => {
  it('counts working sets and ignores warmups in the completed tally', () => {
    const blocks = [makeBlock({ id: 'b1', targetSets: 4 })];
    const sets = [
      makeSet({ exerciseBlockId: 'b1' }),
      makeSet({ exerciseBlockId: 'b1' }),
      makeSet({ exerciseBlockId: 'b1', isWarmup: true }),
      makeSet({ exerciseBlockId: 'b1', setType: 'warmup' }),
    ];

    const [mapped] = toDurationBlocks(blocks, sets, new Set());
    expect(mapped.completedSets).toBe(2);
    expect(mapped.targetSets).toBe(4);
  });

  it('carries the block rest, mechanic and superset grouping through', () => {
    const blocks = [
      makeBlock({
        id: 'b1',
        targetRestSeconds: 90,
        supersetGroupId: 'group-1',
        exercise: { mechanic: 'isolation' },
      }),
    ];

    const [mapped] = toDurationBlocks(blocks, [], new Set());
    expect(mapped).toMatchObject({
      restSeconds: 90,
      mechanic: 'isolation',
      supersetGroupId: 'group-1',
    });
  });

  it('still owes warmup time on an exercise that has not started', () => {
    const blocks = [
      makeBlock({
        id: 'b1',
        warmupProtocol: [
          { setNumber: 1, percentOfWorking: 50, targetReps: 8, purpose: 'activation', restSeconds: 30 },
          { setNumber: 2, percentOfWorking: 75, targetReps: 5, purpose: 'groove', restSeconds: 30 },
        ],
      }),
    ];

    const [mapped] = toDurationBlocks(blocks, [], new Set());
    expect(mapped.warmupSetsRemaining).toBe(2);
    expect(mapped.warmupRestSeconds).toBe(30);
  });

  it('stops charging warmup time once a working set is in', () => {
    const blocks = [
      makeBlock({
        id: 'b1',
        warmupProtocol: [
          { setNumber: 1, percentOfWorking: 50, targetReps: 8, purpose: 'activation', restSeconds: 30 },
        ],
      }),
    ];

    const [mapped] = toDurationBlocks(blocks, [makeSet({ exerciseBlockId: 'b1' })], new Set());
    expect(mapped.warmupSetsRemaining).toBe(0);
  });

  it('discounts logged warmups from what is still owed', () => {
    const blocks = [
      makeBlock({
        id: 'b1',
        warmupProtocol: [
          { setNumber: 1, percentOfWorking: 50, targetReps: 8, purpose: 'activation', restSeconds: 30 },
          { setNumber: 2, percentOfWorking: 75, targetReps: 5, purpose: 'groove', restSeconds: 30 },
        ],
      }),
    ];

    const [mapped] = toDurationBlocks(
      blocks,
      [makeSet({ exerciseBlockId: 'b1', isWarmup: true })],
      new Set()
    );
    expect(mapped.warmupSetsRemaining).toBe(1);
  });

  it('reports logged warmups so pace calibration can account for them', () => {
    const blocks = [
      makeBlock({
        id: 'b1',
        warmupProtocol: [
          { setNumber: 1, percentOfWorking: 50, targetReps: 8, purpose: 'activation', restSeconds: 30 },
          { setNumber: 2, percentOfWorking: 75, targetReps: 5, purpose: 'groove', restSeconds: 30 },
        ],
      }),
    ];
    const sets = [
      makeSet({ exerciseBlockId: 'b1', isWarmup: true }),
      makeSet({ exerciseBlockId: 'b1', setType: 'warmup' }),
      makeSet({ exerciseBlockId: 'b1' }),
    ];

    const [mapped] = toDurationBlocks(blocks, sets, new Set());
    // The timer has been running since the first of those warmups.
    expect(mapped.warmupSetsCompleted).toBe(2);
    expect(mapped.warmupSetsRemaining).toBe(0);
  });

  it('marks skipped blocks so they drop out of the estimate', () => {
    const blocks = [makeBlock({ id: 'b1' }), makeBlock({ id: 'b2' })];
    const mapped = toDurationBlocks(blocks, [], new Set(['b2']));
    expect(mapped.map((b) => b.skipped)).toEqual([false, true]);
  });
});

describe('estimateSessionDuration', () => {
  it('shrinks the remaining estimate as sets are logged', () => {
    const blocks = [makeBlock({ id: 'b1', targetSets: 4 })];
    const fresh = estimateSessionDuration({
      blocks,
      completedSets: [],
      skippedBlockIds: new Set(),
    });
    const partway = estimateSessionDuration({
      blocks,
      completedSets: [makeSet({ exerciseBlockId: 'b1' }), makeSet({ exerciseBlockId: 'b1' })],
      skippedBlockIds: new Set(),
    });

    expect(partway.remainingSeconds).toBeLessThan(fresh.remainingSeconds);
    expect(partway.remainingSets).toBe(2);
  });

  it('excludes skipped exercises from the planned total', () => {
    const blocks = [makeBlock({ id: 'b1' }), makeBlock({ id: 'b2' })];
    const estimate = estimateSessionDuration({
      blocks,
      completedSets: [],
      skippedBlockIds: new Set(['b2']),
    });
    expect(estimate.exerciseCount).toBe(1);
    expect(estimate.totalSets).toBe(3);
  });
});

describe('secondsSinceLastSet', () => {
  const START = Date.parse('2026-08-05T10:00:00.000Z');
  /** Wall-clock stamp `offsetSeconds` into the session. */
  const at = (offsetSeconds: number) => new Date(START + offsetSeconds * 1000).toISOString();
  const nowAt = (offsetSeconds: number) => START + offsetSeconds * 1000;

  it('is zero when nothing has been logged', () => {
    expect(secondsSinceLastSet([], nowAt(300))).toBe(0);
  });

  it('measures from the most recent set, not the first', () => {
    const sets = [
      makeSet({ exerciseBlockId: 'b1', loggedAt: at(0) }),
      makeSet({ exerciseBlockId: 'b1', loggedAt: at(165) }),
    ];
    expect(secondsSinceLastSet(sets, nowAt(200))).toBe(35);
  });

  it('is zero at the instant a set is logged', () => {
    const sets = [makeSet({ exerciseBlockId: 'b1', loggedAt: at(165) })];
    expect(secondsSinceLastSet(sets, nowAt(165))).toBe(0);
  });

  it('freezes at the moment the timer was paused', () => {
    const sets = [makeSet({ exerciseBlockId: 'b1', loggedAt: at(165) })];
    // Paused 15s into the rest; wall clock has since run on to 600s.
    expect(secondsSinceLastSet(sets, nowAt(600), nowAt(180))).toBe(15);
    // Still frozen however long the pause lasts.
    expect(secondsSinceLastSet(sets, nowAt(5000), nowAt(180))).toBe(15);
  });

  it('credits a rest in full after a long pause EARLIER in the session', () => {
    // The regression this signature exists for: a 10-minute pause between
    // set 1 and set 2 used to swallow the whole rest after set 2, because the
    // gap was derived from a pause-excluding elapsed reading. The window opens
    // at the last set, so an earlier pause is simply outside it.
    const sets = [
      makeSet({ exerciseBlockId: 'b1', loggedAt: at(0) }),
      makeSet({ exerciseBlockId: 'b1', loggedAt: at(645) }), // after a 10 min pause
    ];
    expect(secondsSinceLastSet(sets, nowAt(645 + 120))).toBe(120);
  });

  it('never returns a negative gap from clock skew', () => {
    const sets = [makeSet({ exerciseBlockId: 'b1', loggedAt: at(600) })];
    expect(secondsSinceLastSet(sets, nowAt(120))).toBe(0);
  });

  it('ignores sets with no usable timestamp', () => {
    const sets = [
      makeSet({ exerciseBlockId: 'b1', loggedAt: at(0) }),
      makeSet({ exerciseBlockId: 'b1', loggedAt: '' }),
      makeSet({ exerciseBlockId: 'b1', loggedAt: 'not-a-date' }),
      makeSet({ exerciseBlockId: 'b1', loggedAt: at(100) }),
    ];
    expect(secondsSinceLastSet(sets, nowAt(150))).toBe(50);
  });
});

describe('estimatePendingAdditionSeconds', () => {
  it('is zero with nothing selected', () => {
    expect(estimatePendingAdditionSeconds([], [])).toBe(0);
  });

  it('charges a compound more than an isolation', () => {
    const current = toDurationBlocks([makeBlock({ id: 'b1' })], [], new Set());
    const compound = estimatePendingAdditionSeconds(current, [{ id: 'x', mechanic: 'compound' }]);
    const isolation = estimatePendingAdditionSeconds(current, [{ id: 'x', mechanic: 'isolation' }]);
    expect(compound).toBeGreaterThan(isolation);
  });

  it('grows with each additional selection', () => {
    const current = toDurationBlocks([makeBlock({ id: 'b1' })], [], new Set());
    const one = estimatePendingAdditionSeconds(current, [{ id: 'x', mechanic: 'isolation' }]);
    const two = estimatePendingAdditionSeconds(current, [
      { id: 'x', mechanic: 'isolation' },
      { id: 'y', mechanic: 'isolation' },
    ]);
    expect(two).toBeGreaterThan(one);
  });

  it('uses the same set/rest defaults the add path writes', () => {
    expect(ADDED_BLOCK_DEFAULTS.compound).toEqual({ targetSets: 4, restSeconds: 180 });
    expect(ADDED_BLOCK_DEFAULTS.isolation).toEqual({ targetSets: 3, restSeconds: 90 });
  });
});
