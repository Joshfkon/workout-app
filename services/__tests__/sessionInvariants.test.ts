/**
 * Phase 0 — hard invariants on every within-session prescription.
 *
 * These are assertions, not models — cheap, independent of the fatigue work:
 *   INV-1  a prescription outside its own stated rep range must SAY so
 *          (outsideRange flag) — never a silent banner/set-list contradiction;
 *   INV-2  never prescribe an implied capacity (canonical capped Brzycki at
 *          the asked effort) above the session's best OBSERVED set;
 *   INV-3  never round an intended change onto the current or previous load
 *          (Phase D rule, re-asserted here as named invariant tests).
 *
 * Fixture #2 (Arnold Press) is the INV-2 canonical case: after 10 → 10 → 8
 * effective reps the live engine asked for 12 effective reps on the final
 * set — a session best demanded under fatigue. Two independent reproductions
 * (with Iso-Lateral MISS B) — the fatigue term is confirmed, not
 * hypothesized.
 */

import { recommendSet } from '../setRecommender';
import { estimateE1RM } from '../shared/e1rm';
import { roundPrescribedLoad } from '../suggestionEngine/loadGrid';
import {
  ARNOLD_JUL_20,
  ARNOLD_JUL_27_LOGGED,
  ARNOLD_TARGET_REP_RANGE,
  ARNOLD_TARGET_RIR,
  ARNOLD_MIN_INCREMENT,
  ARNOLD_PLANNED_SETS,
  ARNOLD_JUL_27_BEST_IMPLIED,
} from './fixtures/arnoldPress';

const arnoldCtx = {
  targetRepRange: ARNOLD_TARGET_REP_RANGE,
  targetRir: ARNOLD_TARGET_RIR,
  minIncrementKg: ARNOLD_MIN_INCREMENT,
} as const;

