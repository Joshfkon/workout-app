/**
 * Worked examples from the engine review, one describe per finding.
 *
 *  2. position-match add_load: reps reset to the range floor (no "trade one
 *     rep" off a 25% jump), on the within-session AND the session-start seed
 *     path, and a guessed increment never extends the rep ceiling.
 *  3. (simulation Finding 001) a set that ended at or below target RIR is a
 *     ceiling: nothing at or above its load may ask for more reps.
 *  7. below the 10-effective-rep crossover the session-start seed inverts a
 *     canonical (Brzycki) anchor with Brzycki, so a low-rep set that hit its
 *     target seeds the same load instead of 2.5 kg lighter.
 */
import {
  matchPositionTarget,
  recommendSeedForSlot,
  recommendSessionStart,
  recommendSet,
  type PrevSessionSet,
} from '../setRecommender';
import { estimateE1RM } from '../shared/e1rm';

const RANGE: [number, number] = [8, 12];

describe('finding 2 — add_load resets reps to the range floor', () => {
  const lightSets = (weightKg: number): PrevSessionSet[] => [
    { weightKg, reps: 14, rir: 2 },
    { weightKg, reps: 14, rir: 2 },
    { weightKg, reps: 14, rir: 2 },
  ];

  it.each([
    [10, 12.5],
    [20, 22.5],
  ])('%d kg × 14 @2 (ceiling extended to 14) steps to %d kg × 8, not × 13', (prev, next) => {
    const target = matchPositionTarget({
      position: 0,
      prevSessionSets: lightSets(prev),
      todaySets: [],
      plannedSetCount: 3,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    expect(target).toEqual(
      expect.objectContaining({ weightKg: next, reps: 8, progression: 'add_load' })
    );
  });

  it('the step is exactly one smallest increment, whatever the increment set', () => {
    const target = matchPositionTarget({
      position: 0,
      prevSessionSets: [
        { weightKg: 100, reps: 12, rir: 2 },
        { weightKg: 100, reps: 12, rir: 2 },
      ],
      todaySets: [],
      plannedSetCount: 2,
      targetRepRange: RANGE,
      targetRir: 2,
      availableIncrementsKg: [4.54, 1.13],
    });
    expect(target?.weightKg).toBeCloseTo(101.13, 5);
    expect(target?.reps).toBe(8);
  });

  it('a GUESSED increment never extends the ceiling: 10 × 14 is out of scheme, not a trade', () => {
    // No increment recorded → the nominal ceiling (12) applies, 14 is past
    // it, and the match stands down for the anchor path.
    expect(
      matchPositionTarget({
        position: 0,
        prevSessionSets: lightSets(10),
        todaySets: [],
        plannedSetCount: 3,
        targetRepRange: RANGE,
        targetRir: 2,
      })
    ).toBeNull();
  });

  it('the session-start seed path applies the same rule', () => {
    const seed = recommendSeedForSlot({
      role: 'working',
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      prevSessionSets: lightSets(10),
      slotIndex: 0,
      plannedSetCount: 3,
    });
    expect(seed.anchorSource).toBe('position_match');
    expect(seed.weightKg).toBe(12.5);
    expect(seed.seedReps).toBe(8);
  });

  it('agrees with recommendSessionStart: an earned bump seeds repMin on both paths', () => {
    const met: PrevSessionSet[] = [
      { weightKg: 100, reps: 12, rir: 2 },
      { weightKg: 100, reps: 12, rir: 2 },
    ];
    const start = recommendSessionStart({
      prevWeightKg: 100,
      prevReps: 12,
      prevRir: 2,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      prevSessionSets: met,
      priorSessionSets: [],
    });
    const matched = matchPositionTarget({
      position: 0,
      prevSessionSets: met,
      todaySets: [],
      plannedSetCount: 2,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    expect(start.rationale).toBe('increase_load');
    expect(start.reps).toBe(8);
    expect(matched?.reps).toBe(start.reps);
    expect(matched?.weightKg).toBe(start.weightKg);
  });
});

describe('finding 3 — a just-missed set is a ceiling (simulation Finding 001)', () => {
  // 85×10 @2, then 80×9 @1; last session's set 3 was 77.5×10 @2.
  const previous: PrevSessionSet[] = [
    { weightKg: 82.5, reps: 10, rir: 2 },
    { weightKg: 77.5, reps: 10, rir: 2 },
    { weightKg: 77.5, reps: 10, rir: 2 },
  ];
  const today = [
    { weightKg: 85, reps: 10, rir: 2 },
    { weightKg: 80, reps: 9, rir: 1 },
  ];
  const rx = () =>
    recommendSet({
      lastWeightKg: 80,
      lastReps: 9,
      lastRir: 1,
      setsCompletedThisExercise: 2,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      sessionObservedSets: today,
      positionContext: {
        prevSessionSets: previous,
        todaySets: today.map(({ weightKg, reps }) => ({ weightKg, reps })),
        plannedSetCount: 3,
      },
    });

  it('does not come back with 80 × 10 — the set that just failed', () => {
    const next = rx();
    expect({ weightKg: next.weightKg, reps: next.reps }).not.toEqual({ weightKg: 80, reps: 10 });
    // The lever's 80×10 candidate is refused, so the positional ask stands.
    expect(next.weightKg).toBe(77.5);
    expect(next.provenance?.source).not.toBe('load_lever');
  });

  it('never asks for more reps at or above the load of a set that ended at/below target RIR', () => {
    for (const lastReps of [6, 8, 9, 10, 11, 12]) {
      for (const lastRir of [0, 1, 2]) {
        for (const prevReps of [8, 9, 10, 11, 12]) {
          for (const prevWeightKg of [77.5, 80, 82.5]) {
            const done = [{ weightKg: 80, reps: lastReps, rir: lastRir }];
            const next = recommendSet({
              lastWeightKg: 80,
              lastReps,
              lastRir,
              setsCompletedThisExercise: 1,
              targetRepRange: RANGE,
              targetRir: 2,
              minIncrementKg: 2.5,
              sessionObservedSets: done,
              positionContext: {
                prevSessionSets: [
                  { weightKg: 80, reps: 10, rir: 2 },
                  { weightKg: prevWeightKg, reps: prevReps, rir: 2 },
                  { weightKg: prevWeightKg, reps: prevReps, rir: 2 },
                ],
                todaySets: [{ weightKg: 80, reps: lastReps }],
                plannedSetCount: 3,
              },
            });
            if (next.weightKg >= 80) {
              expect(next.reps).toBeLessThanOrEqual(lastReps);
            }
          }
        }
      }
    }
  });

  it('a set left EASIER than target is not a ceiling: the positional +1 rep still stands', () => {
    const flat: PrevSessionSet[] = [
      { weightKg: 100, reps: 10, rir: 2 },
      { weightKg: 100, reps: 10, rir: 2 },
      { weightKg: 100, reps: 10, rir: 2 },
    ];
    const next = recommendSet({
      lastWeightKg: 100,
      lastReps: 10,
      lastRir: 3,
      setsCompletedThisExercise: 1,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      sessionObservedSets: [{ weightKg: 100, reps: 10, rir: 3 }],
      positionContext: {
        prevSessionSets: flat,
        todaySets: [{ weightKg: 100, reps: 10 }],
        plannedSetCount: 3,
      },
    });
    expect({ weightKg: next.weightKg, reps: next.reps }).toEqual({ weightKg: 100, reps: 11 });
  });

  it('does not apply at session start — last session is not an observation of today', () => {
    // Low-rep range, so the +1 rep is measurable and no lever is involved:
    // the session-start replay of 100 × 5 @2 must still ask 100 × 6.
    const previousSession: PrevSessionSet[] = [
      { weightKg: 100, reps: 5, rir: 2 },
      { weightKg: 100, reps: 5, rir: 2 },
    ];
    const first = recommendSet({
      lastWeightKg: 100,
      lastReps: 5,
      lastRir: 2,
      setsCompletedThisExercise: 0,
      targetRepRange: [3, 6],
      targetRir: 2,
      minIncrementKg: 2.5,
      sessionObservedSets: [],
      positionContext: { prevSessionSets: previousSession, todaySets: [], plannedSetCount: 2 },
    });
    expect({ weightKg: first.weightKg, reps: first.reps }).toEqual({ weightKg: 100, reps: 6 });
    expect(first.sessionCapacityClamped).toBeUndefined();

    // …and the same ask IS trimmed once that set has actually been done today.
    const second = recommendSet({
      lastWeightKg: 100,
      lastReps: 5,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: [3, 6],
      targetRir: 2,
      minIncrementKg: 2.5,
      sessionObservedSets: [{ weightKg: 100, reps: 5, rir: 2 }],
      positionContext: {
        prevSessionSets: previousSession,
        todaySets: [{ weightKg: 100, reps: 5 }],
        plannedSetCount: 2,
      },
    });
    expect({ weightKg: second.weightKg, reps: second.reps }).toEqual({ weightKg: 100, reps: 5 });
  });
});

describe('finding 7 — a canonical anchor is not priced LOW at session start', () => {
  it('100 × 5 @1 (anchor 116.1) seeds 100 again, not 97.5', () => {
    const anchor = estimateE1RM(100, 5, 1)!.value;
    expect(anchor).toBe(116.1);
    const seed = recommendSeedForSlot({
      role: 'working',
      targetRepRange: [4, 6],
      targetRir: 1,
      minIncrementKg: 2.5,
      anchorE1RMKg: anchor,
      recentWorkingWeightKg: 100,
    });
    expect(seed.anchorSource).toBe('e1rm');
    expect(seed.weightKg).toBe(100);
  });

  it('round-trips at and below the 10-effective-rep crossover', () => {
    for (const [reps, rir, range] of [
      [3, 1, [2, 4]],
      [4, 1, [3, 5]],
      [6, 2, [5, 7]],
      [8, 2, [6, 10]],
    ] as Array<[number, number, [number, number]]>) {
      const seed = recommendSeedForSlot({
        role: 'working',
        targetRepRange: range,
        targetRir: rir,
        minIncrementKg: 2.5,
        anchorE1RMKg: estimateE1RM(100, reps, rir)!.value,
        // No recent weight: the raw pick, with no clamp or noise floor to
        // hide a formula mismatch.
      });
      expect(seed.weightKg).toBe(100);
    }
  });

  it('above the crossover the common 8–12 @2 seed is deliberately unchanged', () => {
    // The pinned staple (engineRegressionBaseline): a 140.4 anchor against a
    // recent 100 holds at 100. The exact canonical inverse would say 97.5.
    const staple = recommendSeedForSlot({
      role: 'working',
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      anchorE1RMKg: 140.4,
      recentWorkingWeightKg: 100,
    });
    expect(staple.weightKg).toBe(100);

    // A session that MET its prescription still earns its bump…
    const earned = recommendSeedForSlot({
      role: 'working',
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      anchorE1RMKg: estimateE1RM(100, 12, 2)!.value,
      recentWorkingWeightKg: 100,
      prevSessionSets: [
        { weightKg: 100, reps: 12, rir: 2 },
        { weightKg: 100, reps: 12, rir: 2 },
      ],
    });
    expect(earned.weightKg).toBe(102.5);

    // …and one that did not is held by the bump gate.
    const notEarned = recommendSeedForSlot({
      role: 'working',
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      anchorE1RMKg: 144,
      recentWorkingWeightKg: 100,
      prevSessionSets: [
        { weightKg: 100, reps: 10, rir: 2 },
        { weightKg: 100, reps: 9, rir: 1 },
      ],
    });
    expect(notEarned.weightKg).toBe(100);
  });
});
