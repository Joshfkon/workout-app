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
    // Earlier sets only — the just-completed set (the last* fields) is
    // appended to the ceiling pool automatically.
    sessionObservedSets: logged.slice(0, -1).map((s) => ({
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
  it('regression 1 — set 2: prescribed e1RM strictly above the matched 65×14 (canonical)', () => {
    // LIVE DEFECT: 65×13 @2 — implied e1RM BELOW the 65×14 it claimed to
    // progress from, because set 1's 12 reps (+1) at 72.5 became a rep
    // ceiling at 65. The whole 12-15 @2 range at 65 measures the same
    // canonical e1RM (flat region), so a true progression requires the LOAD
    // lever: one increment up, reps re-solved within the range.
    const rec = recommendSet(afterSets(1));
    const prescribed = impliedE1RMFloor(rec.weightKg, rec.reps, rec.rir)!;
    expect(prescribed).toBeGreaterThan(MATCHED_REF_FLOOR);
    expect(rec.weightKg).toBeGreaterThan(65);
    expect(rec.reps).toBeGreaterThanOrEqual(PUSHDOWN_TARGET_REP_RANGE[0]);
    expect(rec.reps).toBeLessThanOrEqual(PUSHDOWN_TARGET_REP_RANGE[1]);
    expect(rec.progressionLever).toBe('load');
  });

  it('regression 2 — set 3: prescribed e1RM strictly above 65×14, and the cap is not stale', () => {
    const rec = recommendSet(afterSets(2));
    const prescribed = impliedE1RMFloor(rec.weightKg, rec.reps, rec.rir)!;
    expect(prescribed).toBeGreaterThan(MATCHED_REF_FLOOR);
    expect(rec.weightKg).toBeGreaterThan(65);

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

  it('regression 3 — an e1RM unreachable at 15 reps in a 12-15 range returns an increased load, not a clamped rep count', () => {
    // The rep lever is dead here: at 65, reps 12-15 @2 all measure 93.6 and
    // counts past 13 are beyond the estimator's domain. The engine must not
    // fail closed at the range ceiling (or under the cap) — it steps the
    // load by the exercise's increment and re-solves reps inside the range.
    const rec = recommendSet(afterSets(1));
    expect(rec.positionMatch?.progression).toBe('add_rep'); // the branch asked for reps…
    expect(rec.progressionLever).toBe('load'); // …the lever answered with load
    expect(rec.weightKg).toBe(65 + PUSHDOWN_MIN_INCREMENT); // grid granularity respected
    expect(rec.reps).toBeLessThanOrEqual(PUSHDOWN_TARGET_REP_RANGE[1]);
    expect(rec.reps).toBeGreaterThanOrEqual(PUSHDOWN_TARGET_REP_RANGE[0]);
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

describe('regression 4 — rationale provenance: stated direction matches the actual change', () => {
  /**
   * The live defect was structural: the rationale string was composed from
   * the match branch while the cap changed the number ("go one more rep"
   * over one rep fewer). The provenance is now emitted from the FINAL
   * numbers; this asserts its stated direction always equals the measured
   * sign of the change vs. the referenced set, and that the source names
   * the stage that actually produced the number.
   */
  const measuredDirection = (rec: ReturnType<typeof recommendSet>) => {
    const ref = rec.provenance!.referenceSet!;
    const basis = Math.min(ref.rir ?? rec.rir, rec.rir);
    const refValue = impliedE1RMFloor(ref.weightKg, ref.reps, basis)!;
    const finalValue = impliedE1RMFloor(rec.weightKg, rec.reps, basis)!;
    return finalValue > refValue ? 'progress' : finalValue < refValue ? 'regress' : 'repeat';
  };

  it('pushdown set 2: a load-lever progression states progress — and actually progresses', () => {
    const rec = recommendSet(afterSets(1));
    expect(rec.provenance?.source).toBe('load_lever');
    expect(rec.provenance?.direction).toBe('progress');
    expect(measuredDirection(rec)).toBe('progress');
  });

  it('a cap-trimmed match states regress — never a progression claim', () => {
    // Weak day: the positional replay is trimmed under today's demonstrated
    // capacity. The provenance must own that as the capacity cap with a
    // regress direction; a "go one more rep" claim is structurally gone.
    const rec = recommendSet({
      lastWeightKg: 100,
      lastReps: 6,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: [3, 12],
      targetRir: 2,
      minIncrementKg: 2.5,
      positionContext: {
        prevSessionSets: [
          { weightKg: 100, reps: 10, rir: 2 },
          { weightKg: 100, reps: 10, rir: 2 },
          { weightKg: 100, reps: 9, rir: 1 },
        ],
        todaySets: [{ weightKg: 100, reps: 6 }],
        plannedSetCount: 3,
      },
    });
    expect(rec.provenance?.source).toBe('session_capacity_cap');
    expect(rec.provenance?.direction).toBe('regress');
    expect(measuredDirection(rec)).toBe('regress');
  });

  it('a verbatim hold states repeat — and actually repeats', () => {
    const rec = recommendSet({
      lastWeightKg: 182.5,
      lastReps: 9,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.5,
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
    expect(rec.provenance?.source).toBe('position_match');
    expect(rec.positionMatch?.progression).toBe('hold');
    expect(rec.provenance?.direction).toBe('repeat');
    expect(measuredDirection(rec)).toBe('repeat');
  });

  it('an in-domain add_rep states progress — and actually progresses', () => {
    const rec = recommendSet({
      lastWeightKg: 100,
      lastReps: 8,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.5,
      sessionObservedSets: [],
      positionContext: {
        prevSessionSets: [
          { weightKg: 100, reps: 8, rir: 2 },
          { weightKg: 100, reps: 7, rir: 2 },
        ],
        todaySets: [{ weightKg: 100, reps: 8 }],
        plannedSetCount: 2,
      },
    });
    expect(rec.positionMatch?.progression).toBe('add_rep');
    expect(rec.provenance?.source).toBe('position_match');
    expect(rec.provenance?.direction).toBe('progress');
    expect(measuredDirection(rec)).toBe('progress');
  });
});

describe('Codex review on #565 — cap pool must not double-count the just-completed set', () => {
  it('passing ALL completed sets (live caller) and earlier-sets-only give the same prescription', () => {
    // ExerciseCard passes every completed set in sessionObservedSets; the
    // engine also appends the last* fields. A duplicate makes the fatigue
    // decay treat the pool as one set longer, over-discounting earlier
    // anchors (set 1 at FATIGUE_K² instead of FATIGUE_K after two sets).
    const base = afterSets(2); // helper passes earlier sets only
    const fullPool = {
      ...base,
      sessionObservedSets: PUSHDOWN_JUL_29_LOGGED.map((s) => ({ ...s })),
    };
    expect(recommendSet(fullPool)).toEqual(recommendSet(base));
  });

  it('two identical consecutive sets both count when the full pool is passed', () => {
    // Dedupe keys on the pool's FINAL entry only — an earlier identical set
    // (Arnold 45×8 @2 twice) must stay in the pool with its own decay slot.
    const twice = [
      { weightKg: 45, reps: 8, rir: 2 },
      { weightKg: 45, reps: 8, rir: 2 },
    ];
    const rec = recommendSet({
      lastWeightKg: 45,
      lastReps: 8,
      lastRir: 2,
      setsCompletedThisExercise: 2,
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.5,
      sessionObservedSets: twice,
    });
    // Pool stays [set1, set2]: the last set anchors the cap at exponent 0 —
    // repeating the just-done 45×8 @2 (implied 60.0) remains legal, so the
    // CAP must not clamp. (The prescription itself moves to 42.5×9 via the
    // range-floor rule — the hold rule's ×7 sits below the 8-rep floor — but
    // that is the load axis absorbing fatigue, not a capacity clamp; a
    // double-counted pool would have shown up as sessionCapacityClamped.)
    expect(rec.sessionCapacityClamped).toBeUndefined();
    expect(rec.weightKg).toBe(42.5);
    expect(rec.reps).toBe(9);
    expect(rec.rangeFloorLoadDrop).toBe(true);
  });
});

describe('Codex review on #565 — load lever works for wholly beyond-domain ranges', () => {
  it('a 15-20 @2 range (every count beyond the point-estimator domain) still steps the load', () => {
    // repMin + RIR = 17 effective reps: estimateE1RM is null at EVERY
    // in-range count, so the in-domain candidate tier can never fire. The
    // implied floor still ranks loads — the add_rep replay must become a
    // load step, never a "go one more rep" claim over a repeat direction.
    const rec = recommendSet({
      lastWeightKg: 60,
      lastReps: 18,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: [15, 20],
      targetRir: 2,
      minIncrementKg: 2.5,
      positionContext: {
        prevSessionSets: [
          { weightKg: 60, reps: 18, rir: 2.5 },
          { weightKg: 60, reps: 18, rir: 2.5 },
          { weightKg: 60, reps: 16, rir: 1 },
        ],
        todaySets: [{ weightKg: 60, reps: 18 }],
        plannedSetCount: 3,
      },
    });
    expect(rec.positionMatch?.progression).toBe('add_rep');
    expect(rec.progressionLever).toBe('load');
    expect(rec.weightKg).toBe(62.5);
    // Reps carry over from the matched set, clamped into the range.
    expect(rec.reps).toBe(18);
    expect(rec.provenance?.source).toBe('load_lever');
    expect(rec.provenance?.direction).toBe('progress');
    const prescribed = impliedE1RMFloor(rec.weightKg, rec.reps, 2)!;
    expect(prescribed).toBeGreaterThan(impliedE1RMFloor(60, 18, 2)!);
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
