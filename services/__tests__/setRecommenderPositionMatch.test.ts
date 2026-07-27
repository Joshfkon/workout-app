/**
 * Phase A — set-position matching (intra-session prescription).
 *
 * Root defect being fixed: prescriptions were re-derived per set from a
 * session-START anchor, with no term for what happened earlier in the session.
 * Position matching fixes both observed misses with no fitted model:
 *
 *   target for set N = what the lifter did at set position N last session,
 *   plus the smallest meaningful progression (one more rep at the same load
 *   when the positional set had target reserve; one increment at fewer reps
 *   at the rep ceiling; held verbatim when it was taken harder than target).
 *
 * It applies only when the sessions are comparable (set count within
 * tolerance, earlier positions at comparable loads, positional set is a
 * working set); otherwise the engine falls through to the anchor path.
 *
 * The Iso-Lateral Incline Press fixture is FROZEN (see fixtures/) — if a
 * change breaks these expectations, the change is wrong.
 */

import {
  matchPositionTarget,
  recommendSet,
  recommendSeedForSlot,
} from '../setRecommender';
import {
  POSITION_MATCH_SET_COUNT_TOLERANCE,
  POSITION_MATCH_LOAD_TOLERANCE,
} from '../suggestionEngine/constants';
import {
  JUL_21_SESSION,
  JUL_27_SESSION,
  ISO_INCLINE_TARGET_REP_RANGE,
  ISO_INCLINE_TARGET_RIR,
  ISO_INCLINE_SMALLEST_INCREMENT,
  ISO_INCLINE_PLANNED_SETS,
} from './fixtures/isoLateralInclinePress';

/** Shared context for the fixture exercise. */
const fixtureCtx = {
  targetRepRange: ISO_INCLINE_TARGET_REP_RANGE,
  targetRir: ISO_INCLINE_TARGET_RIR,
  minIncrementKg: ISO_INCLINE_SMALLEST_INCREMENT,
} as const;

const positionContext = (setsDone: number) => ({
  prevSessionSets: JUL_21_SESSION,
  todaySets: JUL_27_SESSION.slice(0, setsDone).map((s) => ({
    weightKg: s.weightKg,
    reps: s.reps,
  })),
  plannedSetCount: ISO_INCLINE_PLANNED_SETS,
});

describe('MISS A — set 2 must follow last session\'s set position, not hold the set-1 load', () => {
  // Jul 27 set 1: 182.5×9 @2 — a rep overshoot of the prescribed 8 AT target
  // effort. The old hold rule read effort only (dev = 0 → maintain 182.5),
  // ignoring the rep term. Last session's set position 2 was 192.5×8 @1:
  // position matching prescribes 192.5×8 (the lifter beat it live: 192.5×9 @1).
  it('prescribes 192.5×8 for set 2 after set 1 of the Jul 27 session', () => {
    const rec = recommendSet({
      lastWeightKg: JUL_27_SESSION[0].weightKg,
      lastReps: JUL_27_SESSION[0].reps,
      lastRir: JUL_27_SESSION[0].rir,
      setsCompletedThisExercise: 1,
      sessionBestE1RMKg: undefined,
      ...fixtureCtx,
      positionContext: positionContext(1),
    });
    expect(rec.weightKg).toBe(192.5);
    expect(rec.reps).toBe(8);
    expect(rec.positionMatch).toBeDefined();
    expect(rec.positionMatch?.progression).toBe('hold');
    expect(rec.rationale).toBe('increase_load');
  });
});

describe('MISS B — set 4 must prescribe from the session as performed, not the static anchor', () => {
  // After 24 intervening reps including a true-failure set (195×6 @0), the old
  // engine re-derived set 4 from the session-start anchor — the SAME 182.5×8
  // it produced for set 2 before any of that happened. Last session's set
  // position 4 was 182.5×7 @0 — taken past target effort, so it is held
  // verbatim: 182.5×7, never an overshoot to 8. (Live: 182.5×7 @1.)
  it('prescribes 182.5×7 for set 4 after sets 1–3 of the Jul 27 session', () => {
    const rec = recommendSet({
      lastWeightKg: JUL_27_SESSION[2].weightKg,
      lastReps: JUL_27_SESSION[2].reps,
      lastRir: JUL_27_SESSION[2].rir,
      setsCompletedThisExercise: 3,
      // The session-best anchor the old path over-trusted (set 2's fresh e1RM).
      sessionBestE1RMKg: 257,
      ...fixtureCtx,
      positionContext: positionContext(3),
    });
    expect(rec.weightKg).toBe(182.5);
    expect(rec.reps).toBe(7);
    expect(rec.positionMatch?.progression).toBe('hold');
  });
});

