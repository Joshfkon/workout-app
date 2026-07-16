/**
 * Prescription adjustment layers — regression contract for the unified
 * prescribe() refactor (weight↔reps unification ticket).
 *
 * One test per load-bearing adjustment layer, written against the behavior on
 * main BEFORE the refactor and kept green through it. Each layer must survive
 * restructured as an INPUT adjustment (effective e1RM or effective target RIR
 * fed into the curve), never as a post-hoc edit of the output reps/weight:
 *
 *  1. Within-session fatigue  — later sets prescribe fewer reps at the same
 *     weight/RIR (effective-e1RM decrement per completed set).
 *  2. Effort-deviation        — a last set easier than target shifts the next
 *     prescription up, with the 'easier' trigger for the rationale copy.
 *  3. Readiness easing        — low readiness raises the effective RIR target
 *     (+1), which eases the prescription through the curve input.
 *  4. Deload wrapper          — wraps OUTSIDE the curve: fewer sets at a
 *     reduced-load guidance with deload rationale. Untouched by the refactor.
 *  5. RPE calibration bias    — AMRAP-derived bias shifts the PRESCRIBED RIR
 *     (how logged effort resolves), upstream of the curve.
 *  6. Soreness / wearable     — gate readiness only; they must NOT reach the
 *     prescription engine through any second path (no double-dip).
 */

import * as fs from 'fs';
import * as path from 'path';
import { recommendSet, estimateRepsForWeight } from '../setRecommender';
import { applyReadinessModulation } from '../fatigueEngine';
import { generateDeloadWeek } from '../deloadEngine';
import { RPECalibrationEngine, type CalibrationResult } from '../rpeCalibration';
import type { MesocycleWeek } from '@/types/schema';

// ============================================
// Layer 1 — within-session fatigue
// ============================================

describe('Layer 1: within-session fatigue (effective-e1RM decrement)', () => {
  it('set 4 after three hard sets prescribes fewer reps than set 1 at the same weight and RIR', () => {
    const base = {
      lastWeightKg: 100,
      lastReps: 10,
      lastRir: 2,
      targetRepRange: [8, 12] as [number, number],
      targetRir: 2,
    };
    const set1 = estimateRepsForWeight(90, { ...base, setsCompletedThisExercise: 0 });
    const set4 = estimateRepsForWeight(90, { ...base, setsCompletedThisExercise: 3 });
    expect(set1).not.toBeNull();
    expect(set4).not.toBeNull();
    expect(set4!).toBeLessThan(set1!);
  });

  it('fatigue accumulates monotonically with completed sets', () => {
    const base = {
      lastWeightKg: 100,
      lastReps: 10,
      lastRir: 2,
      targetRepRange: [8, 12] as [number, number],
      targetRir: 2,
    };
    let prev = Infinity;
    for (const n of [0, 2, 4, 6]) {
      const reps = estimateRepsForWeight(85, { ...base, setsCompletedThisExercise: n });
      expect(reps).not.toBeNull();
      expect(reps!).toBeLessThanOrEqual(prev);
      prev = reps!;
    }
  });
});

// ============================================
// Layer 2 — effort-deviation response
// ============================================

describe('Layer 2: effort-deviation response (dev term + trigger enum)', () => {
  const at = (lastRir: number) =>
    recommendSet({
      lastWeightKg: 100,
      lastReps: 10,
      lastRir,
      setsCompletedThisExercise: 1,
      targetRepRange: [8, 12] as [number, number],
      targetRir: 2,
    });

  it('a 3-RIR set against a 2-RIR target suggests 1-2 more reps than an on-target set, flagged "easier"', () => {
    const onTarget = at(2);
    const easier = at(3);
    expect(easier.rationale).toBe('maintain');
    expect(easier.effortVsTarget).toBe('easier');
    expect(onTarget.effortVsTarget).toBe('on_target');
    expect(easier.reps).toBeGreaterThanOrEqual(onTarget.reps + 1);
    expect(easier.reps).toBeLessThanOrEqual(onTarget.reps + 2);
  });

  it('a harder-than-target set (inside the deadband) shifts the prescription down, flagged "harder"', () => {
    const onTarget = at(2);
    const harder = at(1);
    expect(harder.rationale).toBe('maintain');
    expect(harder.effortVsTarget).toBe('harder');
    expect(harder.reps).toBeLessThan(onTarget.reps);
  });
});

// ============================================
// Layer 3 — readiness easing
// ============================================

