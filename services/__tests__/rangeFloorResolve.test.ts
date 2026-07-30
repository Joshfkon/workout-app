/**
 * Range-floor rule — fatigue-aware prescription, Part 1.
 *
 * Hard invariant: detected within-session fatigue discounts the LOAD axis;
 * reps are never truncated below the prescribed range floor while the load
 * holds. The live defect: with heavy accumulated fatigue the engine matched
 * a set to last session's load, capped the reps at today's best, and
 * prescribed `45 × 5` against an 8–12 range while its own copy admitted
 * "predicted 5 — below the 8–12 range". The correct move is the one the
 * too-heavy branch already makes: reduce the load until the predicted reps
 * land inside the range.
 *
 * The resolve is the LAST stage of finalizeRec: whatever produced the
 * sub-floor count (the INV-2 cap trim, the hold-branch fatigue decline, or
 * a positional replay of a sub-floor historical set), the load steps down
 * the increment grid — bounded by MAX_REDUCE_PCT — until the predicted reps
 * (fatigue-adjusted curve, ceilinged by the session-capacity cap) reach the
 * floor. The session-capacity cap stays senior: the resolved ask never
 * implies more capacity than today's sets demonstrated.
 */

import { recommendSet } from '../setRecommender';
import { impliedE1RMFloor } from '../shared/e1rm';
import {
  MAX_REDUCE_PCT,
  SESSION_CAPACITY_TOLERANCE,
  FATIGUE_K,
} from '../suggestionEngine/constants';

const RANGE: [number, number] = [8, 12];

describe('range-floor resolve — cap-trimmed prescriptions (the observed bug shape)', () => {
  // Strong last session (100×11s), harder-than-target today (100×8 @1 on
  // set 1 — inside the deadband, so the position match engages): the
  // positional add_rep replay (100×12 asked @2) is legitimately trimmed by
  // the session-capacity cap, and at the held load the trim lands at ×7 —
  // below the 8-rep floor. The old engine shipped that truncated count (the
  // `45 × 5 against 8–12` live defect). Now the load absorbs the fatigue:
  // one grid step down puts the predicted reps back inside the range.
  const weakDay = () =>
    recommendSet({
      lastWeightKg: 100,
      lastReps: 8,
      lastRir: 1,
      setsCompletedThisExercise: 1,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      positionContext: {
        prevSessionSets: [
          { weightKg: 100, reps: 11, rir: 2 },
          { weightKg: 100, reps: 11, rir: 2 },
          { weightKg: 100, reps: 10, rir: 1 },
        ],
        todaySets: [{ weightKg: 100, reps: 8 }],
        plannedSetCount: 3,
      },
    });

  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('prescribes a reduced load inside the range, never a truncated rep count', () => {
    const rec = weakDay();
    expect(rec.weightKg).toBeLessThan(100);
    expect(rec.reps).toBeGreaterThanOrEqual(RANGE[0]);
    expect(rec.reps).toBeLessThanOrEqual(RANGE[1]);
    expect(rec.rangeFloorLoadDrop).toBe(true);
    expect(rec.rationale).toBe('reduce_load');
    expect(rec.outsideRange).toBeUndefined();
    // Pinned so a numeric drift is loud: one cap-fitting in-range solution.
    expect(rec.weightKg).toBe(95);
    expect(rec.reps).toBe(8);
  });

  it('stays under the session-capacity cap at the resolved load', () => {
    const rec = weakDay();
    // Cap after one set: the just-completed 100×8 @1 at exponent 0.
    const cap = impliedE1RMFloor(100, 8, 1)! * Math.pow(FATIGUE_K, 0);
    const implied = impliedE1RMFloor(rec.weightKg, rec.reps, rec.rir)!;
    expect(implied).toBeLessThanOrEqual(cap * (1 + SESSION_CAPACITY_TOLERANCE));
  });

  it('provenance names range_floor and keeps the matched set as reference', () => {
    const rec = weakDay();
    expect(rec.provenance?.source).toBe('range_floor');
    expect(rec.provenance?.referenceSet).toEqual({ weightKg: 100, reps: 11, rir: 2 });
    // The cap trim still happened upstream and is surfaced; the direction is
    // honestly a regress (fatigue-limited day), never a progression claim.
    expect(rec.sessionCapacityClamped).toBe(true);
    expect(rec.provenance?.direction).toBe('regress');
  });
});

describe('range-floor resolve — bounds and non-firing cases', () => {
  it('never reduces below the MAX_REDUCE_PCT bound (sub-floor stands, flagged)', () => {
    // Only a 20 lb increment exists: the single step down (25) is beyond
    // 45 × (1 − MAX_REDUCE_PCT) = 31.5, so no candidate load is achievable.
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 8,
      lastRir: 2,
      setsCompletedThisExercise: 2,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 20,
    });
    expect(rec.weightKg).toBe(45);
    expect(rec.rangeFloorLoadDrop).toBeUndefined();
    expect(rec.outsideRange).toBe('below');
    expect(45 * (1 - MAX_REDUCE_PCT)).toBeGreaterThan(45 - 20);
  });

  it('does not fire at session start (n = 0) — seeding semantics stay intact', () => {
    // Direct recommendSet with no sets completed: the hold rule predicts 7
    // (below floor) but the resolve is within-session only; session starts
    // keep the honest count + flag (recommendSessionStart owns their
    // hold / +1 / confirmed-regression semantics).
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 8,
      lastRir: 2,
      setsCompletedThisExercise: 0,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    expect(rec.weightKg).toBe(45);
    expect(rec.reps).toBe(7);
    expect(rec.rangeFloorLoadDrop).toBeUndefined();
    expect(rec.outsideRange).toBe('below');
  });

  it('does not drag an evidence-driven load INCREASE back down', () => {
    // Cold-start "easy" rating bumps the load even though the curve (fed a
    // capped RIR chip) may predict sub-floor reps at the bumped load — the
    // estimate is known wrong-low, and the resolve must not undo the
    // evidence-driven step with curve pessimism.
    const rec = recommendSet({
      lastWeightKg: 20,
      lastReps: 10,
      lastRir: 4,
      setsCompletedThisExercise: 1,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      coldStart: true,
    });
    expect(rec.rationale).toBe('increase_load');
    expect(rec.weightKg).toBeGreaterThan(20);
    expect(rec.rangeFloorLoadDrop).toBeUndefined();
  });

  it('leaves in-range prescriptions untouched', () => {
    const rec = recommendSet({
      lastWeightKg: 100,
      lastReps: 10,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    expect(rec.weightKg).toBe(100);
    expect(rec.rangeFloorLoadDrop).toBeUndefined();
    expect(rec.outsideRange).toBeUndefined();
  });
});

describe('range-floor resolve — monotone in the increment grid', () => {
  it('takes the SMALLEST load reduction that reaches the floor', () => {
    // The Arnold maintain shape: one 2.5 step is enough — the resolve must
    // not over-reduce past the first in-range candidate.
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 8,
      lastRir: 2,
      setsCompletedThisExercise: 2,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    expect(rec.weightKg).toBe(42.5); // exactly one increment down
    expect(rec.reps).toBeGreaterThanOrEqual(RANGE[0]);
    expect(rec.reps).toBeLessThanOrEqual(RANGE[1]);
  });
});