describe('session start — position-matched seed for set 1', () => {
  // Last session's set 1 was 182.5×8 @2.5: at/above target reserve, so the
  // smallest meaningful progression applies — one more rep at the same load.
  // (Live Jul 27 set 1: 182.5×9 @2 — exactly this target, met.)
  it('seeds 182.5×9 for slot 0 (one more rep at the same load)', () => {
    const seed = recommendSeedForSlot({
      role: 'working',
      ...fixtureCtx,
      anchorE1RMKg: 250,
      recentWorkingWeightKg: 202.5,
      prevWeightKg: JUL_21_SESSION[0].weightKg,
      prevReps: JUL_21_SESSION[0].reps,
      prevRir: JUL_21_SESSION[0].rir,
      prevSessionSets: JUL_21_SESSION,
      slotIndex: 0,
      plannedSetCount: ISO_INCLINE_PLANNED_SETS,
    });
    expect(seed.anchorSource).toBe('position_match');
    expect(seed.weightKg).toBe(182.5);
    expect(seed.seedReps).toBe(9);
  });

  it('seeds every fixture slot without regressing any position', () => {
    // Whole-session sanity: slot targets are exactly last session's positional
    // sets with progression only where reserve existed (set 1), holds
    // elsewhere — targets DESCEND with the session's fatigue shape instead of
    // re-deriving one number from a static anchor.
    const expected = [
      { weightKg: 182.5, reps: 9 }, // 182.5×8 @2.5 → +1 rep
      { weightKg: 192.5, reps: 8 }, // @1 → hold
      { weightKg: 202.5, reps: 5 }, // @0 → hold
      { weightKg: 182.5, reps: 7 }, // @0 → hold
    ];
    expected.forEach((exp, slot) => {
      const seed = recommendSeedForSlot({
        role: 'working',
        ...fixtureCtx,
        anchorE1RMKg: 250,
        recentWorkingWeightKg: 202.5,
        prevWeightKg: JUL_21_SESSION[slot].weightKg,
        prevReps: JUL_21_SESSION[slot].reps,
        prevRir: JUL_21_SESSION[slot].rir,
        prevSessionSets: JUL_21_SESSION,
        slotIndex: slot,
        plannedSetCount: ISO_INCLINE_PLANNED_SETS,
      });
      expect({ slot, weightKg: seed.weightKg, reps: seed.seedReps }).toEqual({
        slot,
        weightKg: exp.weightKg,
        reps: exp.reps,
      });
    });
  });
});

describe('matchPositionTarget — progression rule', () => {
  const base = {
    prevSessionSets: JUL_21_SESSION,
    todaySets: [],
    plannedSetCount: ISO_INCLINE_PLANNED_SETS,
    ...fixtureCtx,
  };

  it('adds one rep at the same load when the positional set had target reserve', () => {
    const t = matchPositionTarget({ ...base, position: 0 });
    expect(t).toEqual(
      expect.objectContaining({ weightKg: 182.5, reps: 9, progression: 'add_rep' })
    );
  });

  it('holds verbatim when the positional set was harder than target', () => {
    const t = matchPositionTarget({ ...base, position: 1 });
    expect(t).toEqual(
      expect.objectContaining({ weightKg: 192.5, reps: 8, progression: 'hold' })
    );
  });

  it('trades one increment for a rep at the rep ceiling', () => {
    const t = matchPositionTarget({
      ...base,
      prevSessionSets: [
        { weightKg: 192.5, reps: 12, rir: 2 },
        { weightKg: 192.5, reps: 10, rir: 1 },
        { weightKg: 192.5, reps: 9, rir: 1 },
        { weightKg: 182.5, reps: 9, rir: 1 },
      ],
      position: 0,
    });
    expect(t).toEqual(
      expect.objectContaining({ weightKg: 195, reps: 11, progression: 'add_load' })
    );
  });

  it('treats a half-chip below target (RIR 1.5 vs 2) as at-target and progresses', () => {
    const t = matchPositionTarget({
      ...base,
      prevSessionSets: [{ weightKg: 182.5, reps: 9, rir: 1.5 }, ...JUL_21_SESSION.slice(1)],
      position: 0,
    });
    expect(t).toEqual(
      expect.objectContaining({ weightKg: 182.5, reps: 10, progression: 'add_rep' })
    );
  });

  it('assumes on-target effort when the positional set has no RIR record', () => {
    const t = matchPositionTarget({
      ...base,
      prevSessionSets: [{ weightKg: 182.5, reps: 9 }, ...JUL_21_SESSION.slice(1)],
      position: 0,
    });
    expect(t).toEqual(
      expect.objectContaining({ weightKg: 182.5, reps: 10, progression: 'add_rep' })
    );
  });
});