describe('Layer 3: readiness easing (+RIR at the curve input)', () => {
  it('low readiness eases via rirDelta +1 and carries the banner suffix copy', () => {
    const low = applyReadinessModulation(35);
    expect(low.rirDelta).toBe(1);
    expect(low.suggestSetReduction).toBe(true);
    expect(low.banner).toBeTruthy();

    const middling = applyReadinessModulation(50);
    expect(middling.rirDelta).toBe(1);
    expect(middling.suggestSetReduction).toBe(false);

    const good = applyReadinessModulation(80);
    expect(good.rirDelta).toBe(0);
    expect(good.banner).toBeNull();
  });

  it('the eased (+1 RIR) target prescribes fewer reps at the same weight — input-side, through the curve', () => {
    const base = {
      lastWeightKg: 100,
      lastReps: 10,
      lastRir: 2,
      setsCompletedThisExercise: 0,
      targetRepRange: [8, 12] as [number, number],
    };
    const normal = estimateRepsForWeight(100, { ...base, targetRir: 2 });
    const eased = estimateRepsForWeight(100, { ...base, targetRir: 2 + applyReadinessModulation(35).rirDelta });
    expect(normal).not.toBeNull();
    expect(eased).not.toBeNull();
    expect(eased!).toBeLessThan(normal!);
  });
});

// ============================================
// Layer 4 — deload wrapper (outside the curve)
// ============================================

describe('Layer 4: deload wrapper (set count and load reduced OUTSIDE prescribe)', () => {
  const baseWeek = {
    weekNumber: 3,
    focus: 'Accumulation',
    intensityModifier: 1,
    volumeModifier: 1,
    rpeTarget: { min: 7, max: 8 },
    isDeload: false,
    sessions: [
      {
        day: 'Monday',
        focus: 'Push',
        totalSets: 4,
        exercises: [
          {
            sets: 4,
            reps: { min: 8, max: 12, targetRIR: 2 },
            loadGuidance: 'as prescribed',
          },
        ],
      },
    ],
  } as unknown as MesocycleWeek;

  it('volume deload halves sets and stamps the deload rationale', () => {
    const deload = generateDeloadWeek(baseWeek, 'volume');
    expect(deload.isDeload).toBe(true);
    expect(deload.volumeModifier).toBe(0.5);
    expect(deload.sessions[0].exercises[0].sets).toBe(2); // 4 × 0.5
    expect(deload.focus).toContain('DELOAD');
  });

  it('intensity deload prescribes ~85% load guidance and raises the RIR target', () => {
    const deload = generateDeloadWeek(baseWeek, 'intensity');
    expect(deload.intensityModifier).toBe(0.85);
    expect(deload.sessions[0].exercises[0].loadGuidance).toContain('85%');
    expect(deload.sessions[0].exercises[0].reps.targetRIR).toBe(4); // 2 + 2
  });
});

// ============================================
// Layer 5 — RPE calibration bias
// ============================================

describe('Layer 5: RPE calibration bias shifts effort resolution upstream of the curve', () => {
  const sandbagger: CalibrationResult = {
    exerciseName: 'Bench Press',
    predictedMaxReps: 10,
    actualMaxReps: 13,
    bias: 2.4, // stops ~2 reps early
    biasInterpretation: 'sandbagging',
    confidenceLevel: 'high',
    lastCalibrated: new Date('2026-07-01'),
    dataPoints: 5,
    method: 'fatigue_adjusted_v2',
  };

  it('a sandbagging bias lowers the PRESCRIBED RIR while the internal target is unchanged', () => {
    const engine = new RPECalibrationEngine([], [sandbagger]);
    const adjusted = engine.getAdjustedRIR('Bench Press', 2);
    expect(adjusted.hasAdjustment).toBe(true);
    expect(adjusted.prescribedRIR).toBe(0); // 2 − round(2.4)
    expect(adjusted.internalTargetRIR).toBe(2);
    expect(adjusted.adjustmentReason).toContain('stop');
  });

  it('a well-calibrated lifter (bias inside the dead zone) gets no adjustment', () => {
    const engine = new RPECalibrationEngine([], [{ ...sandbagger, bias: 0.5 }]);
    const adjusted = engine.getAdjustedRIR('Bench Press', 2);
    expect(adjusted.hasAdjustment).toBe(false);
    expect(adjusted.prescribedRIR).toBe(2);
  });
});

// ============================================
// Layer 6 — soreness / wearable: no double-dip
// ============================================

describe('Layer 6: soreness/wearable recovery gates readiness only (no second path into prescription)', () => {
  it('the prescription engine has no import from recovery/wearable/soreness modules', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'setRecommender.ts'), 'utf8');
    for (const banned of ['wearableRecovery', 'muscleRecovery', 'healthkitSleep', 'fatigueEngine', 'discomfortTracker']) {
      expect(source).not.toContain(`from './${banned}'`);
      expect(source).not.toContain(`from '@/services/${banned}'`);
    }
  });
});
