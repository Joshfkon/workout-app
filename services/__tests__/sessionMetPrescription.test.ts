import {
  sessionMetPrescription,
  earnedSessionBump,
  recommendSessionStart,
  type PrevSessionSet,
} from '../setRecommender';

/**
 * Session-to-session progression fix (docs/next-set-recommender-design.md §10).
 *
 * ONE shared success predicate — sessionMetPrescription — decides whether the
 * previous session earned a load bump, consumed by BOTH earnedSessionBump (the
 * seed/anchor gate) and recommendSessionStart (the rep seeding). Qualification
 * is graded on the TOP working set(s) only: reps >= repMax, with easier-than-
 * target effort still counting as success (effort overshoot). Feeder sets
 * (below 75% of top load) and out-of-scheme sets (reps outside
 * [repMin, max(2·repMin, repMax)] — e.g. a heavy 200×4 pyramid top against a
 * 6–10 range) are excluded from grading.
 *
 * Seeding rules:
 *  - last session NOT met, no red flags → prevReps + 1, capped at repMax
 *  - last session MET → bump load (existing e1RM math), seed reps at repMin
 *  - 2 consecutive sessions missing the same prescription → hold
 *  - 3 consecutive → hold + suggestDeload flag (flag only, no UI)
 *  - malformed set data → log a warning and hold; never crash, never guess
 */

const RANGE: [number, number] = [6, 10];
const TARGET_RIR = 2;
const INC = 2.5;
const TARGET = { targetRepRange: RANGE, targetRir: TARGET_RIR };

describe('sessionMetPrescription — the single success predicate', () => {
  it('(a) top set at repMax at 1 RIR under a 2 RIR target is MET (textbook double progression)', () => {
    const sets: PrevSessionSet[] = [{ weightKg: 180, reps: 10, rir: 1 }];
    expect(sessionMetPrescription(sets, TARGET)).toBe(true);
  });

  it('(b) a heavy low-rep pyramid top set (200×4 vs a 6–10 range) never causes failure by itself', () => {
    const pyramid: PrevSessionSet[] = [
      { weightKg: 200, reps: 4, rir: 0 },
      { weightKg: 180, reps: 8, rir: 1 },
      { weightKg: 160, reps: 10, rir: 2 },
    ];
    const withoutOverload: PrevSessionSet[] = [
      { weightKg: 180, reps: 8, rir: 1 },
      { weightKg: 160, reps: 10, rir: 2 },
    ];
    // The 200×4 set is out-of-scheme (below the range floor) → excluded from
    // grading, so its presence must not change the verdict.
    expect(() => sessionMetPrescription(pyramid, TARGET)).not.toThrow();
    expect(sessionMetPrescription(pyramid, TARGET)).toBe(
      sessionMetPrescription(withoutOverload, TARGET)
    );
    // And when the graded top set DID reach repMax, the overload set must not block.
    const pyramidMet: PrevSessionSet[] = [
      { weightKg: 200, reps: 4, rir: 0 },
      { weightKg: 180, reps: 10, rir: 2 },
    ];
    expect(sessionMetPrescription(pyramidMet, TARGET)).toBe(true);
  });

  it('(c) repMax at 4 RIR is MET — overshoot on effort is still success', () => {
    const sets: PrevSessionSet[] = [{ weightKg: 180, reps: 10, rir: 4 }];
    expect(sessionMetPrescription(sets, TARGET)).toBe(true);
  });

  it('(d) mid-range top set (180×8 @ 2 RIR vs 6–10) is NOT met — repMax not reached', () => {
    const sets: PrevSessionSet[] = [{ weightKg: 180, reps: 8, rir: 2 }];
    expect(sessionMetPrescription(sets, TARGET)).toBe(false);
  });

  it('(e) rep overshoot (180×12 vs 6–10) is MET', () => {
    const sets: PrevSessionSet[] = [{ weightKg: 180, reps: 12, rir: 2 }];
    expect(sessionMetPrescription(sets, TARGET)).toBe(true);
  });

  it('grades the TOP working set(s) only: a lighter back-off hitting repMax does not qualify the session', () => {
    // 190×8 is the graded top; the 160×10 back-off reaching repMax is not the
    // top set and must not buy a bump on the 190 load.
    const sets: PrevSessionSet[] = [
      { weightKg: 190, reps: 8, rir: 1 },
      { weightKg: 160, reps: 10, rir: 2 },
    ];
    expect(sessionMetPrescription(sets, TARGET)).toBe(false);
  });

  it('feeder sets below 75% of top load are never graded', () => {
    const sets: PrevSessionSet[] = [
      { weightKg: 180, reps: 10, rir: 2 },
      { weightKg: 100, reps: 15, rir: 3 }, // 55% of top — warm-up/feeder
    ];
    expect(sessionMetPrescription(sets, TARGET)).toBe(true);
  });

  it('is false (and does not throw) for empty or malformed sessions', () => {
    expect(sessionMetPrescription([], TARGET)).toBe(false);
    expect(sessionMetPrescription([{ weightKg: 0, reps: 0 }], TARGET)).toBe(false);
    expect(
      sessionMetPrescription([{ weightKg: NaN, reps: 10 }, { weightKg: 100, reps: NaN }], TARGET)
    ).toBe(false);
  });
});

describe('earnedSessionBump delegates to the shared predicate (single source of truth)', () => {
  const fixtures: PrevSessionSet[][] = [
    [{ weightKg: 180, reps: 10, rir: 1 }],
    [{ weightKg: 180, reps: 8, rir: 2 }],
    [
      { weightKg: 200, reps: 4, rir: 0 },
      { weightKg: 180, reps: 10, rir: 2 },
    ],
    [],
  ];

  it.each(fixtures.map((f, i) => [i, f] as const))(
    'fixture %#: earnedSessionBump === sessionMetPrescription',
    (_i, sets) => {
      expect(earnedSessionBump(sets, RANGE, TARGET_RIR)).toBe(
        sessionMetPrescription(sets, TARGET)
      );
    }
  );
});

