/**
 * Tests for services/setSuggestionEngine.ts
 *
 * Validates rep/weight suggestion logic including:
 * - RPE-adjusted rep suggestions (clamped to target range)
 * - RPE-adjusted weight suggestions
 * - Reps-from-weight estimation (the former source of the 30-rep bug)
 * - AMRAP prediction with bounded ceiling
 * - Full set suggestion convenience function
 */

import {
  suggestReps,
  suggestWeight,
  estimateRepsForWeight,
  predictAmrapReps,
  suggestNextSet,
  type PreviousSetData,
  type SuggestionContext,
} from '../setSuggestionEngine';

// ============================================
// TEST HELPERS
// ============================================

const defaultCtx: SuggestionContext = {
  targetRepRange: [8, 12],
  targetRir: 2,
};

const makeSet = (overrides: Partial<PreviousSetData> = {}): PreviousSetData => ({
  weightKg: 60,
  reps: 10,
  rpe: 8,
  ...overrides,
});

// ============================================
// suggestReps
// ============================================

describe('suggestReps', () => {
  it('returns mid-range when previous reps exceeded range', () => {
    const result = suggestReps(makeSet({ reps: 15, rpe: 7 }), defaultCtx);
    expect(result).toBe(10); // mid of [8, 12]
  });

  it('returns mid-range when RPE is very low and at top of range', () => {
    // RPE 6, target RPE 8 → rpeDiff = 2 (> 1), lastReps 12 >= maxReps 12
    const result = suggestReps(makeSet({ reps: 12, rpe: 6 }), defaultCtx);
    expect(result).toBe(10); // mid-range since weight will increase
  });

  it('adds reps when slightly easy and below top of range', () => {
    // RPE 7, target RPE 8 → rpeDiff = 1 (> 0.3), lastReps 9 < 12
    const result = suggestReps(makeSet({ reps: 9, rpe: 7 }), defaultCtx);
    expect(result).toBe(10); // 9 + 1
  });

  it('does not exceed max rep range when adding reps', () => {
    const result = suggestReps(makeSet({ reps: 11, rpe: 6 }), defaultCtx);
    expect(result).toBeLessThanOrEqual(12);
  });

  it('decreases reps when set was harder than target', () => {
    // RPE 9.5, target RPE 8 → rpeDiff = -1.5 (< -0.3)
    const result = suggestReps(makeSet({ reps: 10, rpe: 9.5 }), defaultCtx);
    expect(result).toBe(9); // 10 - 1
  });

  it('does not go below min rep range when decreasing', () => {
    const result = suggestReps(makeSet({ reps: 8, rpe: 10 }), defaultCtx);
    expect(result).toBeGreaterThanOrEqual(8);
  });

  it('keeps same reps when on target', () => {
    // RPE 8, target RPE 8 → rpeDiff = 0
    const result = suggestReps(makeSet({ reps: 10, rpe: 8 }), defaultCtx);
    expect(result).toBe(10);
  });

  it('clamps to target range even when on target', () => {
    // If somehow lastReps was 30 (from a previous bug), it should be clamped
    const result = suggestReps(makeSet({ reps: 30, rpe: 8 }), defaultCtx);
    expect(result).toBeLessThanOrEqual(12);
  });

  it('defaults to RPE 8 when RPE is not provided', () => {
    const result = suggestReps(makeSet({ reps: 10, rpe: undefined }), defaultCtx);
    expect(result).toBe(10); // On target since default RPE 8 = target RPE 8
  });

  it('never suggests more than targetRepRange[1]', () => {
    // This is the core fix for the 30-rep bug
    const scenarios: PreviousSetData[] = [
      { weightKg: 100, reps: 50, rpe: 5 },  // extreme overshoot
      { weightKg: 100, reps: 20, rpe: 6 },   // moderate overshoot
      { weightKg: 100, reps: 12, rpe: 5 },   // at top, very easy
    ];
    for (const scenario of scenarios) {
      const result = suggestReps(scenario, defaultCtx);
      expect(result).toBeLessThanOrEqual(defaultCtx.targetRepRange[1]);
    }
  });

  it('never suggests fewer than targetRepRange[0]', () => {
    const scenarios: PreviousSetData[] = [
      { weightKg: 100, reps: 3, rpe: 10 },   // way below range, maxed out
      { weightKg: 100, reps: 1, rpe: 10 },   // extreme failure
    ];
    for (const scenario of scenarios) {
      const result = suggestReps(scenario, defaultCtx);
      expect(result).toBeGreaterThanOrEqual(defaultCtx.targetRepRange[0]);
    }
  });
});

