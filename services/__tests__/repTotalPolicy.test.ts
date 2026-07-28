import {
  resolveProgressionModel,
  recommendRepTotalSessionStart,
  recommendRepTotalNextSet,
  expectedRepsAfterLoadChange,
} from '../suggestionEngine/repTotalPolicy';

describe('resolveProgressionModel', () => {
  it('explicit column value always wins', () => {
    expect(resolveProgressionModel('rep_total', 10, 0)).toBe('rep_total');
    expect(resolveProgressionModel('e1rm', 0, 10)).toBe('e1rm');
  });
  it('NULL auto-classifies: majority-inestimable history routes to rep_total', () => {
    expect(resolveProgressionModel(null, 2, 5)).toBe('rep_total');
    expect(resolveProgressionModel(undefined, 5, 2)).toBe('e1rm');
    expect(resolveProgressionModel(null, 3, 3)).toBe('e1rm'); // tie → e1rm
  });
});

describe('recommendRepTotalSessionStart', () => {
  const LB135_KG = 61.23496995;
  const range: [number, number] = [12, 20];

  it('repeat: holds the load VERBATIM and asks to beat last total by one', () => {
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: LB135_KG, reps: 12, rir: 1 },
        { weightKg: LB135_KG, reps: 10, rir: 1 },
        { weightKg: LB135_KG, reps: 8, rir: 1 },
      ],
      targetRepRange: range,
      targetRir: 2,
      minIncrementKg: 4.54,
      plannedSets: 3,
    })!;
    expect(plan.weightKg).toBe(LB135_KG); // no grid snapping, ever
    expect(plan.bumped).toBe(false); // sets 2-3 below the 12 floor
    expect(plan.prevSessionRepTotal).toBe(30);
    expect(plan.sessionRepTotalTarget).toBe(31);
    // Per-set seeds mirror last session, floored at 12: 12 / 12 / 12.
    expect(plan.perSetRepTargets).toEqual([12, 12, 12]);
  });

  it('bump: every set at/above the floor at target effort adds ONE native increment', () => {
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 61.23, reps: 14, rir: 2 },
        { weightKg: 61.23, reps: 13, rir: 2 },
        { weightKg: 61.23, reps: 12, rir: 3 },
      ],
      targetRepRange: range,
      targetRir: 2,
      minIncrementKg: 4.54,
      plannedSets: 3,
    })!;
    expect(plan.bumped).toBe(true);
    expect(plan.weightKg).toBeCloseTo(61.23 + 4.54, 5); // +10 lb, additive
    expect(plan.perSetRepTargets).toEqual([12, 12, 12]); // reps reset to floor
    expect(plan.sessionRepTotalTarget).toBe(36);
  });

  it('too-easy sets (RIR way above target) do NOT earn the bump — chase reps instead', () => {
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 61.23, reps: 14, rir: 4 }, // 2 over target+tolerance
        { weightKg: 61.23, reps: 13, rir: 2 },
      ],
      targetRepRange: range,
      targetRir: 2,
      minIncrementKg: 4.54,
      plannedSets: 2,
    })!;
    expect(plan.bumped).toBe(false);
    expect(plan.weightKg).toBe(61.23);
  });

  it('returns null with no usable history (caller keeps its cold-start path)', () => {
    expect(
      recommendRepTotalSessionStart({
        prevSessionSets: [],
        targetRepRange: range,
        targetRir: 2,
        plannedSets: 3,
      })
    ).toBeNull();
  });
});

describe('expectedRepsAfterLoadChange (non-linear load↔rep exchange)', () => {
  it('matches Epley slope at/below 12 reps: +13% off 12 reps costs ~5', () => {
    // Bayesian Cable Curl live case: 37.5 → 42.5 (+13.3%) off a 12-rep-class
    // set — Epley territory. slope(12) = 0.42/% → ~5.6 reps lost.
    expect(expectedRepsAfterLoadChange(12, 37.5, 42.5)).toBe(6);
  });
  it('flattens above 12 reps: +10% off 17 reps costs ~2, not Epley~4.7', () => {
    // Cable Curl live case: 61.2 → 67.5 (+10.3%) cost the lifter ~1 rep.
    const pred = expectedRepsAfterLoadChange(17, 61.2, 67.5);
    expect(pred).toBeGreaterThanOrEqual(15);
    expect(pred).toBeLessThanOrEqual(16);
  });
  it('is symmetric: a load DECREASE returns reps', () => {
    expect(expectedRepsAfterLoadChange(6, 42.5, 35)).toBeGreaterThan(6);
  });
  it('never returns below 1 and echoes malformed input instead of throwing', () => {
    expect(expectedRepsAfterLoadChange(2, 10, 100)).toBe(1);
    expect(expectedRepsAfterLoadChange(0, 10, 20)).toBe(1);
    expect(expectedRepsAfterLoadChange(10, 0, 20)).toBe(10);
  });
});

