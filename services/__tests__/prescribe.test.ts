/**
 * prescribe() — the unified RIR-invariant weight↔reps function.
 *
 * Contract (weight↔reps unification ticket):
 *  - ONE formula app-wide: Epley with RIR-adjusted reps, and its inverse.
 *  - weight given   → reps answered from the curve, clamped [1, ∞) only.
 *  - weight omitted → weight picked so predicted reps land mid rep-range,
 *    and the returned (weight, reps) pair round-trips through the function.
 *  - repRange is ADVISORY: never substituted into a reps answer.
 *  - No e1RM → null (callers leave the reps field untouched).
 *  - INVARIANT: with e1RM and targetRIR fixed, reps(weight) is monotonically
 *    decreasing in weight.
 *  - No prescription path contains a literal rep-constant fallback (the "20").
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  prescribe,
  fatigueAdjustedE1RM,
  estimateRepsForWeight,
} from '../setRecommender';

/** Deterministic PRNG so the property tests never flake. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const epley = (w: number, reps: number, rir: number) => w * (1 + (reps + rir) / 30);

// ============================================
// LIVE REPROS
// ============================================

describe('live repros — weight edits answer from the curve, never a constant', () => {
  it('32.5 → 35 lbs at 2 RIR: ~6-7 reps from the 44.4 lb e1RM, NOT 20', () => {
    // Suggestion on screen: 32.5 lbs × 9 @ 2 RIR ⇒ e1RM = 32.5·(1+11/30) ≈ 44.4.
    // The user lacks a 2.5 plate and types 35. On that same curve at 2 RIR the
    // honest answer is ~6 reps. (The old path answered from an inflated stored
    // all-time e1RM and saturated at range-max + overshoot = the constant 20.)
    const e1RM = epley(32.5, 9, 2);
    const p = prescribe({ e1RMKg: e1RM, targetRir: 2, repRange: [10, 15], weightKg: 35 });
    expect(p).not.toBeNull();
    expect(p!.reps).toBeGreaterThanOrEqual(6);
    expect(p!.reps).toBeLessThanOrEqual(7);
    expect(p!.reps).not.toBe(20);
  });

  it('calf press 142.5 → 140 at 2 RIR: 10 reps, NOT 20', () => {
    // Last set 142.5 × 9 @ 2 RIR ⇒ e1RM ≈ 194.75. Slightly lighter at 140 ⇒ 10.
    const e1RM = epley(142.5, 9, 2);
    const p = prescribe({ e1RMKg: e1RM, targetRir: 2, repRange: [10, 15], weightKg: 140 });
    expect(p!.reps).toBe(10);
  });

  it('weight down ⇒ reps UP; weight up ⇒ reps DOWN (the curve, both directions)', () => {
    const e1RM = epley(142.5, 9, 2);
    const at = (w: number) =>
      prescribe({ e1RMKg: e1RM, targetRir: 2, repRange: [10, 15], weightKg: w })!.reps;
    expect(at(140)).toBeGreaterThan(at(142.5));
    expect(at(145)).toBeLessThan(at(142.5));
  });

  it('the inflated-stored-anchor scenario answers 6 from the suggestion curve (the exact old-bug fixture)', () => {
    // Old path: stored all-time e1RM 28 kg (≈62 lbs) superseded the on-screen
    // 32.5 lb × 9 @ 2 suggestion via max(): 30·(28/15.88 − 1) − 2 ≈ 21 →
    // clamped to repMax(15) + 5 = the constant 20. The edit path must instead
    // answer from the reference set the suggestion was built on.
    const reps = estimateRepsForWeight(15.876 /* 35 lb */, {
      lastWeightKg: 14.742, // 32.5 lb
      lastReps: 9,
      lastRir: 2,
      setsCompletedThisExercise: 0,
      // NOTE: no sessionBestE1RMKg — callers no longer pass the stored
      // all-time anchor when a reference set exists.
      targetRepRange: [10, 15],
      targetRir: 2,
    });
    expect(reps).toBe(6);
  });
});

// ============================================
// SESSION-BEST E1RM SHIFTS THE RECOMPUTE
// ============================================

describe('session-best e1RM (auto-adjust) feeds the edit recompute', () => {
  it('a just-logged easier set raises the anchor and shifts the same weight edit up', () => {
    const base = {
      lastWeightKg: 100,
      lastReps: 8,
      lastRir: 1,
      setsCompletedThisExercise: 1,
      targetRepRange: [8, 12] as [number, number],
      targetRir: 2,
    };
    const withoutAnchor = estimateRepsForWeight(95, base);
    // Same reference, but an easier set this session proved more capacity.
    const withAnchor = estimateRepsForWeight(95, { ...base, sessionBestE1RMKg: epley(100, 10, 3) });
    expect(withAnchor!).toBeGreaterThan(withoutAnchor!);
  });
});

// ============================================
// PROPERTY TESTS
// ============================================