describe('matchPositionTarget — applicability gates (fall through to the anchor path)', () => {
  const base = {
    prevSessionSets: JUL_21_SESSION,
    todaySets: [],
    plannedSetCount: ISO_INCLINE_PLANNED_SETS,
    ...fixtureCtx,
  };

  it('returns null when the previous session has no set at this position', () => {
    expect(matchPositionTarget({ ...base, position: 4 })).toBeNull();
  });

  it('returns null when set counts are not comparable', () => {
    expect(
      matchPositionTarget({
        ...base,
        position: 0,
        plannedSetCount:
          ISO_INCLINE_PLANNED_SETS + POSITION_MATCH_SET_COUNT_TOLERANCE + 1,
      })
    ).toBeNull();
  });

  it('tolerates a set-count difference within the tolerance', () => {
    expect(
      matchPositionTarget({
        ...base,
        position: 0,
        plannedSetCount: ISO_INCLINE_PLANNED_SETS + POSITION_MATCH_SET_COUNT_TOLERANCE,
      })
    ).not.toBeNull();
  });

  it('returns null when today\'s earlier sets diverged from last session\'s loads', () => {
    const divergedLoad =
      JUL_21_SESSION[0].weightKg * (1 - POSITION_MATCH_LOAD_TOLERANCE * 2);
    expect(
      matchPositionTarget({
        ...base,
        position: 1,
        todaySets: [{ weightKg: divergedLoad, reps: 9 }],
      })
    ).toBeNull();
  });

  it('accepts today\'s loads within the comparability tolerance (fixture set 3: 195 vs 202.5)', () => {
    // 195 vs 202.5 = 3.7% under — comparable; position 3 still matches.
    expect(
      matchPositionTarget({
        ...base,
        position: 3,
        todaySets: JUL_27_SESSION.slice(0, 3).map((s) => ({
          weightKg: s.weightKg,
          reps: s.reps,
        })),
      })
    ).toEqual(expect.objectContaining({ weightKg: 182.5, reps: 7 }));
  });

  it('returns null for a positional set far beyond the range (different scheme — Codex review)', () => {
    // A previous 192.5×15 against 8-12 proves under-load / another scheme:
    // trading one increment off it would seed ×14, outside the exercise's
    // own stated range and bypassing the anchor path's overshoot repricing.
    expect(
      matchPositionTarget({
        ...base,
        prevSessionSets: [
          { weightKg: 192.5, reps: 15, rir: 2 },
          ...JUL_21_SESSION.slice(1),
        ],
        position: 0,
      })
    ).toBeNull();
  });

  it('returns null past the ceiling but under the overshoot proof (no trade from ×13)', () => {
    // 13 vs a 12 ceiling is not "at the ceiling": the trade is reserved for
    // textbook double progression; between-scheme counts fall through.
    expect(
      matchPositionTarget({
        ...base,
        prevSessionSets: [
          { weightKg: 192.5, reps: 13, rir: 2 },
          ...JUL_21_SESSION.slice(1),
        ],
        position: 0,
      })
    ).toBeNull();
  });

  it('returns null when the positional set was a ramp/feeder set', () => {
    expect(
      matchPositionTarget({
        ...base,
        prevSessionSets: [
          { weightKg: 100, reps: 12, rir: 4 }, // 49% of top — inferred ramp
          { weightKg: 202.5, reps: 8, rir: 2 },
          { weightKg: 202.5, reps: 7, rir: 1 },
          { weightKg: 202.5, reps: 6, rir: 1 },
        ],
        position: 0,
      })
    ).toBeNull();
  });

  it('returns null for an empty previous session', () => {
    expect(matchPositionTarget({ ...base, prevSessionSets: [], position: 0 })).toBeNull();
  });
});

