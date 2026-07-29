/**
 * 2026-07-29 prescription-engine defects — Rope Tricep Pushdown fixture.
 *
 * Step 1 (root cause): the session-capacity cap operated in REP space — it
 * took the rep count of today's highest-e1RM set and used it (±1) as a rep
 * ceiling at a DIFFERENT load. Reps are load-dependent, so the cap tightened
 * as the top set got heavier: 72.5×12 (set 1) anchored BOTH the set-2 and
 * set-3 prescriptions at "13 reps", producing 65×13 — a lower implied e1RM
 * than the 65×14 the rationale claimed to be progressing from.
 *
 * The fix caps in e1RM space via the canonical module:
 *   cap_e1rm    = sessionCapacityCapE1RM(today's sets) — fatigue-discounted
 *                 by FATIGUE_K per set since each observation;
 *   target_e1rm = min(ask implied e1RM, cap_e1rm), solved back to reps at
 *                 the prescribed load.
 * Raw rep counts are never compared across loads.
 */

import { recommendSet, sessionCapacityCapE1RM } from '../setRecommender';
import { impliedE1RMFloor } from '../shared/e1rm';
import { FATIGUE_K } from '../suggestionEngine/constants';
import {
  PUSHDOWN_JUL_22,
  PUSHDOWN_JUL_29_LOGGED,
  PUSHDOWN_TARGET_REP_RANGE,
  PUSHDOWN_TARGET_RIR,
  PUSHDOWN_MIN_INCREMENT,
  PUSHDOWN_PLANNED_SETS,
} from './fixtures/ropeTricepPushdown';

const pushdownCtx = {
  targetRepRange: PUSHDOWN_TARGET_REP_RANGE,
  targetRir: PUSHDOWN_TARGET_RIR,
  minIncrementKg: PUSHDOWN_MIN_INCREMENT,
} as const;

/** recommendSet input for the prescription AFTER `setsDone` logged sets. */
const afterSets = (setsDone: number) => {
  const logged = PUSHDOWN_JUL_29_LOGGED.slice(0, setsDone);
  const last = logged[logged.length - 1];
  return {
    lastWeightKg: last.weightKg,
    lastReps: last.reps,
    lastRir: last.rir,
    setsCompletedThisExercise: setsDone,
    ...pushdownCtx,
    sessionObservedSets: logged.map((s) => ({
      weightKg: s.weightKg,
      reps: s.reps,
      rir: s.rir,
    })),
    positionContext: {
      prevSessionSets: PUSHDOWN_JUL_22,
      todaySets: logged.map((s) => ({ weightKg: s.weightKg, reps: s.reps })),
      plannedSetCount: PUSHDOWN_PLANNED_SETS,
    },
  };
};

/** The matched reference set's implied e1RM, at the effort basis asks are graded at. */
const MATCHED_REF_FLOOR = impliedE1RMFloor(65, 14, Math.min(2.5, PUSHDOWN_TARGET_RIR))!;

describe('cap operates in e1RM space, never in rep counts across loads', () => {
  it('regression 1 — set 2: prescribed e1RM is never below the matched 65×14', () => {
    // LIVE DEFECT: 65×13 @2 — implied e1RM BELOW the 65×14 it claimed to
    // progress from, because set 1's 12 reps (+1) at 72.5 became a rep
    // ceiling at 65.
    const rec = recommendSet(afterSets(1));
    const prescribed = impliedE1RMFloor(rec.weightKg, rec.reps, rec.rir)!;
    expect(prescribed).toBeGreaterThanOrEqual(MATCHED_REF_FLOOR);
    // The specific dead state: a 65-load ask trimmed to fewer reps than the
    // reference set at the same load can never recur.
    if (rec.weightKg === 65) {
      expect(rec.reps).toBeGreaterThanOrEqual(14);
    }
  });

  it('regression 2 — set 3: prescribed e1RM never below 65×14, and the cap is not stale', () => {
    const rec = recommendSet(afterSets(2));
    const prescribed = impliedE1RMFloor(rec.weightKg, rec.reps, rec.rir)!;
    expect(prescribed).toBeGreaterThanOrEqual(MATCHED_REF_FLOOR);
    if (rec.weightKg === 65) {
      expect(rec.reps).toBeGreaterThanOrEqual(14);
    }

    // Pins the stale-anchor bug specifically: the cap computed for set 3
    // (after 70×13 logged) must DIFFER from the cap computed for set 2 —
    // the live engine held the identical set-1-anchored cap for both.
    const capAtSet2 = sessionCapacityCapE1RM(
      PUSHDOWN_JUL_29_LOGGED.slice(0, 1).map((s) => ({ ...s }))
    )!;
    const capAtSet3 = sessionCapacityCapE1RM(
      PUSHDOWN_JUL_29_LOGGED.slice(0, 2).map((s) => ({ ...s }))
    )!;
    expect(capAtSet3).not.toBe(capAtSet2);
  });

  it('a heavier top set can only RAISE the cap for a lighter-load ask, never trim its reps', () => {
    // The unit error made the cap TIGHTER as the top set got heavier. In
    // e1RM space, 72.5×12 @2 (implied 104.4) sits far ABOVE anything a
    // 65-load ask can imply (flat floor 93.6) — so no 65-load rep count can
    // be capacity-clamped by it.
    const rec = recommendSet(afterSets(1));
    expect(rec.sessionCapacityClamped).toBeUndefined();
  });
});

describe('sessionCapacityCapE1RM — cap semantics', () => {
  const set1 = { weightKg: 72.5, reps: 12, rir: 2 };
  const set2 = { weightKg: 70, reps: 13, rir: 2 };

  it('the just-completed set carries no fatigue discount (repeating it stays legal)', () => {
    expect(sessionCapacityCapE1RM([set1])).toBeCloseTo(impliedE1RMFloor(72.5, 12, 2)!, 5);
  });

  it('discounts each earlier set by FATIGUE_K per set performed since it', () => {
    const expected = Math.max(
      impliedE1RMFloor(72.5, 12, 2)! * FATIGUE_K,
      impliedE1RMFloor(70, 13, 2)!
    );
    expect(sessionCapacityCapE1RM([set1, set2])).toBeCloseTo(expected, 5);
  });

  it('a beyond-domain rep-out yields NO binding cap (its floor is only a lower bound)', () => {
    // 60×20 @2 is beyond the estimator's 15-eff domain: the set proves at
    // LEAST the eff-12 floor, and how much more is unmeasurable — capping
    // an ask at that lower bound would over-trim asks the set itself makes
    // achievable.
    expect(sessionCapacityCapE1RM([{ weightKg: 60, reps: 20, rir: 2 }])).toBeNull();
    // Dominated by a measured, stronger observation, it changes nothing.
    expect(
      sessionCapacityCapE1RM([
        { weightKg: 60, reps: 20, rir: 2 },
        { weightKg: 100, reps: 10, rir: 2 },
      ])
    ).toBeCloseTo(impliedE1RMFloor(100, 10, 2)!, 5);
  });

  it('returns null when nothing in the pool is measurable', () => {
    expect(sessionCapacityCapE1RM([])).toBeNull();
    expect(sessionCapacityCapE1RM([{ weightKg: 0, reps: 10, rir: 2 }])).toBeNull();
  });
});