describe('property: reps(weight) is monotonically decreasing with e1RM and RIR fixed', () => {
  it('holds across 200 random (e1RM, RIR, range) cases and full weight sweeps', () => {
    const rand = mulberry32(20260716);
    for (let i = 0; i < 200; i++) {
      const e1RM = 20 + rand() * 230;
      const rir = Math.floor(rand() * 5);
      const lo = 5 + Math.floor(rand() * 8);
      const range: [number, number] = [lo, lo + 2 + Math.floor(rand() * 8)];
      let prev = Infinity;
      for (let step = 0; step <= 40; step++) {
        const w = e1RM * (0.4 + 0.65 * (step / 40)); // 40% → 105% of e1RM
        const p = prescribe({ e1RMKg: e1RM, targetRir: rir, repRange: range, weightKg: w });
        expect(p).not.toBeNull();
        expect(p!.reps).toBeGreaterThanOrEqual(1);
        expect(p!.reps).toBeLessThanOrEqual(prev); // never increases with weight
        prev = p!.reps;
      }
    }
  });

  it('is STRICTLY decreasing across ≥15% weight steps until the floor of 1', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const e1RM = 20 + rand() * 230;
      const rir = Math.floor(rand() * 5);
      const w = e1RM * (0.4 + rand() * 0.55);
      const lighter = prescribe({ e1RMKg: e1RM, targetRir: rir, repRange: [8, 12], weightKg: w })!;
      const heavier = prescribe({ e1RMKg: e1RM, targetRir: rir, repRange: [8, 12], weightKg: w * 1.15 })!;
      if (lighter.reps > 1) {
        expect(heavier.reps).toBeLessThan(lighter.reps);
      }
    }
  });

  it('round-trips: the suggested (weight, reps) pair reproduces itself ±1 through the function', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const e1RM = 20 + rand() * 230;
      const rir = Math.floor(rand() * 5);
      const lo = 5 + Math.floor(rand() * 8);
      const range: [number, number] = [lo, lo + 2 + Math.floor(rand() * 8)];
      const inc = [0.5, 1, 1.25, 2.5, 5][Math.floor(rand() * 5)];
      const suggested = prescribe({ e1RMKg: e1RM, targetRir: rir, repRange: range, minIncrementKg: inc });
      expect(suggested).not.toBeNull();
      const roundTrip = prescribe({
        e1RMKg: e1RM,
        targetRir: rir,
        repRange: range,
        weightKg: suggested!.weightKg,
      });
      expect(Math.abs(roundTrip!.reps - suggested!.reps)).toBeLessThanOrEqual(1);
    }
  });

  it('monotonicity survives every fixed layer state (fatigue-adjusted e1RM, eased RIR)', () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 100; i++) {
      const e1RM = 40 + rand() * 160;
      const setsCompleted = Math.floor(rand() * 6);
      const rir = Math.floor(rand() * 4) + Math.floor(rand() * 2); // incl. readiness +1
      const effective = fatigueAdjustedE1RM(e1RM, setsCompleted);
      expect(effective).toBeLessThanOrEqual(e1RM);
      let prev = Infinity;
      for (let step = 0; step <= 20; step++) {
        const w = e1RM * (0.5 + 0.5 * (step / 20));
        const p = prescribe({ e1RMKg: effective, targetRir: rir, repRange: [8, 12], weightKg: w })!;
        expect(p.reps).toBeLessThanOrEqual(prev);
        prev = p.reps;
      }
    }
  });
});

// ============================================
// NO-E1RM AND DEGENERATE INPUTS
// ============================================

describe('no e1RM ⇒ no answer (reps left untouched), never a substitute', () => {
  it('prescribe returns null without a usable e1RM or weight', () => {
    expect(prescribe({ e1RMKg: 0, targetRir: 2, repRange: [8, 12], weightKg: 50 })).toBeNull();
    expect(prescribe({ e1RMKg: -5, targetRir: 2, repRange: [8, 12] })).toBeNull();
    expect(prescribe({ e1RMKg: 100, targetRir: 2, repRange: [8, 12], weightKg: 0 })).toBeNull();
  });

  it('estimateRepsForWeight returns null with no anchor and no reference set', () => {
    expect(
      estimateRepsForWeight(50, {
        lastWeightKg: 0,
        lastReps: 0,
        lastRir: 2,
        setsCompletedThisExercise: 0,
        targetRepRange: [8, 12],
        targetRir: 2,
      })
    ).toBeNull();
  });
});

// ============================================
// GREP-LEVEL ASSERTION — NO LITERAL REP-CONSTANT FALLBACKS
// ============================================

describe('grep-level: no prescription path contains a rep-constant fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'setRecommender.ts'), 'utf8');

  /** Slice a function's source from its declaration to the next top-level declaration. */
  const bodyOf = (name: string): string => {
    const match = source.match(new RegExp(`^(export )?function ${name}\\(`, 'm'));
    expect(match).not.toBeNull();
    const start = match!.index!;
    const rest = source.slice(start + 1);
    const next = rest.search(/^(export |function |\/\*\*)/m);
    return source.slice(start, next === -1 ? undefined : start + 1 + next);
  };

  it('prescribe() answers reps with no range clamp, no overshoot cap, no mid-range substitute', () => {
    const body = bodyOf('prescribe');
    expect(body).not.toMatch(/OVERSHOOT_CEILING/);
    expect(body).not.toMatch(/clamp\(/);
    // The only clamp is the [1, ∞) floor.
    expect(body).toMatch(/Math\.max\(1,/);
  });

  it('the shared prediction core carries no range-max cap (the old "× 20" emitter)', () => {
    const body = bodyOf('predictRepsAtWeight');
    expect(body).not.toMatch(/OVERSHOOT_CEILING/);
    expect(body).not.toMatch(/clamp\(/);
    expect(body).not.toMatch(/repMax/);
  });

  it('estimateRepsForWeight has no missing-e1RM rep default — it returns null instead', () => {
    const body = bodyOf('estimateRepsForWeight');
    expect(body).not.toMatch(/OVERSHOOT_CEILING/);
    expect(body).not.toMatch(/repMin \+ repMax/);
    expect(body).toMatch(/return null/);
  });
});