describe('INV-2 — implied capacity never exceeds the session best observed set', () => {
  it('Arnold Press set 4: the prescription implies at most the session-best 60.0', () => {
    // After 45×8 @2, 45×8 @2, 47.5×7 @1 (implied 60.0 / 60.0 / 58.9).
    const last = ARNOLD_JUL_27_LOGGED[2];
    const rec = recommendSet({
      lastWeightKg: last.weightKg,
      lastReps: last.reps,
      lastRir: last.rir,
      setsCompletedThisExercise: 3,
      sessionBestE1RMKg: 60.2, // session-best Epley, as the card passes it
      ...arnoldCtx,
      sessionObservedSets: ARNOLD_JUL_27_LOGGED.map((s) => ({
        weightKg: s.weightKg,
        reps: s.reps,
        rir: s.rir,
      })),
      positionContext: {
        prevSessionSets: ARNOLD_JUL_20,
        todaySets: ARNOLD_JUL_27_LOGGED.map((s) => ({ weightKg: s.weightKg, reps: s.reps })),
        plannedSetCount: ARNOLD_PLANNED_SETS,
      },
    });
    // The live engine asked 42.5×10 @2 → 61.2 implied — a session best after
    // fatigue. Whatever the engine now picks must imply ≤ the observed best
    // (60.0, with rounding slack), and must not resurrect the 12-eff ask.
    const implied = estimateE1RM(rec.weightKg, rec.reps, rec.rir);
    expect(implied).not.toBeNull();
    expect(implied!.value).toBeLessThanOrEqual(ARNOLD_JUL_27_BEST_IMPLIED * 1.01);
    // Position matching disengages here (today's set 3 at 47.5 vs 40 last
    // session is > 10% divergence), so this is the anchor path under INV-2.
    expect(rec.positionMatch).toBeUndefined();
    expect(rec.weightKg).toBe(42.5); // Phase D dumbbell granularity — don't regress
  });

  it('clamps an anchor-path ask that implies more than anything observed today', () => {
    // 45×10 @4 against an 8-10 range: the increase branch prices off Epley
    // (e1rm 66) and, unclamped, asks 47.5×9 @2 → 65.8 implied — above the
    // canonical observed 64.8 (14 eff caps at 12). INV-2 trims the ask.
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 10,
      lastRir: 4,
      setsCompletedThisExercise: 1,
      targetRepRange: [8, 10],
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    const observed = estimateE1RM(45, 10, 4)!.value;
    const implied = estimateE1RM(rec.weightKg, rec.reps, rec.rir);
    expect(implied).not.toBeNull();
    expect(implied!.value).toBeLessThanOrEqual(observed * 1.01);
    expect(rec.sessionCapacityClamped).toBe(true);
  });

  it('does not clamp a prescription already inside the observed ceiling', () => {
    const rec = recommendSet({
      lastWeightKg: 100,
      lastReps: 10,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    expect(rec.sessionCapacityClamped).toBeUndefined();
  });

  it('does not apply at session start (no sets observed THIS session)', () => {
    // recommendSessionStart replays recommendSet with setsCompleted 0 and the
    // PREVIOUS session's reference set — that set is not a today-observation,
    // so the ceiling must not bind there.
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 10,
      lastRir: 4,
      setsCompletedThisExercise: 0,
      targetRepRange: [8, 10],
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    expect(rec.sessionCapacityClamped).toBeUndefined();
  });

  it('caps the asked effort at the TARGET for progressions off easy historical sets (Codex review)', () => {
    // Positional set 100×7 @4 (easy) → add_rep → 100×8 asked at the target
    // 2 RIR. Grading that ask at the HISTORICAL RIR 4 would imply 12 eff
    // (144) against today's observed 133.3 and trim a rep the target-effort
    // ask (10 eff → 133.3) fully supports. min(prevRir, targetRir) keeps
    // holds graded at their recorded effort while progressions grade at the
    // effort actually asked.
    const rec = recommendSet({
      lastWeightKg: 100,
      lastReps: 8,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.5,
      sessionObservedSets: [{ weightKg: 100, reps: 8, rir: 2 }],
      positionContext: {
        prevSessionSets: [
          { weightKg: 100, reps: 8, rir: 2 },
          { weightKg: 100, reps: 7, rir: 4 },
        ],
        todaySets: [{ weightKg: 100, reps: 8 }],
        plannedSetCount: 2,
      },
    });
    expect(rec.positionMatch?.progression).toBe('add_rep');
    expect(rec.reps).toBe(8);
    expect(rec.sessionCapacityClamped).toBeUndefined();
  });

  it('position-matched holds grade at the matched set\'s recorded effort, not the target', () => {
    // Iso-Lateral set 2: matched 192.5×8 @1. At the TARGET effort (2 RIR)
    // that pair would imply 256.7 — above today's observed 252.7 — but the
    // ask is to repeat a set performed @1, and at its recorded effort it
    // implies 247.5. The invariant must not strip the fixture-validated
    // 192.5×8 target.
    const rec = recommendSet({
      lastWeightKg: 182.5,
      lastReps: 9,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.5,
      sessionObservedSets: [{ weightKg: 182.5, reps: 9, rir: 2 }],
      positionContext: {
        prevSessionSets: [
          { weightKg: 182.5, reps: 8, rir: 2.5 },
          { weightKg: 192.5, reps: 8, rir: 1 },
          { weightKg: 202.5, reps: 5, rir: 0 },
          { weightKg: 182.5, reps: 7, rir: 0 },
        ],
        todaySets: [{ weightKg: 182.5, reps: 9 }],
        plannedSetCount: 4,
      },
    });
    expect(rec.weightKg).toBe(192.5);
    expect(rec.reps).toBe(8);
    expect(rec.sessionCapacityClamped).toBeUndefined();
  });
});

describe('INV-1 — a prescription outside its own stated range must say so', () => {
  it('Arnold Press: a sub-floor maintain prediction re-solves as a LOAD reduction into the range', () => {
    // Two sets of 45×8 @2 done; the hold rule decrements to 7 — BELOW the
    // stated 8-12 floor. The range-floor rule (fatigue-aware prescription,
    // Part 1 — the fixture's own "0c" defect note: "the engine proposed
    // trimming reps rather than raising load", inverted here to reducing
    // load rather than trimming reps) now discounts the LOAD instead of
    // shipping the truncated count: one increment down puts the predicted
    // reps (curve + session-capacity cap) back inside the range.
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 8,
      lastRir: 2,
      setsCompletedThisExercise: 2,
      ...arnoldCtx,
    });
    expect(rec.weightKg).toBe(42.5);
    expect(rec.reps).toBe(9);
    expect(rec.rationale).toBe('reduce_load');
    expect(rec.rangeFloorLoadDrop).toBe(true);
    expect(rec.provenance?.source).toBe('range_floor');
    expect(rec.outsideRange).toBeUndefined();
    // The resolved ask never demands more than the session demonstrated.
    const implied = estimateE1RM(rec.weightKg, rec.reps, rec.rir)!;
    expect(implied.value).toBeLessThanOrEqual(estimateE1RM(45, 8, 2)!.value * 1.01);
  });

  it('keeps the honest below-range flag when no achievable load reaches the floor', () => {
    // Same Arnold shape, but the only loadable increment is a 20 lb jump —
    // one step down (25) is past the −MAX_REDUCE_PCT bound, so no candidate
    // load exists. The sub-floor count stands and the contradiction is
    // flagged so the banner re-renders instead of silently claiming
    // "8-12 @ 2 RIR" over a 7-rep prescription.
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 8,
      lastRir: 2,
      setsCompletedThisExercise: 2,
      targetRepRange: ARNOLD_TARGET_REP_RANGE,
      targetRir: ARNOLD_TARGET_RIR,
      minIncrementKg: 20,
    });
    expect(rec.weightKg).toBe(45);
    expect(rec.reps).toBe(7);
    expect(rec.rangeFloorLoadDrop).toBeUndefined();
    expect(rec.outsideRange).toBe('below');
  });

  it('flags above-range predictions symmetrically', () => {
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 14,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    // 14 @2 sits exactly at the overshoot boundary (not past it) with dev 0 —
    // the hold path decrements to 13, still above the range top. Honest reps
    // stay; the flag must fire.
    expect(rec.reps).toBe(13);
    expect(rec.outsideRange).toBe('above');
  });

  it('stays silent for in-range prescriptions', () => {
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 10,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      ...arnoldCtx,
    });
    expect(rec.outsideRange).toBeUndefined();
  });
});