describe('recommendSet — safety guards on the position-matched path', () => {
  it('falls through when the last set ground past the deadband and the match asks for MORE load', () => {
    // Today crashed early: set 1 = 182.5×6 @0 (past the failure deadband).
    // Position 2 last session was 192.5×8 — position matching must not
    // re-prescribe a heavier load off a set that just ground out; the
    // reactive path (reduce toward mid-range) takes over.
    const rec = recommendSet({
      lastWeightKg: 182.5,
      lastReps: 6,
      lastRir: 0,
      setsCompletedThisExercise: 1,
      ...fixtureCtx,
      positionContext: {
        prevSessionSets: JUL_21_SESSION,
        todaySets: [{ weightKg: 182.5, reps: 6 }],
        plannedSetCount: ISO_INCLINE_PLANNED_SETS,
      },
    });
    expect(rec.positionMatch).toBeUndefined();
    expect(rec.weightKg).toBeLessThan(192.5);
  });

  it('falls through when the last set was a clear miss and the match does not REDUCE the load (Codex review)', () => {
    // Today's set 1 collapsed: 182.5×3 @0 — below the floor AND past the
    // deadband. Last session's position 2 was at the same-ish load (182.5×8
    // via a same-load history) — replaying it would hand the problem to the
    // rep-trimming capacity clamp when the LOAD is what failed. The
    // too-heavy branch must own this: no position match, load reduced.
    const rec = recommendSet({
      lastWeightKg: 182.5,
      lastReps: 3,
      lastRir: 0,
      setsCompletedThisExercise: 1,
      ...fixtureCtx,
      positionContext: {
        prevSessionSets: [
          { weightKg: 182.5, reps: 8, rir: 2 },
          { weightKg: 182.5, reps: 8, rir: 1 },
          { weightKg: 182.5, reps: 7, rir: 1 },
          { weightKg: 182.5, reps: 7, rir: 0 },
        ],
        todaySets: [{ weightKg: 182.5, reps: 3 }],
        plannedSetCount: ISO_INCLINE_PLANNED_SETS,
      },
    });
    expect(rec.positionMatch).toBeUndefined();
    expect(rec.rationale).toBe('reduce_load');
    expect(rec.weightKg).toBeLessThan(182.5);
  });

  it('still allows a position match that genuinely reduces the load after a miss (fixture set 4)', () => {
    // The MISS B shape must survive the tightened guard: 195×6 @0 is a clear
    // miss, and the positional 182.5×7 REDUCES the load — allowed.
    const rec = recommendSet({
      lastWeightKg: JUL_27_SESSION[2].weightKg,
      lastReps: JUL_27_SESSION[2].reps,
      lastRir: JUL_27_SESSION[2].rir,
      setsCompletedThisExercise: 3,
      ...fixtureCtx,
      positionContext: positionContext(3),
    });
    expect(rec.positionMatch?.progression).toBe('hold');
    expect(rec.weightKg).toBe(182.5);
  });

  it('falls through when the last set proved objective under-load and the match holds or drops', () => {
    // Today's set 1 blew past the range by more than the overshoot proof
    // (15 > 12 + 2): the session is running far stronger than last time —
    // replaying last session's positional target would under-prescribe.
    const rec = recommendSet({
      lastWeightKg: 182.5,
      lastReps: 15,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      ...fixtureCtx,
      positionContext: {
        prevSessionSets: JUL_21_SESSION,
        todaySets: [{ weightKg: 182.5, reps: 15 }],
        plannedSetCount: ISO_INCLINE_PLANNED_SETS,
      },
    });
    expect(rec.positionMatch).toBeUndefined();
    expect(rec.rationale).toBe('increase_load');
  });

  it('is inert without a positionContext (existing behavior unchanged)', () => {
    const rec = recommendSet({
      lastWeightKg: JUL_27_SESSION[0].weightKg,
      lastReps: JUL_27_SESSION[0].reps,
      lastRir: JUL_27_SESSION[0].rir,
      setsCompletedThisExercise: 1,
      ...fixtureCtx,
    });
    expect(rec.positionMatch).toBeUndefined();
    expect(rec.weightKg).toBe(182.5); // legacy hold — the documented MISS A behavior
  });
});