describe('recommendSessionStart — rep seeding from the predicate', () => {
  const start = (over: Record<string, unknown> = {}) => ({
    prevWeightKg: 180,
    prevReps: 8,
    prevRir: 2,
    targetRepRange: RANGE,
    targetRir: TARGET_RIR,
    minIncrementKg: INC,
    ...over,
  });

  it('NOT met, no red flags → seeds prevReps + 1 at the same load', () => {
    const rec = recommendSessionStart(
      start({ prevSessionSets: [{ weightKg: 180, reps: 8, rir: 2 }] })
    );
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(180);
    expect(rec.reps).toBe(9); // 8 + 1 — the app now ASKS for progression
    expect(rec.suggestDeload).toBeFalsy();
  });

  it('the +1 seed is capped at repMax', () => {
    // Session top (190×8) not met, but THIS slot already sits at repMax.
    const rec = recommendSessionStart(
      start({
        prevReps: 10,
        prevSessionSets: [
          { weightKg: 190, reps: 8, rir: 2 },
          { weightKg: 180, reps: 10, rir: 2 },
        ],
      })
    );
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(180);
    expect(rec.reps).toBe(10); // capped, not 11
  });

  it('(f) MET → bumps the load and RESETS the rep seed to repMin, not prevReps + 1', () => {
    const rec = recommendSessionStart(
      start({ prevReps: 10, prevRir: 1, prevSessionSets: [{ weightKg: 180, reps: 10, rir: 1 }] })
    );
    expect(rec.rationale).toBe('increase_load');
    // e1RM anchor math: Epley(180, 10, 1) = 246; ideal for 10 @ 2 RIR ≈ 175.7
    // rounds at/below the held weight → the one-increment escape fires: 182.5.
    expect(rec.weightKg).toBe(182.5);
    expect(rec.reps).toBe(RANGE[0]);
  });

  it('red flags still win: a below-floor session holds verbatim (no +1) pending the regression rule', () => {
    const rec = recommendSessionStart(
      start({
        prevWeightKg: 100,
        prevReps: 4,
        prevRir: 0,
        prevSessionSets: [{ weightKg: 100, reps: 4, rir: 0 }],
        priorSessionSets: [],
      })
    );
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(100);
    expect(rec.reps).toBe(4); // honest reps, no invented progression on a miss
  });

  it('legacy single-set callers (no session list) also get the +1 seed', () => {
    const rec = recommendSessionStart(start());
    expect(rec.rationale).toBe('maintain');
    expect(rec.reps).toBe(9);
  });
});

describe('recommendSessionStart — stall rule', () => {
  const missAt100 = (reps: number): PrevSessionSet[] => [
    { weightKg: 100, reps, rir: 2 },
    { weightKg: 100, reps: Math.max(1, reps - 1), rir: 2 },
  ];

  const start = (over: Record<string, unknown> = {}) => ({
    prevWeightKg: 100,
    prevReps: 8,
    prevRir: 2,
    targetRepRange: RANGE,
    targetRir: TARGET_RIR,
    minIncrementKg: INC,
    ...over,
  });

  it('2 consecutive sessions missing the same prescription → HOLD (no +1)', () => {
    const rec = recommendSessionStart(
      start({ prevSessionSets: missAt100(8), priorSessionSets: missAt100(8) })
    );
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(100);
    expect(rec.reps).toBe(8); // re-prescribe the same, not 9
    expect(rec.suggestDeload).toBeFalsy();
  });

  it('3 consecutive misses → hold AND set the suggestDeload flag', () => {
    const rec = recommendSessionStart(
      start({
        prevSessionSets: missAt100(8),
        priorSessionSets: missAt100(8),
        earlierSessionSets: missAt100(8),
      })
    );
    expect(rec.rationale).toBe('maintain');
    expect(rec.reps).toBe(8);
    expect(rec.suggestDeload).toBe(true);
  });

  it('rep progress between sessions is NOT a stall — the +1 seed continues', () => {
    const rec = recommendSessionStart(
      start({ prevSessionSets: missAt100(9), priorSessionSets: missAt100(8), prevReps: 9 })
    );
    expect(rec.rationale).toBe('maintain');
    expect(rec.reps).toBe(10); // 9 + 1
    expect(rec.suggestDeload).toBeFalsy();
  });

  it('a load change between sessions is NOT a stall (different prescription)', () => {
    const rec = recommendSessionStart(
      start({
        prevSessionSets: missAt100(8),
        priorSessionSets: missAt100(8).map((s) => ({ ...s, weightKg: 90 })),
      })
    );
    expect(rec.reps).toBe(9); // +1 continues — the 100 load has only missed once
  });
});

describe('recommendSessionStart — malformed data falls back to hold (no crash, no guess)', () => {
  it('an ungradable previous-session list holds the slot verbatim and warns', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rec = recommendSessionStart({
        prevWeightKg: 100,
        prevReps: 8,
        prevRir: 2,
        targetRepRange: RANGE,
        targetRir: TARGET_RIR,
        minIncrementKg: INC,
        prevSessionSets: [{ weightKg: NaN, reps: NaN }],
      });
      expect(rec.rationale).toBe('maintain');
      expect(rec.weightKg).toBe(100);
      expect(rec.reps).toBe(8); // hold, not +1 — the session couldn't be graded
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
