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

  it('bump: targets derive from OBSERVED reps exchanged for the load change — never a floor reset', () => {
    // High-rep history with room to absorb the increment: the bump is earned
    // and each set's target is the observed count priced for the new load
    // (behavior reversal — the old policy reset every target to the floor,
    // which is where the silent volume cuts came from).
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 61.23, reps: 18, rir: 2 },
        { weightKg: 61.23, reps: 17, rir: 2 },
        { weightKg: 61.23, reps: 16, rir: 2 },
      ],
      targetRepRange: range,
      targetRir: 2,
      minIncrementKg: 4.54,
      plannedSets: 3,
    })!;
    expect(plan.bumped).toBe(true);
    expect(plan.weightKg).toBeCloseTo(61.23 + 4.54, 5); // +10 lb, additive
    expect(plan.refLoadKg).toBe(61.23);
    // Derived from 18/17/16, not reset to 12 — each above the floor, each
    // below its observation (the load increase costs something).
    expect(plan.perSetRepTargets.every((r) => r > 12)).toBe(true);
    expect(plan.perSetRepTargets[0]).toBeLessThanOrEqual(18);
    expect(plan.perSetRepTargets[0]).toBeGreaterThanOrEqual(16);
    expect(plan.sessionRepTotalTarget).toBe(plan.perSetRepTargets.reduce((a, b) => a + b, 0));
    expect(plan.perSetRefReps).toEqual([18, 17, 16]);
  });

  it('bump DEFERRED when the exchanged targets would fall below the range floor', () => {
    // Reps just clearing the floor + a coarse increment (+7.4%): the gate
    // clears but pricing the heavier load drops sets below the floor — hold
    // the load and keep chasing reps, and say why (bumpDeferred).
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
    expect(plan.bumped).toBe(false);
    expect(plan.bumpDeferred).toBe('load_cost');
    expect(plan.weightKg).toBe(61.23); // load held verbatim
    expect(plan.perSetRepTargets).toEqual([14, 13, 12]);
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

  it('set count never silently drops below what was performed (ISO Low Row defect)', () => {
    // Last session: 5 working sets. Block plan: 3. The old plan covered 3
    // sets and said nothing — a 40% volume cut by omission.
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 100, reps: 14, rir: 2 },
        { weightKg: 100, reps: 15, rir: 2 },
        { weightKg: 100, reps: 13, rir: 2 },
        { weightKg: 100, reps: 9, rir: 2 },
        { weightKg: 100, reps: 10, rir: 2 },
      ],
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.5,
      plannedSets: 3,
    })!;
    expect(plan.recommendedSetCount).toBe(5);
    expect(plan.perSetRepTargets).toHaveLength(5);
    expect(plan.prevSessionSetCount).toBe(5);
    expect(plan.prevSessionVolumeKg).toBe(6100);
  });

  it('a material projected volume cut is an explicit shortfall, never silent', () => {
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 100, reps: 14, rir: 2 },
        { weightKg: 100, reps: 15, rir: 2 },
        { weightKg: 100, reps: 13, rir: 2 },
        { weightKg: 100, reps: 9, rir: 2 },
        { weightKg: 100, reps: 10, rir: 2 },
      ],
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.5,
      plannedSets: 3,
    })!;
    // Bumped plan at +2.5% load with rep costs across 5 sets: the projection
    // lands below 95% of last session's 6,100 — the plan must carry the
    // shortfall instead of leaving a display field nobody reads.
    expect(plan.projectedVolumeKg).toBeLessThan(6100);
    if (plan.projectedVolumeKg < 6100 * 0.95) {
      expect(plan.volumeShortfall).toEqual({
        prevKg: 6100,
        projectedKg: plan.projectedVolumeKg,
      });
    }
  });

  it('a small structural bump dip (rep cost vs load gain) is NOT flagged as a shortfall', () => {
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 50, reps: 25, rir: 2 },
        { weightKg: 50, reps: 20, rir: 2 },
        { weightKg: 50, reps: 12, rir: 2 },
        { weightKg: 50, reps: 15, rir: 2 },
        { weightKg: 50, reps: 12, rir: 2 },
        { weightKg: 50, reps: 18, rir: 2 },
      ],
      targetRepRange: [10, 15],
      targetRir: 2,
      minIncrementKg: 2.5,
      plannedSets: 2,
    })!;
    // Glute Drive shape: 6 sets, high reps. The plan keeps all 6 sets and
    // projects within tolerance of last session — no false alarm.
    expect(plan.recommendedSetCount).toBe(6);
    expect(plan.projectedVolumeKg).toBeGreaterThan(plan.prevSessionVolumeKg * 0.95);
    expect(plan.volumeShortfall).toBeNull();
  });

  describe('bump-gate increment pricing (2026-07-29 live defects, Step 1)', () => {
    const LB = 0.45359237;
    // Exercise A — Shrug (Dumbbell), 8-12 rep-total. Jul 23: 77.5×12/11/10 @2RIR.
    const shrugPrev = [
      { weightKg: 77.5 * LB, reps: 12, rir: 2 },
      { weightKg: 77.5 * LB, reps: 11, rir: 2 },
      { weightKg: 77.5 * LB, reps: 10, rir: 2 },
    ];
    // Exercise B — Kelso Shrug, 8-12 rep-total. Jul 23: 62.5×10/10/10 @2RIR.
    const kelsoPrev = [
      { weightKg: 62.5 * LB, reps: 10, rir: 2 },
      { weightKg: 62.5 * LB, reps: 10, rir: 2 },
      { weightKg: 62.5 * LB, reps: 10, rir: 2 },
    ];

    it('Exercise A: a 2.5 lb dumbbell step is NOT rejected on rep-floor grounds (regression 1)', () => {
      // The live hold priced a 5 lb step (legacy dumbbell default) and
      // projected sub-floor reps. At the rack's true 2.5 lb granularity the
      // step prices to ~11/10/9 — all in range — and the lifter's manual
      // override (80×11/11/10 @2RIR) proved exactly that.
      const plan = recommendRepTotalSessionStart({
        prevSessionSets: shrugPrev,
        targetRepRange: [8, 12],
        targetRir: 2,
        minIncrementKg: 1.13,
        plannedSets: 4,
      })!;
      expect(plan.bumped).toBe(true);
      expect(plan.bumpDeferred).toBeUndefined();
      expect(plan.weightKg).toBeCloseTo(77.5 * LB + 1.13, 5); // ≈ 80 lb
      expect(plan.perSetRepTargets.slice(0, 3).every((r) => r >= 8)).toBe(true);
    });

    it('Exercise A: the increment SET re-verifies a step a coarse legacy increment would reject', () => {
      // Same history with the WRONG legacy 5 lb single increment, but the
      // rack's real 2.5 lb step recorded in availableIncrementsKg: the gate
      // must price the TRUE smallest step, not the legacy field.
      const wrong = recommendRepTotalSessionStart({
        prevSessionSets: shrugPrev,
        targetRepRange: [8, 12],
        targetRir: 2,
        minIncrementKg: 2.27,
        plannedSets: 4,
      })!;
      expect(wrong.bumped).toBe(false);
      expect(wrong.bumpDeferred).toBe('load_cost'); // the live defect, reproduced
      const verified = recommendRepTotalSessionStart({
        prevSessionSets: shrugPrev,
        targetRepRange: [8, 12],
        targetRir: 2,
        minIncrementKg: 2.27,
        availableIncrementsKg: [2.27, 1.13],
        plannedSets: 4,
      })!;
      expect(verified.bumped).toBe(true);
      expect(verified.weightKg).toBeCloseTo(77.5 * LB + 1.13, 5);
    });

    it('Exercise B: a 5 lb step IS still rejected on rep-floor grounds (regression 2 — counter-case)', () => {
      // At 62.5×10 @2RIR a 5 lb step prices to ~7 reps — genuinely below the
      // 8-rep floor. The Step 1 fix is a correct increment, not a disabled
      // floor check: with a true 5 lb smallest step the deferral must fire.
      const plan = recommendRepTotalSessionStart({
        prevSessionSets: kelsoPrev,
        targetRepRange: [8, 12],
        targetRir: 2,
        minIncrementKg: 2.27,
        plannedSets: 3,
      })!;
      expect(plan.bumped).toBe(false);
      expect(plan.bumpDeferred).toBe('load_cost');
      expect(plan.weightKg).toBeCloseTo(62.5 * LB, 5); // load held
    });
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
    // Beat-last-session accounting reads last session's ACTUAL total (30).
    expect(next.totalComparable).toBe(true);
    expect(next.prevSessionRepTotal).toBe(30);
    expect(next.remainingToBeatPrev).toBe(7); // 30 + 1 − 24
    expect(next.beatPrevBy).toBe(0);
  });

  it('counts PAST last session instead of flooring at the plan total (ISO Low Row defect)', () => {
    // Old counter: denominator was the plan total, labeled "to beat last
    // session", declared victory early and froze at 0. Now: once the actual
    // prev total is passed, beatPrevBy keeps counting.
    const next = recommendRepTotalNextSet({
      sessionPlan: plan3x(),
      observedSets: [
        { weightKg: 61.23, reps: 14, rir: 2 },
        { weightKg: 61.23, reps: 13, rir: 2 },
        { weightKg: 61.23, reps: 12, rir: 2 },
      ],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 4.54,
    });
    expect(next.totalSoFar).toBe(39);
    expect(next.remainingToBeatPrev).toBe(0);
    expect(next.beatPrevBy).toBe(9); // 39 − 30, not floored at the plan total
  });

  it('a bumped plan forbids beat-last-session framing (totals not comparable)', () => {
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
    expect(plan.bumped).toBe(true);
    const next = recommendRepTotalNextSet({
      sessionPlan: plan,
      observedSets: [{ weightKg: plan.weightKg, reps: 16, rir: 2 }],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    expect(next.totalComparable).toBe(false);
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

  it('the Bayesian Cable Curl bump no longer happens at all (deferred)', () => {
    // Live defect fixture: one at-load set 37.5×11 @1 against a 10-15 range.
    // The old gate bumped off "cleared the floor" and reset the target to 10
    // — then the lifter got 42.5×6 @0. Pricing the increment now shows 11
    // reps can't absorb it inside the range → the bump is deferred.
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [{ weightKg: 37.5, reps: 11, rir: 1 }],
      targetRepRange: [10, 15],
      targetRir: 2,
      minIncrementKg: 2.5,
      plannedSets: 4,
    })!;
    expect(plan.bumped).toBe(false);
    expect(plan.bumpDeferred).toBe('load_cost');
    expect(plan.weightKg).toBe(37.5);
  });

  it('INV-2 analog: never re-asks the plan after a set that disproves it', () => {
    // Earned bump (high-rep history), then set 1 collapses at the new load:
    // 6 @ 0 RIR. The old code re-served the plan at the same load. The load
    // must step DOWN and the rep ask must derive from the observed set.
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
    expect(plan.bumped).toBe(true);
    const next = recommendRepTotalNextSet({
      sessionPlan: plan,
      observedSets: [{ weightKg: plan.weightKg, reps: 6, rir: 0 }],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    expect(next.rationale).toBe('reduce_load');
    expect(next.weightKg).toBeLessThan(plan.weightKg);
    expect(next.weightKg).toBeGreaterThanOrEqual(plan.weightKg * 0.7);
    expect(next.reps).toBeLessThanOrEqual(20);
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
    // Bumped plan (18/17 @2 absorb the increment). Observe a first set of
    // 13 @ 0 RIR at the new load — capacity 13 → ask ceiling 11 at 2 RIR.
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

  it('a load beyond max(half grid step, 2.5%) invalidates the prior total (carried-over item 1)', () => {
    const next = recommendRepTotalNextSet({
      sessionPlan: plan3x(),
      observedSets: [{ weightKg: 55, reps: 14, rir: 2 }],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 4.54,
    });
    expect(next.loadDeviation).toEqual({ planKg: 61.23, observedKg: 55 });
    expect(next.totalComparable).toBe(false);
    expect(next.positionRef).toBeUndefined(); // no like-to-like claim off-load
  });

  it('sub-tolerance load noise (lb↔kg round-trip) does NOT invalidate the total', () => {
    // 61 vs the plan's 61.23 is conversion noise, inside half the 4.54
    // increment — the plan stands, the totals stay comparable.
    const next = recommendRepTotalNextSet({
      sessionPlan: plan3x(),
      observedSets: [{ weightKg: 61, reps: 13, rir: 2 }],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 4.54,
    });
    expect(next.loadDeviation).toBeUndefined();
    expect(next.totalComparable).toBe(true);
    expect(next.reps).toBe(12); // plan slot target, un-exchanged
  });
});

describe('ramped history (explicit rule)', () => {
  it('grades and totals TOP-LOAD sets only, and flags rampHistory', () => {
    // ISO-Lateral Low Row live shape: 170/170/180/190/190 lb ramp against an
    // 8-12 range. "Every set cleared 8" must not be trivially true of the
    // light end; the total must not mix loads.
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 77.11, reps: 14, rir: 2 },
        { weightKg: 77.11, reps: 15, rir: 2 },
        { weightKg: 81.65, reps: 13, rir: 2 },
        { weightKg: 86.18, reps: 9, rir: 2 },
        { weightKg: 86.18, reps: 10, rir: 2 },
      ],
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.27,
      plannedSets: 5,
    })!;
    expect(plan.rampHistory).toBe(true);
    expect(plan.refLoadKg).toBe(86.18);
    // Total counts the two top-load sets only (9 + 10), not all 61 reps.
    expect(plan.prevSessionRepTotal).toBe(19);
    // Volume baseline still reads the WHOLE session (tonnage is
    // load-commensurable even when rep totals are not).
    expect(plan.prevSessionVolumeKg).toBeCloseTo(4935.1, 1);
    expect(plan.prevSessionSetCount).toBe(5);
  });

  it('the ±5% at-load group tightened to the grid: a 3.7% step is a ramp step, not the same load', () => {
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 100, reps: 12, rir: 2 },
        { weightKg: 96.5, reps: 14, rir: 2 }, // −3.5%: inside the OLD ±5%, outside the new grid tolerance
      ],
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.5,
      plannedSets: 2,
    })!;
    expect(plan.rampHistory).toBe(true);
    expect(plan.prevSessionRepTotal).toBe(12); // top-load set only
  });
});