describe('recommendRepTotalNextSet (re-derived per set — planner parity)', () => {
  const plan3x = () =>
    recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 61.23, reps: 12, rir: 1 },
        { weightKg: 61.23, reps: 10, rir: 1 },
        { weightKg: 61.23, reps: 8, rir: 1 },
      ],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 4.54,
      plannedSets: 3,
    })!;

  it('follows the plan slot when today matches it', () => {
    const next = recommendRepTotalNextSet({
      sessionPlan: plan3x(),
      observedSets: [
        { weightKg: 61.23, reps: 13, rir: 2 },
        { weightKg: 61.23, reps: 11, rir: 2 },
      ],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 4.54,
    });
    expect(next.weightKg).toBe(61.23);
    expect(next.reps).toBe(12); // slot 3's plan (8 floored to 12)
    expect(next.totalSoFar).toBe(24);
    expect(next.sessionRepTotalTarget).toBe(31);
    expect(next.remainingToTarget).toBe(7);
    expect(next.rationale).toBe('follow_plan');
    expect(next.sessionCapacityClamped).toBeUndefined();
  });

  it('carries positional provenance (INV-4 analog) for a plan-following slot', () => {
    const next = recommendRepTotalNextSet({
      sessionPlan: plan3x(),
      observedSets: [{ weightKg: 61.23, reps: 13, rir: 2 }],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 4.54,
    });
    expect(next.positionRef).toEqual({ setNo: 2, prevReps: 10 });
  });

  it('INV-2 analog: never re-asks the plan after a set that disproves it', () => {
    // The Bayesian Cable Curl defect: bumped plan asks 10, first set delivers
    // 6 @ 0 RIR. The old code re-served 10 at the same load. The rep ask must
    // be bounded by observed capacity — and a below-floor failure set steps
    // the LOAD down instead of re-prescribing at it.
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [{ weightKg: 37.5, reps: 11, rir: 1 }],
      targetRepRange: [10, 15],
      targetRir: 2,
      minIncrementKg: 2.5,
      plannedSets: 4,
    })!;
    expect(plan.bumped).toBe(true); // 11 ≥ 10 at ≤ target+1 effort
    const next = recommendRepTotalNextSet({
      sessionPlan: plan,
      observedSets: [{ weightKg: plan.weightKg, reps: 6, rir: 0 }],
      targetRepRange: [10, 15],
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    // Load steps DOWN (below-floor set at failure = too heavy), and the rep
    // ask derives from the observed set exchanged to the reduced load — the
    // plan's 10 must be gone.
    expect(next.rationale).toBe('reduce_load');
    expect(next.weightKg).toBeLessThan(plan.weightKg);
    expect(next.weightKg).toBeGreaterThanOrEqual(plan.weightKg * 0.7);
    expect(next.reps).toBeLessThanOrEqual(15);
    expect(next.reps).toBeGreaterThanOrEqual(8);
  });

  it('INV-2 analog clamps the ask without a load change when the miss is mild', () => {
    // Set landed IN range but weaker than planned: no reduce (not below
    // floor), but the next ask may not exceed observed capacity.
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 60, reps: 18, rir: 2 },
        { weightKg: 60, reps: 17, rir: 2 },
      ],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 2.5,
      plannedSets: 2,
    })!;
    // Repeat plan (18 @2 cleared floor... actually bumped). Use the plan as
    // built; observe a first set of 13 @ 0 RIR — capacity 13 → ask ceiling 11.
    const next = recommendRepTotalNextSet({
      sessionPlan: plan,
      observedSets: [{ weightKg: plan.weightKg, reps: 13, rir: 0 }],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    expect(next.reps).toBeLessThanOrEqual(11);
    expect(next.sessionCapacityClamped).toBe(true);
  });

  it('INV-1 analog: an out-of-range re-derived ask carries outsideRange', () => {
    const plan = plan3x();
    const next = recommendRepTotalNextSet({
      sessionPlan: plan,
      observedSets: [{ weightKg: 61.23, reps: 12, rir: 0 }],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 4.54,
    });
    // Capacity 12 @ 0 RIR → ask ceiling 10 at 2 RIR — below the 12 floor.
    expect(next.reps).toBeLessThan(12);
    expect(next.outsideRange).toBe('below');
    expect(next.sessionCapacityClamped).toBe(true);
  });

  it('exchanges the plan target onto a lifter-chosen load instead of grading it on the plan load', () => {
    const plan = plan3x();
    // Lifter loaded lighter than the plan: the slot target converts to that
    // load — more reps expected at less weight, not the plan's number.
    const next = recommendRepTotalNextSet({
      sessionPlan: plan,
      observedSets: [{ weightKg: 55, reps: 14, rir: 2 }],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 4.54,
    });
    expect(next.weightKg).toBe(55);
    expect(next.reps).toBeGreaterThan(plan.perSetRepTargets[1]);
  });
});