// ============================================
// suggestWeight
// ============================================

describe('suggestWeight', () => {
  it('adjusts weight to bring reps back to mid-range when reps exceeded range', () => {
    // 15 reps at 60kg RPE 8 → estimate1RM uses conservative formula for high reps
    // The key behavior: weight is recalculated for mid-range reps, not left unchanged
    const result = suggestWeight(makeSet({ reps: 15, rpe: 8 }), defaultCtx);
    expect(result).not.toBe(60); // Must adjust, not stay the same
    expect(result).toBeGreaterThan(0);
  });

  it('increases weight when RPE was low', () => {
    // RPE 6, target RPE 8 → rpeDiff = 2, so increase
    const result = suggestWeight(makeSet({ reps: 10, rpe: 6 }), defaultCtx);
    expect(result).toBeGreaterThan(60);
  });

  it('decreases weight when RPE was high', () => {
    // RPE 10, target RPE 8 → rpeDiff = -2, so decrease
    const result = suggestWeight(makeSet({ reps: 10, rpe: 10 }), defaultCtx);
    expect(result).toBeLessThan(60);
  });

  it('maintains weight when RPE is on target', () => {
    const result = suggestWeight(makeSet({ reps: 10, rpe: 8 }), defaultCtx);
    expect(result).toBe(60); // rpeDiff = 0, so 60 * (1 + 0) = 60
  });

  it('returns positive weight even for extreme cases', () => {
    const result = suggestWeight(makeSet({ reps: 1, rpe: 10 }), defaultCtx);
    expect(result).toBeGreaterThan(0);
  });
});

// ============================================
// estimateRepsForWeight
// ============================================

describe('estimateRepsForWeight', () => {
  it('returns mid-range for invalid inputs', () => {
    const result = estimateRepsForWeight(0, makeSet(), defaultCtx);
    expect(result).toBe(10); // mid of [8, 12]
  });

  it('estimates fewer reps at heavier weight', () => {
    const reference = makeSet({ weightKg: 60, reps: 10, rpe: 8 });
    const result = estimateRepsForWeight(70, reference, defaultCtx);
    expect(result).toBeLessThan(10);
  });

  it('estimates more reps at lighter weight', () => {
    const reference = makeSet({ weightKg: 60, reps: 10, rpe: 8 });
    const result = estimateRepsForWeight(50, reference, defaultCtx);
    expect(result).toBeGreaterThan(10);
  });

  it('clamps to target range max (THE 30-REP BUG FIX)', () => {
    // With a very light weight relative to 1RM, the Epley formula would suggest
    // far more reps than the target range. Previously this clamped to 30.
    const reference = makeSet({ weightKg: 100, reps: 10, rpe: 8 });
    const result = estimateRepsForWeight(20, reference, defaultCtx);
    expect(result).toBeLessThanOrEqual(12); // Must respect target range max
    expect(result).toBeGreaterThanOrEqual(8);
  });

  it('clamps to target range min at very heavy weight', () => {
    const reference = makeSet({ weightKg: 60, reps: 10, rpe: 8 });
    const result = estimateRepsForWeight(150, reference, defaultCtx);
    expect(result).toBeGreaterThanOrEqual(8); // Clamps to min
  });

  it('returns reasonable values for small weight changes', () => {
    const reference = makeSet({ weightKg: 60, reps: 10, rpe: 8 });
    const result = estimateRepsForWeight(62.5, reference, defaultCtx);
    expect(result).toBeGreaterThanOrEqual(8);
    expect(result).toBeLessThanOrEqual(12);
  });
});

// ============================================
// predictAmrapReps
// ============================================

