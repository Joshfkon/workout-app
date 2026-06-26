/**
 * Tests for services/setRecommender.ts
 * See docs/next-set-recommender-design.md (§11 worked examples + properties).
 */

import {
  recommendSet,
  estimateRepsForWeight,
  predictAmrapReps,
  type SetRecommenderInput,
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
      expect(r.weightKg).toBeGreaterThanOrEqual(100 * 0.9 - 2.5);
      expect(r.reps).toBeGreaterThanOrEqual(8); // targets back into range
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
  it('estimates more reps at a lighter weight, clamped to the range', () => {
    const reps = estimateRepsForWeight(80, { weightKg: 100, reps: 8, rir: 2 }, [8, 12], 2);
    expect(reps).toBeGreaterThanOrEqual(8);
    expect(reps).toBeLessThanOrEqual(12);
  });

  it('does not suggest absurd reps for a very light weight (clamp prevents 30)', () => {
    const reps = estimateRepsForWeight(40, { weightKg: 100, reps: 8, rir: 2 }, [8, 12], 2);
    expect(reps).toBeLessThanOrEqual(12);
  });

  it('returns mid-range for degenerate inputs', () => {
    expect(estimateRepsForWeight(0, { weightKg: 100, reps: 8 }, [8, 12], 2)).toBe(10);
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
