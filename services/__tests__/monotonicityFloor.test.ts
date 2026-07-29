/**
 * 2026-07-29 step 2 — the monotonicity floor.
 *
 * FINAL guard in the within-session prescription pipeline: a prescription
 * must never carry a LOWER implied e1RM (canonical module, like-to-like
 * effort basis) than the matched set from the previous session, unless an
 * explicit deload/readiness/phase directive says otherwise. The guard sits
 * AFTER every producing branch — the position match itself, and the
 * session-capacity cap that trims it — so a regression from ANY upstream
 * path is caught, restored when possible, and LOGGED with the branch that
 * produced it when not.
 */

import { recommendSet, type SetRecommenderInput } from '../setRecommender';
import { impliedE1RMFloor } from '../shared/e1rm';

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

const warnings = () => warnSpy.mock.calls.map((c) => String(c[0])).join('\n');

describe('monotonicity floor — restore when possible', () => {
  // Low-rep add_load trade: one 2.5% increment buys less e1RM than the rep
  // it trades away (Epley slope ≈ 3.3%/rep down here), so the textbook
  // "one increment up, one rep back" lands BELOW the matched set. The guard
  // must lift the ask back to the floor.
  const base: SetRecommenderInput = {
    lastWeightKg: 100,
    lastReps: 7,
    lastRir: 2,
    setsCompletedThisExercise: 1,
    targetRepRange: [3, 6],
    targetRir: 2,
    minIncrementKg: 2.5,
    positionContext: {
      prevSessionSets: [
        { weightKg: 100, reps: 6, rir: 2 },
        { weightKg: 100, reps: 6, rir: 2 },
        { weightKg: 100, reps: 5, rir: 1 },
      ],
      todaySets: [{ weightKg: 100, reps: 7 }],
      plannedSetCount: 3,
    },
  };

  it('re-solves an add_load trade that priced below the matched set (strictly above it)', () => {
    const rec = recommendSet(base);
    expect(rec.positionMatch?.progression).toBe('add_load');
    expect(rec.weightKg).toBe(102.5);
    // The raw trade would be 102.5×5 (implied 123.0) against the matched
    // 100×6 @2 (124.1) — the lever re-solves reps at the traded load to ×6
    // (127.2), a genuine progression, with no guard warning needed.
    expect(rec.reps).toBe(6);
    expect(rec.progressionLever).toBe('reps');
    const prescribed = impliedE1RMFloor(rec.weightKg, rec.reps, 2)!;
    const matched = impliedE1RMFloor(100, 6, 2)!;
    expect(prescribed).toBeGreaterThan(matched);
    expect(warnings()).not.toContain('monotonicity floor');
  });

  it('stands down under an explicit deload/readiness/phase directive', () => {
    const rec = recommendSet({ ...base, regressionDirective: 'deload' });
    expect(rec.weightKg).toBe(102.5);
    expect(rec.reps).toBe(5); // the un-guarded trade stands
    expect(warnings()).not.toContain('monotonicity floor');
  });
});

describe('monotonicity floor — log the producing branch when the floor is unreachable', () => {
  it('names session_capacity_cap when the cap trimmed a match below the floor', () => {
    // Weak day: today's set 1 (100×6 @2, implied 124.1) sits far below last
    // session's positional 100×10 @2 (implied 144). The cap legitimately
    // trims the add_rep replay — the sub-floor prescription stands, but the
    // guard must say WHICH branch produced it.
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
    expect(rec.positionMatch?.progression).toBe('add_rep');
    expect(rec.sessionCapacityClamped).toBe(true);
    // Sub-floor stands (fatigue-limited day is real), but never silently.
    const prescribed = impliedE1RMFloor(rec.weightKg, rec.reps, 2)!;
    expect(prescribed).toBeLessThan(impliedE1RMFloor(100, 10, 2)!);
    expect(warnings()).toContain('monotonicity floor');
    expect(warnings()).toContain('session_capacity_cap');
  });

  it('names the position-match branch when its own trade is sub-floor and the cap blocks restore', () => {
    // Today's set 1 (100×6 @2 → cap 124.1) leaves the branch's 102.5×5 trade
    // (123.0) uncapped, but blocks restoring ×6 (127.2): the sub-floor number
    // came from the match branch itself, and the log must say so.
    const rec = recommendSet({
      lastWeightKg: 100,
      lastReps: 6,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: [3, 6],
      targetRir: 2,
      minIncrementKg: 2.5,
      positionContext: {
        prevSessionSets: [
          { weightKg: 100, reps: 6, rir: 2 },
          { weightKg: 100, reps: 6, rir: 2 },
          { weightKg: 100, reps: 5, rir: 1 },
        ],
        todaySets: [{ weightKg: 100, reps: 6 }],
        plannedSetCount: 3,
      },
    });
    expect(rec.positionMatch?.progression).toBe('add_load');
    expect(rec.weightKg).toBe(102.5);
    expect(rec.reps).toBe(5);
    expect(rec.sessionCapacityClamped).toBeUndefined();
    expect(warnings()).toContain('monotonicity floor');
    expect(warnings()).toContain('position_match:add_load');
  });
});

describe('monotonicity floor — inert where it must be', () => {
  it('does not fire for a verbatim hold of the matched set', () => {
    // A hold repeats the matched set exactly — equal implied e1RM, and holds
    // are graded at the matched set's own recorded effort.
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
    expect(rec.positionMatch?.progression).toBe('hold');
    expect(rec.weightKg).toBe(192.5);
    expect(rec.reps).toBe(8);
    expect(warnings()).not.toContain('monotonicity floor');
  });

  it('does not fire on the anchor path (no matched previous-session set)', () => {
    const rec = recommendSet({
      lastWeightKg: 100,
      lastReps: 10,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    expect(rec.positionMatch).toBeUndefined();
    expect(warnings()).not.toContain('monotonicity floor');
  });
});
