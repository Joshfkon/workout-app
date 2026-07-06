/**
 * Tests for services/setRecommender.ts
 * See docs/next-set-recommender-design.md (§11 worked examples + properties).
 */

import {
  recommendSet,
  recommendSessionStart,
  estimateRepsForWeight,
  predictAmrapReps,
  type SetRecommenderInput,
  type SessionStartInput,
} from '../setRecommender';

const base = (over: Partial<SetRecommenderInput> = {}): SetRecommenderInput => ({
  lastWeightKg: 100,
  lastReps: 10,
  lastRir: 2,
  setsCompletedThisExercise: 1,
  targetRepRange: [8, 12],
  targetRir: 2,
  minIncrementKg: 2.5,
  ...over,
});

describe('recommendSet', () => {
  describe('HOLD (default — straight sets)', () => {
    it('holds weight and shaves a rep for fatigue when in range at ~target effort', () => {
      const r = recommendSet(base({ lastWeightKg: 100, lastReps: 11, lastRir: 3 }));
      expect(r.rationale).toBe('maintain');
      expect(r.weightKg).toBe(100);
      expect(r.reps).toBe(10); // 11 - max(1, round(11*0.07))
    });

    it('does NOT bump weight for a slightly-easy in-range set (deadband)', () => {
      // 1 RIR easier than target is inside the deadband -> hold, not increase.
      const r = recommendSet(base({ lastReps: 10, lastRir: 3 }));
      expect(r.rationale).toBe('maintain');
      expect(r.weightKg).toBe(100);
    });

    it('predicts declining reps deep into the exercise (fatigue tracks last set)', () => {
      // Set 5 (4 done), did 9 reps last -> expect ~8, never more than last.
      const r = recommendSet(base({ lastReps: 9, lastRir: 1, setsCompletedThisExercise: 4 }));
      expect(r.rationale).toBe('maintain');
      expect(r.weightKg).toBe(100);
      expect(r.reps).toBe(8);
      expect(r.reps).toBeLessThan(9);
    });

    it('does NOT drop weight just because a normal-fatigue set felt hard (in range)', () => {
      // RIR 1 vs target 2 is inside the deadband -> hold (this is the key win vs main).
      const r = recommendSet(base({ lastReps: 10, lastRir: 1, setsCompletedThisExercise: 3 }));
      expect(r.rationale).toBe('maintain');
      expect(r.weightKg).toBe(100);
    });
  });

  describe('INCREASE (clearly too light — fires mid-session)', () => {
    it('adds load after an easy set well above the range; reps stay honest', () => {
      // 110x20 @ RIR4, target 8-12 RIR2 — the "way too light" case.
      const r = recommendSet(base({ lastWeightKg: 110, lastReps: 20, lastRir: 4 }));
      expect(r.rationale).toBe('increase_load');
      expect(r.weightKg).toBeGreaterThan(110);
      expect(r.weightKg).toBeLessThanOrEqual(110 * 1.1); // capped +10%
      // honest reps: still high because one capped step can't reach the range from 20
      expect(r.reps).toBeGreaterThan(12);
      expect(r.reps).toBeLessThanOrEqual(12 + 5); // overshoot ceiling
    });

    it('never recommends FEWER reps at the same weight after a clearly-easy set', () => {
      const r = recommendSet(base({ lastWeightKg: 100, lastReps: 18, lastRir: 4 }));
      expect(r.rationale).toBe('increase_load');
      expect(r.weightKg).toBeGreaterThan(100);
    });

    it('increases on a big rep-overshoot even when RIR sits inside the deadband', () => {
      // 18 reps in a 3-6 range, RIR 3 vs target 3 (dev 0, inside deadband). The reps
      // alone prove the load is too light — caught in live QA.
      const r = recommendSet(
        base({ lastWeightKg: 35, lastReps: 18, lastRir: 3, targetRepRange: [3, 6], targetRir: 3 })
      );
      expect(r.rationale).toBe('increase_load');
      expect(r.weightKg).toBeGreaterThan(35);
    });

    it('requires BOTH top-of-range and >= deadband reserve (not just easy)', () => {
      // At the top of range but only 1 RIR reserve -> hold, not increase.
      const r = recommendSet(base({ lastReps: 12, lastRir: 3 }));
      // dev = 1 < deadband(2) -> hold
      expect(r.rationale).toBe('maintain');
    });
  });

  describe('REDUCE (too heavy / too close to failure)', () => {
    it('reduces weight when you cannot reach the bottom of the range', () => {
      const r = recommendSet(base({ lastWeightKg: 100, lastReps: 6, lastRir: 0 }));
      expect(r.rationale).toBe('reduce_load');
      expect(r.weightKg).toBeLessThan(100);
      expect(r.weightKg).toBeGreaterThanOrEqual(100 * 0.7 - 2.5); // asymmetric reduce cap
      expect(r.reps).toBeGreaterThanOrEqual(8); // targets back into range
    });

    it('drops far enough to reach the range after a drastic overshoot (not capped at -10%)', () => {
      // Live bug: 105 lb x 2 @ RIR 0 against a 10-15 target. The +/-10% cap left the
      // suggestion at ~92.5 lb x 4 — a set the model itself predicted below the range.
      const r = recommendSet(
        base({
          lastWeightKg: 47.6, // ~105 lb
          lastReps: 2,
          lastRir: 0,
          targetRepRange: [10, 15],
          minIncrementKg: 1.13, // ~2.5 lb
        })
      );
      expect(r.rationale).toBe('reduce_load');
      expect(r.weightKg).toBeLessThanOrEqual(47.6 * 0.75); // needs ~-29%, allowed now
      expect(r.reps).toBeGreaterThanOrEqual(10); // prediction lands back in range
      expect(r.reps).toBeLessThanOrEqual(15);
    });

    it('reduces when a set went much closer to failure than target (deadband)', () => {
      // In range (10) but RIR 0 vs target 2 -> dev -2 -> reduce.
      const r = recommendSet(base({ lastReps: 10, lastRir: 0 }));
      expect(r.rationale).toBe('reduce_load');
      expect(r.weightKg).toBeLessThan(100);
    });
  });

  describe('capacity anchor (sessionBestE1RMKg)', () => {
    it('uses the freshest E1RM so late-set predictions are not double-fatigued', () => {
      // A fatigued last set (low reps) but a strong session anchor -> reduce predicts
      // generously off the anchor, not the depressed last-set E1RM.
      const withAnchor = recommendSet(
        base({ lastWeightKg: 100, lastReps: 6, lastRir: 0, sessionBestE1RMKg: 160 })
      );
      const noAnchor = recommendSet(base({ lastWeightKg: 100, lastReps: 6, lastRir: 0 }));
      // anchor is higher -> reduced weight is higher (less drastic) than the no-anchor case
      expect(withAnchor.weightKg).toBeGreaterThanOrEqual(noAnchor.weightKg);
    });
  });

  describe('guards', () => {
    it('handles zero/negative inputs without throwing', () => {
      const r = recommendSet(base({ lastWeightKg: 0, lastReps: 0 }));
      expect(r.rationale).toBe('maintain');
      expect(r.reps).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(r.weightKg)).toBe(true);
    });

    it('defaults missing RIR behavior to on-target (holds)', () => {
      const r = recommendSet(base({ lastReps: 10, lastRir: 2 }));
      expect(r.rationale).toBe('maintain');
    });

    it('never returns reps below 1 or absurdly high', () => {
      const r = recommendSet(base({ lastWeightKg: 200, lastReps: 1, lastRir: 0 }));
      expect(r.reps).toBeGreaterThanOrEqual(1);
      expect(r.reps).toBeLessThanOrEqual(12 + 5);
    });
  });
});