describe('predictAmrapReps', () => {
  it('predicts more reps than performed based on RPE headroom', () => {
    // 10 reps at RPE 8 → 2 RIR → predicted 12
    const result = predictAmrapReps(makeSet({ reps: 10, rpe: 8 }), defaultCtx);
    expect(result).toBe(12);
  });

  it('caps at a reasonable ceiling above range max', () => {
    // 10 reps at RPE 5 → 5 RIR → predicted 15, but ceiling is 12 + 5 = 17
    const result = predictAmrapReps(makeSet({ reps: 10, rpe: 5 }), defaultCtx);
    expect(result).toBeLessThanOrEqual(17); // maxReps + 5
  });

  it('does not suggest absurd values like 30 reps', () => {
    // Edge case: 20 reps at RPE 0 → repsInReserve = 10 → predicted 30
    // This should be capped
    const result = predictAmrapReps(makeSet({ reps: 20, rpe: 0 }), defaultCtx);
    expect(result).toBeLessThanOrEqual(17); // 12 + 5
  });

  it('floors at target range minimum', () => {
    // 2 reps at RPE 10 → 0 RIR → predicted 2, but min is 8
    const result = predictAmrapReps(makeSet({ reps: 2, rpe: 10 }), defaultCtx);
    expect(result).toBeGreaterThanOrEqual(8);
  });

  it('handles missing RPE with default of 8', () => {
    const result = predictAmrapReps(makeSet({ reps: 10, rpe: undefined }), defaultCtx);
    expect(result).toBe(12); // 10 + (10 - 8) = 12
  });
});

// ============================================
// suggestNextSet
// ============================================

describe('suggestNextSet', () => {
  it('returns mid-range reps and fallback weight when no previous set', () => {
    const result = suggestNextSet(undefined, defaultCtx, 50);
    expect(result.weightKg).toBe(50);
    expect(result.reps).toBe(10); // mid of [8, 12]
  });

  it('uses RPE-adjusted values when previous set has RPE', () => {
    const prev = makeSet({ weightKg: 60, reps: 10, rpe: 6 }); // easy set
    const result = suggestNextSet(prev, defaultCtx);
    expect(result.weightKg).toBeGreaterThan(60); // should increase
  });

  it('carries forward and clamps when no RPE data', () => {
    const prev: PreviousSetData = { weightKg: 60, reps: 30 }; // no RPE, stale 30 reps
    const result = suggestNextSet(prev, defaultCtx);
    expect(result.weightKg).toBe(60);
    expect(result.reps).toBeLessThanOrEqual(12); // clamped from 30
    expect(result.reps).toBeGreaterThanOrEqual(8);
  });

  it('returns zero weight when no fallback and no previous set', () => {
    const result = suggestNextSet(undefined, defaultCtx);
    expect(result.weightKg).toBe(0);
  });
});

// ============================================
// REGRESSION: The 30-rep bug
// ============================================

describe('30-rep bug regression', () => {
  it('never suggests 30 reps for any reasonable input', () => {
    const contexts: SuggestionContext[] = [
      { targetRepRange: [8, 12], targetRir: 2 },
      { targetRepRange: [5, 8], targetRir: 3 },
      { targetRepRange: [10, 15], targetRir: 1 },
      { targetRepRange: [3, 5], targetRir: 2 },
    ];

    const previousSets: PreviousSetData[] = [
      { weightKg: 100, reps: 10, rpe: 8 },
      { weightKg: 50, reps: 20, rpe: 6 },
      { weightKg: 200, reps: 5, rpe: 10 },
      { weightKg: 30, reps: 15, rpe: 5 },
      { weightKg: 60, reps: 30, rpe: 8 }, // stale 30-rep data
    ];

    for (const ctx of contexts) {
      for (const prev of previousSets) {
        const reps = suggestReps(prev, ctx);
        expect(reps).toBeLessThanOrEqual(ctx.targetRepRange[1]);
        expect(reps).toBeGreaterThanOrEqual(ctx.targetRepRange[0]);
      }
    }
  });

  it('estimateRepsForWeight never exceeds target range for any weight', () => {
    const reference = makeSet({ weightKg: 100, reps: 10, rpe: 8 });
    const testWeights = [5, 10, 20, 30, 50, 80, 100, 120, 150, 200];

    for (const weight of testWeights) {
      const result = estimateRepsForWeight(weight, reference, defaultCtx);
      expect(result).toBeLessThanOrEqual(defaultCtx.targetRepRange[1]);
      expect(result).toBeGreaterThanOrEqual(defaultCtx.targetRepRange[0]);
    }
  });
});