describe('INV-3 — never round onto the current or previous load (Phase D, re-asserted)', () => {
  it('an intended increase off the CURRENT load lands strictly above it', () => {
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 14,
      lastRir: 4, // objective overshoot: 14 > 12 + REP_OVERSHOOT is false; 14 ≥ 12 and dev ≥ 2 → increase
      setsCompletedThisExercise: 1,
      ...arnoldCtx,
    });
    expect(rec.rationale).toBe('increase_load');
    expect(rec.weightKg).toBeGreaterThan(45);
  });

  it('grid arithmetic never renders an intended change as the reference (property)', () => {
    for (const referenceKg of [40, 42.5, 45, 47.5, 182.5]) {
      for (let delta = 1.25; delta <= 5; delta += 0.55) {
        const up = roundPrescribedLoad(referenceKg + delta, {
          availableIncrementsKg: [2.5],
          referenceKg,
        });
        expect(up.weightKg).toBeGreaterThan(referenceKg);
        const down = roundPrescribedLoad(referenceKg - delta, {
          availableIncrementsKg: [2.5],
          referenceKg,
        });
        expect(down.weightKg).toBeLessThan(referenceKg);
      }
    }
  });
});

describe('Arnold Press fixture — whole-session flow under Phase A + Phase 0', () => {
  const positionContext = (n: number) => ({
    prevSessionSets: ARNOLD_JUL_20,
    todaySets: ARNOLD_JUL_27_LOGGED.slice(0, n).map((s) => ({
      weightKg: s.weightKg,
      reps: s.reps,
    })),
    plannedSetCount: ARNOLD_PLANNED_SETS,
  });
  const observed = (n: number) =>
    ARNOLD_JUL_27_LOGGED.slice(0, n).map((s) => ({
      weightKg: s.weightKg,
      reps: s.reps,
      rir: s.rir,
    }));

  it('set 2 position-matches last session (45×8, held — its @1 was harder than target)', () => {
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 8,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      ...arnoldCtx,
      sessionObservedSets: observed(1),
      positionContext: positionContext(1),
    });
    expect(rec.weightKg).toBe(45);
    expect(rec.reps).toBe(8);
    expect(rec.positionMatch?.progression).toBe('hold');
  });

  it('set 3 position-matches to 40×10 (last session\'s drop set, held at @0)', () => {
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 8,
      lastRir: 2,
      setsCompletedThisExercise: 2,
      ...arnoldCtx,
      sessionObservedSets: observed(2),
      positionContext: positionContext(2),
    });
    expect(rec.weightKg).toBe(40);
    expect(rec.reps).toBe(10);
    expect(rec.positionMatch?.progression).toBe('hold');
  });
});