describe('estimateRepsForWeight', () => {
  it('agrees exactly with recommendSet at the recommended weight (single prediction core)', () => {
    // The live-bug scenario: 105 lb x 2 @ RIR 0 against a 10-15 target. Editing the
    // weight field back to the recommended weight must reproduce the recommended reps —
    // the banner and the weight-edit recalc may never disagree.
    const input = base({
      lastWeightKg: 47.6,
      lastReps: 2,
      lastRir: 0,
      targetRepRange: [10, 15] as [number, number],
      minIncrementKg: 1.13,
    });
    const rec = recommendSet(input);
    expect(rec.rationale).toBe('reduce_load');
    expect(estimateRepsForWeight(rec.weightKg, input)).toBe(rec.reps);
  });

  it('shows honest below-range reps at a too-heavy weight (no floor to repMin)', () => {
    // Live bug: after 105 lb x 2 @ RIR 0 (10-15 target), editing the weight to
    // ~92.5 lb used to jump the rep prefill to 10 (floored to the range min).
    // Honest answer at that weight is ~4 reps.
    const input = base({
      lastWeightKg: 47.6, // ~105 lb
      lastReps: 2,
      lastRir: 0,
      targetRepRange: [10, 15] as [number, number],
    });
    const reps = estimateRepsForWeight(41.96 /* ~92.5 lb */, input);
    expect(reps).toBe(4);
    expect(reps).toBeLessThan(10); // must NOT be floored up to the range
  });

  it('estimates fewer reps at heavier weights and more at lighter weights', () => {
    const heavier = estimateRepsForWeight(110, base());
    const lighter = estimateRepsForWeight(90, base());
    expect(heavier).toBeLessThan(lighter);
  });

  it('caps very light weights at repMax + overshoot ceiling (the 30-rep bug stays fixed)', () => {
    // e1rm 140 at 40kg predicts ~69 fresh reps — must cap at 12 + 5.
    expect(estimateRepsForWeight(40, base())).toBe(17);
  });

  it('never predicts below 1 or above repMax + 5 across the weight spectrum', () => {
    for (const w of [20, 40, 60, 80, 100, 120, 150, 200]) {
      const reps = estimateRepsForWeight(w, base());
      expect(reps).toBeGreaterThanOrEqual(1);
      expect(reps).toBeLessThanOrEqual(12 + 5);
    }
  });

  it('uses the session-best E1RM anchor like recommendSet does', () => {
    const fatigued = base({ lastWeightKg: 100, lastReps: 6, lastRir: 0 });
    const anchored = base({ lastWeightKg: 100, lastReps: 6, lastRir: 0, sessionBestE1RMKg: 160 });
    expect(estimateRepsForWeight(100, anchored)).toBeGreaterThan(
      estimateRepsForWeight(100, fatigued)
    );
  });

  it('returns mid-range for degenerate inputs', () => {
    expect(estimateRepsForWeight(0, base())).toBe(10);
    expect(estimateRepsForWeight(50, base({ lastWeightKg: 0, lastReps: 0 }))).toBe(10);
  });
});

