import {
  estimateE1RM,
  estimateE1RMFromRpe,
  e1rmValue,
  e1rmValueFromRpe,
  impliedE1RMFloor,
  E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS,
  E1RM_MAX_EFFECTIVE_REPS,
} from '../e1rm';

describe('canonical estimateE1RM', () => {
  // === The acceptance cases from the Phase 1 spec ===

  it('returns NULL for the Jul 11 anchor set (137.5 × 30 @ 2 RIR) — never extrapolates', () => {
    // effective reps = 32 > 15. The old path emitted 284.2 and anchored a
    // 232.5 display off it. The only correct answer is "no estimate".
    expect(estimateE1RM(137.5, 30, 2)).toBeNull();
  });

  it('estimates the Jul 20 top set (135 × 12 @ 1 RIR) ≈ 193', () => {
    // effective reps 13 → clamped to 12, confidence medium.
    // Brzycki at 12: 135 × 36/25 = 194.4 — within ±2 of the ~193 acceptance.
    const est = estimateE1RM(135, 12, 1);
    expect(est).not.toBeNull();
    expect(Math.abs(est!.value - 193)).toBeLessThanOrEqual(2);
    expect(est!.confidence).toBe('medium');
  });

  // === Domain rules ===

  it('confidence tiers: ≤12 high, 13–15 medium (computed at the cap), >15 null', () => {
    expect(estimateE1RM(100, 12, 0)).toEqual({ value: 144, confidence: 'high' });
    expect(estimateE1RM(100, 13, 0)).toEqual({ value: 144, confidence: 'medium' });
    expect(estimateE1RM(100, 15, 0)).toEqual({ value: 144, confidence: 'medium' });
    expect(estimateE1RM(100, 10, 5)).toEqual({ value: 144, confidence: 'medium' }); // eff 15
    expect(estimateE1RM(100, 16, 0)).toBeNull();
    expect(estimateE1RM(100, 12, 4)).toBeNull(); // eff 16
  });

  it('RIR adjusts effective reps', () => {
    // 100 × 8 @ 2 RIR ≡ 100 × 10 to failure: 36/27 → 133.3
    expect(estimateE1RM(100, 8, 2)!.value).toBeCloseTo(133.3, 1);
    expect(estimateE1RM(100, 10, 0)!.value).toBeCloseTo(133.3, 1);
  });

  it('reps 1 @ RIR 0 returns exactly the weight (no special case needed)', () => {
    expect(estimateE1RM(315, 1, 0)!.value).toBe(315);
  });

  it('is monotone non-decreasing in reps at fixed weight/RIR until the domain ends', () => {
    // Gaining a rep must NEVER lower the displayed e1RM (the old
    // Brzycki→linear-Epley handoff dropped 2.8% at the 12-rep boundary).
    let prev = 0;
    for (let reps = 1; reps <= E1RM_MAX_EFFECTIVE_REPS; reps++) {
      const est = estimateE1RM(100, reps, 0);
      expect(est).not.toBeNull();
      expect(est!.value).toBeGreaterThanOrEqual(prev);
      prev = est!.value;
    }
    expect(estimateE1RM(100, E1RM_MAX_EFFECTIVE_REPS + 1, 0)).toBeNull();
  });

  it('is C0-continuous at the confidence boundary (12 → 13 is flat, never a drop)', () => {
    const at12 = estimateE1RM(100, E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS, 0)!;
    const at13 = estimateE1RM(100, E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS + 1, 0)!;
    expect(at13.value).toBe(at12.value);
  });

  it('rejects invalid inputs with null (never 0, never NaN)', () => {
    expect(estimateE1RM(0, 5, 0)).toBeNull();
    expect(estimateE1RM(-100, 5, 0)).toBeNull();
    expect(estimateE1RM(100, 0, 0)).toBeNull();
    expect(estimateE1RM(100, -3, 0)).toBeNull();
    expect(estimateE1RM(NaN, 5, 0)).toBeNull();
    expect(estimateE1RM(100, NaN, 0)).toBeNull();
  });

  it('clamps negative RIR to 0 (past failure adds no information)', () => {
    expect(estimateE1RM(100, 5, -3)!.value).toBe(estimateE1RM(100, 5, 0)!.value);
  });

  // === RPE wrapper: THE single bucketed conversion ===

  it('uses the bucketed rpeToRir (RPE 7.5 → RIR 2, not the raw 2.5 or rounded 3)', () => {
    // 100 × 10 @ RPE 7.5 → RIR 2 → eff 12 → high confidence, 144.
    expect(estimateE1RMFromRpe(100, 10, 7.5)).toEqual({ value: 144, confidence: 'high' });
  });

  it('treats absent RPE as taken to failure', () => {
    expect(estimateE1RMFromRpe(100, 5, undefined)!.value).toBe(
      estimateE1RM(100, 5, 0)!.value
    );
    expect(estimateE1RMFromRpe(100, 5, null)!.value).toBe(estimateE1RM(100, 5, 0)!.value);
  });

  // === Numeric compat helpers (aggregation only) ===

  it('value helpers return 0 for "no estimate" so it never wins a max()', () => {
    expect(e1rmValue(137.5, 30, 2)).toBe(0);
    expect(e1rmValueFromRpe(137.5, 30, 8)).toBe(0);
    expect(e1rmValue(100, 10, 0)).toBeCloseTo(133.3, 1);
  });

  // === Prescription-space floor (cap/floor comparisons, never display) ===

  describe('impliedE1RMFloor', () => {
    it('agrees exactly with estimateE1RM everywhere an estimate exists', () => {
      for (const [reps, rir] of [
        [5, 0],
        [10, 2],
        [12, 0],
        [12, 2], // 14 eff — clamped region
        [13, 2], // 15 eff — domain edge
      ] as const) {
        expect(impliedE1RMFloor(100, reps, rir)).toBe(estimateE1RM(100, reps, rir)!.value);
      }
    });

    it('lifts the beyond-domain null to the flat eff-12 floor', () => {
      // 137.5 × 30 @2 (32 eff): estimateE1RM is null; the floor is the
      // eff-12 value — true capacity is provably at least this.
      expect(estimateE1RM(137.5, 30, 2)).toBeNull();
      expect(impliedE1RMFloor(137.5, 30, 2)).toBe(estimateE1RM(137.5, 12, 0)!.value);
    });

    it('is monotone non-decreasing in reps at a fixed load (flat past the cap)', () => {
      let prev = 0;
      for (let reps = 1; reps <= 25; reps++) {
        const v = impliedE1RMFloor(100, reps, 2)!;
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
      expect(impliedE1RMFloor(100, 25, 2)).toBe(impliedE1RMFloor(100, 10, 2));
    });

    it('rejects invalid inputs with null, like the estimator', () => {
      expect(impliedE1RMFloor(0, 10, 2)).toBeNull();
      expect(impliedE1RMFloor(100, 0, 2)).toBeNull();
      expect(impliedE1RMFloor(NaN, 10, 2)).toBeNull();
    });
  });
});
