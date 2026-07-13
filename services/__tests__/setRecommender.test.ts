/**
 * Tests for services/setRecommender.ts
 * See docs/next-set-recommender-design.md (§11 worked examples + properties).
 */

import {
  recommendSet,
  recommendSessionStart,
  estimateRepsForWeight,
  predictAmrapReps,
  resolveLastRir,
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
    it('holds weight but adds reps when the last set was EASIER than target (RIR bug repro)', () => {
      // The reported bug: 190×11 @ 3 RIR against an 8-12 @ 2 RIR target. 11 reps
      // @ 3 RIR means ~12 were available @ 2 RIR, so a hold should suggest 11-12
      // (not 10) and the effort must read as EASIER than target, never "matched".
      const r = recommendSet(base({ lastWeightKg: 100, lastReps: 11, lastRir: 3 }));
      expect(r.rationale).toBe('maintain');
      expect(r.weightKg).toBe(100);
      expect(r.reps).toBeGreaterThanOrEqual(11); // 11 + dev(1) - fatigue(1)
      expect(r.effortVsTarget).toBe('easier');
    });

    it('holds and shaves a rep when the last set landed EXACTLY at target effort', () => {
      const r = recommendSet(base({ lastWeightKg: 100, lastReps: 11, lastRir: 2 }));
      expect(r.rationale).toBe('maintain');
      expect(r.weightKg).toBe(100);
      expect(r.reps).toBe(10); // dev 0 -> 11 - max(1, round(11*0.07))
      expect(r.effortVsTarget).toBe('on_target');
    });

    it('does NOT bump weight for a slightly-easy in-range set (deadband)', () => {
      // 1 RIR easier than target is inside the deadband -> hold, not increase.
      const r = recommendSet(base({ lastReps: 10, lastRir: 3 }));
      expect(r.rationale).toBe('maintain');
      expect(r.weightKg).toBe(100);
      expect(r.effortVsTarget).toBe('easier');
    });

    it('backs off reps deep into the exercise when the last set ran harder than target', () => {
      // Set 5 (4 done), did 9 reps @ 1 RIR (1 harder than target) -> fewer reps,
      // weight held, effort reads as harder.
      const r = recommendSet(base({ lastReps: 9, lastRir: 1, setsCompletedThisExercise: 4 }));
      expect(r.rationale).toBe('maintain');
      expect(r.weightKg).toBe(100);
      expect(r.reps).toBe(7); // 9 + dev(-1) - fatigue(1)
      expect(r.reps).toBeLessThan(9);
      expect(r.effortVsTarget).toBe('harder');
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

  describe('COLD START (first-ever session — estimate expected wrong low)', () => {
    // Cold-start seated leg curl: estimated 20 kg, set 1 lands mid-range but
    // rated easy (RIR 4). A warm exercise would hold (Epley says 12 @ 4 RIR ≈
    // 13 @ 3 RIR at the same load); a cold start must bump aggressively.
    const coldBase = (over: Partial<SetRecommenderInput> = {}) =>
      base({
        lastWeightKg: 20,
        lastReps: 12,
        lastRir: 4,
        targetRepRange: [10, 15],
        targetRir: 3,
        setsCompletedThisExercise: 1,
        coldStart: true,
        ...over,
      });

    it('bumps +10-15% off a set-1 "easy" rating even when reps landed in range', () => {
      const r = recommendSet(coldBase());
      expect(r.rationale).toBe('increase_load');
      expect(r.weightKg).toBeGreaterThan(20);
      // +15% cap (22.5 after 2.5 kg increment rounding, i.e. +12.5%)
      expect(r.weightKg).toBeLessThanOrEqual(20 * 1.15 + 1.25);
    });

    it('the same set on a NON-cold-start exercise holds (deadband unchanged)', () => {
      const r = recommendSet(coldBase({ coldStart: false }));
      expect(r.rationale).toBe('maintain');
      expect(r.weightKg).toBe(20);
    });

    it('does not bump off an easy rating when reps fell below the range (contradictory input)', () => {
      const r = recommendSet(coldBase({ lastReps: 8 }));
      expect(r.rationale).not.toBe('increase_load');
    });

    it('cold-start rep overshoot uses the wider +15% step cap', () => {
      // 20 reps against 10-15: overshoot branch. Warm cap is +10%; cold is +15%.
      const cold = recommendSet(coldBase({ lastReps: 20 }));
      const warm = recommendSet(coldBase({ lastReps: 20, coldStart: false }));
      expect(cold.rationale).toBe('increase_load');
      expect(cold.weightKg).toBeGreaterThanOrEqual(warm.weightKg);
      expect(cold.weightKg).toBeLessThanOrEqual(20 * 1.15 + 1.25);
    });

    it('a hard-rated cold-start set still reduces normally', () => {
      const r = recommendSet(coldBase({ lastReps: 8, lastRir: 0 }));
      expect(r.rationale).toBe('reduce_load');
      expect(r.weightKg).toBeLessThan(20);
    });
  });
});

describe('resolveLastRir — engine input comes from the STORED set, never UI state', () => {
  it('reads the logged RIR chip (feedback.repsInTank) as the source of truth', () => {
    // Persisted set: logged 3 RIR ("easy" chip). rpe was stored as 7 (rirToRpe(3)).
    // The engine must grade it as 3, not the target/default 2.
    expect(resolveLastRir({ rpe: 7, feedback: { repsInTank: 3 } }, 2)).toBe(3);
  });

  it('prefers the stored RIR over a divergent rpe (RIR-2 "good" chip is rpe 7.5)', () => {
    // 10 - 7.5 = 2.5 (the old lossy read); the stored chip value 2 is exact.
    expect(resolveLastRir({ rpe: 7.5, feedback: { repsInTank: 2 } }, 3)).toBe(2);
  });

  it('falls back to rpe->rir when only rpe was stored', () => {
    expect(resolveLastRir({ rpe: 7 }, 2)).toBe(3); // rpeToRir(7) === 3
  });

  it('falls back to target ONLY when the set carries no effort signal at all', () => {
    expect(resolveLastRir({}, 2)).toBe(2);
    expect(resolveLastRir({ rpe: null, feedback: null }, 2)).toBe(2);
  });

  it('feeds recommendSet so a logged-easier set is graded easier, not "matched"', () => {
    // End-to-end: stored RIR 3 vs target 2 -> the recommender sees dev +1.
    const storedRir = resolveLastRir({ rpe: 7, feedback: { repsInTank: 3 } }, 2);
    const r = recommendSet(base({ lastWeightKg: 100, lastReps: 11, lastRir: storedRir }));
    expect(r.effortVsTarget).toBe('easier');
    expect(r.reps).toBeGreaterThanOrEqual(11);
  });
});

describe('BACK OFF (last set 0-1 RIR vs 2 target)', () => {
  it('holds weight but shaves extra reps at 1 RIR (inside deadband)', () => {
    const r = recommendSet(base({ lastReps: 11, lastRir: 1 }));
    expect(r.rationale).toBe('maintain');
    expect(r.weightKg).toBe(100);
    expect(r.reps).toBeLessThan(11); // 11 + dev(-1) - fatigue(1) = 9
    expect(r.effortVsTarget).toBe('harder');
  });

  it('reduces the weight at 0 RIR (2 harder than target -> outside deadband)', () => {
    const r = recommendSet(base({ lastReps: 11, lastRir: 0 }));
    expect(r.rationale).toBe('reduce_load');
    expect(r.weightKg).toBeLessThan(100);
    expect(r.effortVsTarget).toBe('harder');
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