describe('recommendSessionStart', () => {
  const start = (over: Partial<SessionStartInput> = {}): SessionStartInput => ({
    prevWeightKg: 100,
    prevReps: 10,
    prevRir: 2,
    targetRepRange: [8, 12],
    targetRir: 2,
    minIncrementKg: 2.5,
    ...over,
  });

  it('repeats last session verbatim when it landed in range at ~target effort (fresh, no fatigue shave)', () => {
    const r = recommendSessionStart(start({ prevReps: 11, prevRir: 3 }));
    expect(r.rationale).toBe('maintain');
    expect(r.weightKg).toBe(100);
    expect(r.reps).toBe(11); // NOT 10 — a new session starts fresh
  });

  it('steps the load up when last session was clearly too light (live bug: 20 reps @ 4 RIR vs 10-15 @ 2)', () => {
    // The screenshot case: cable fly 9.07 kg (20 lb) x 20 @ RIR 4 against a 10-15 @ 2 RIR target.
    // The old seed replayed the same weight and clamped reps to 15, labelled "matching your last session".
    const r = recommendSessionStart(
      start({
        prevWeightKg: 9.07,
        prevReps: 20,
        prevRir: 4,
        targetRepRange: [10, 15],
        minIncrementKg: 1.13, // ~2.5 lb
      })
    );
    expect(r.rationale).toBe('increase_load');
    expect(r.weightKg).toBeGreaterThan(9.07);
    expect(r.weightKg).toBeLessThanOrEqual(9.07 * 1.1 + 1.13); // capped step
  });

  it('steps the load down when last session went too close to failure', () => {
    const r = recommendSessionStart(start({ prevReps: 10, prevRir: 0 }));
    expect(r.rationale).toBe('reduce_load');
    expect(r.weightKg).toBeLessThan(100);
  });

  it('assumes on-target effort when the previous set has no recorded RIR', () => {
    // In-range reps, unknown effort -> hold and repeat.
    const r = recommendSessionStart(start({ prevReps: 10, prevRir: undefined }));
    expect(r.rationale).toBe('maintain');
    expect(r.weightKg).toBe(100);
    expect(r.reps).toBe(10);
  });

  it('still increases on an objective rep-overshoot even with no recorded RIR', () => {
    // 20 reps against a 10-15 range proves under-load regardless of effort rating.
    const r = recommendSessionStart(start({ prevReps: 20, prevRir: undefined, targetRepRange: [10, 15] }));
    expect(r.rationale).toBe('increase_load');
    expect(r.weightKg).toBeGreaterThan(100);
  });

  it('rep-overshoot beats the RIR deadband: a rep range moved down reprices UP off a near-failure set', () => {
    // 100×10 @ 0 RIR against a switched 5-6 @ 2 target: the 10 reps prove the
    // load is light for the NEW range even though the set ran to failure.
    // E1RM at 0 RIR = 133.3; weight for 6 @ 2 RIR ≈ 105.3 → 105.
    const r = recommendSessionStart(start({ prevReps: 10, prevRir: 0, targetRepRange: [5, 6] }));
    expect(r.rationale).toBe('increase_load');
    expect(r.weightKg).toBe(105);
    expect(r.reps).toBe(6);
  });

  it('zero-load seeds follow a moved rep range instead of repeating out-of-range reps', () => {
    // Bodyweight history has no weight lever — the reps ARE the switch.
    const r = recommendSessionStart(start({ prevWeightKg: 0, prevReps: 10, prevRir: undefined, targetRepRange: [5, 6] }));
    expect(r.weightKg).toBe(0); // never floored up to the increment
    expect(r.reps).toBe(6);
  });

  it('handles degenerate inputs without throwing', () => {
    const r = recommendSessionStart(start({ prevWeightKg: 0, prevReps: 0 }));
    expect(r.rationale).toBe('maintain');
    expect(r.reps).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(r.weightKg)).toBe(true);
  });
});

describe('predictAmrapReps', () => {
  it('predicts last reps plus reserve, floored at range min', () => {
    expect(predictAmrapReps({ reps: 10, rir: 3 }, [8, 12])).toBe(13);
  });

  it('caps absurd predictions above the range ceiling', () => {
    expect(predictAmrapReps({ reps: 25, rir: 5 }, [8, 12])).toBe(12 + 5);
  });

  it('floors at range min', () => {
    expect(predictAmrapReps({ reps: 3, rir: 0 }, [8, 12])).toBe(8);
  });
});
