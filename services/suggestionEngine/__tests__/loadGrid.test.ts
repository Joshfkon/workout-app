/**
 * Phase D — loading grid (available increment SET, never-round-down rule,
 * no-meaningful-change signal). See services/suggestionEngine/loadGrid.ts.
 *
 * Reference failure (Iso-Lateral Incline Press fixture): a 10 lb stack
 * machine loaded with 2.5 lb add-ons. With only the stack step recorded, a
 * 187.5 prescription was floored back to 182.5 — an intended increase
 * rendered as last session's load, twice in one session.
 */

import {
  smallestIncrement,
  smallestKnownIncrement,
  roundPrescribedLoad,
  DEFAULT_INCREMENT_KG,
} from '../loadGrid';
import { recommendSet, recommendSessionStart, matchPositionTarget } from '../../setRecommender';
import {
  JUL_21_SESSION,
  ISO_INCLINE_TARGET_REP_RANGE,
  ISO_INCLINE_TARGET_RIR,
  ISO_INCLINE_AVAILABLE_INCREMENTS,
  ISO_INCLINE_STACK_INCREMENT,
  ISO_INCLINE_PLANNED_SETS,
} from '../../__tests__/fixtures/isoLateralInclinePress';

describe('smallestIncrement', () => {
  it('takes the minimum of the available set (stack + add-ons → add-on)', () => {
    expect(smallestIncrement([10, 2.5])).toBe(2.5);
  });
  it('falls back to the legacy single increment when no set is recorded', () => {
    expect(smallestIncrement(undefined, 4.54)).toBe(4.54);
    expect(smallestIncrement([], 4.54)).toBe(4.54);
  });
  it('falls back to the engine default when nothing is recorded', () => {
    expect(smallestIncrement()).toBe(DEFAULT_INCREMENT_KG);
  });
  it('ignores malformed entries instead of throwing', () => {
    expect(smallestIncrement([0, -5, NaN, 2.5, 10])).toBe(2.5);
    expect(smallestIncrement([0, NaN], 4.54)).toBe(4.54);
  });
});

describe('smallestKnownIncrement', () => {
  it('never guesses: undefined when nothing is recorded', () => {
    expect(smallestKnownIncrement()).toBeUndefined();
    expect(smallestKnownIncrement([], 0)).toBeUndefined();
  });
  it('prefers the increment set over the legacy value', () => {
    expect(smallestKnownIncrement([10, 2.5], 10)).toBe(2.5);
  });
});

describe('roundPrescribedLoad — never round an intended change onto the reference', () => {
  const grid = { availableIncrementsKg: ISO_INCLINE_AVAILABLE_INCREMENTS };

  it('MISS B floor bug: 187.5 off a 182.5 reference stays 187.5 on the add-on grid', () => {
    const r = roundPrescribedLoad(187.5, { ...grid, referenceKg: 182.5 });
    expect(r).toEqual({ weightKg: 187.5, noMeaningfulChange: false, forcedOffReference: false });
  });

  it('stack-only grid: an intended increase must round UP off the reference, never onto it', () => {
    // Same raw prescription with only the 10-step recorded: 187.5 rounds to
    // 190 on the 10-grid — but if rounding ever lands at/below the 182.5
    // reference, rule 2 forces one step up instead. Either way, never 182.5.
    const r = roundPrescribedLoad(187.5, {
      minIncrementKg: ISO_INCLINE_STACK_INCREMENT,
      referenceKg: 182.5,
    });
    expect(r.weightKg).toBeGreaterThan(182.5);
  });

  it('a sub-half-step "increase" is the no-op case, not a fabricated jump', () => {
    // Raw 44 off a 42 reference on a 10-grid: plain rounding would land at 40
    // — BELOW the reference the engine intended to increase from. The half-
    // increment rule catches it first: hold 42 verbatim and say no meaningful
    // change is available at this increment.
    const r = roundPrescribedLoad(44, { minIncrementKg: 10, referenceKg: 42 });
    expect(r).toEqual({ weightKg: 42, noMeaningfulChange: true, forcedOffReference: false });
  });

  it('property: an intended change of at least half a step NEVER renders as the reference', () => {
    // Sweep raw values ≥ step/2 away from off-grid and on-grid references in
    // both directions: the result must always sit strictly on the intended
    // side of the reference (rules 2+3 together make this an invariant).
    const step = 10;
    for (const referenceKg of [42, 48, 40, 182.5]) {
      for (let delta = step / 2; delta <= step * 1.5; delta += 0.7) {
        const up = roundPrescribedLoad(referenceKg + delta, { minIncrementKg: step, referenceKg });
        expect(up.weightKg).toBeGreaterThan(referenceKg);
        const down = roundPrescribedLoad(referenceKg - delta, { minIncrementKg: step, referenceKg });
        expect(down.weightKg).toBeLessThan(referenceKg);
      }
    }
  });

  it('flags no-meaningful-change within half an increment and holds the reference VERBATIM', () => {
    const r = roundPrescribedLoad(183.4, { ...grid, referenceKg: 182.5 });
    expect(r).toEqual({ weightKg: 182.5, noMeaningfulChange: true, forcedOffReference: false });
  });

  it('rounds plainly with no reference (cold start)', () => {
    expect(roundPrescribedLoad(187.4, grid).weightKg).toBe(187.5);
  });
});

describe('engine integration — the fixture machine with its real grid', () => {
  const ctx = {
    targetRepRange: ISO_INCLINE_TARGET_REP_RANGE,
    targetRir: ISO_INCLINE_TARGET_RIR,
    minIncrementKg: ISO_INCLINE_STACK_INCREMENT,
    availableIncrementsKg: ISO_INCLINE_AVAILABLE_INCREMENTS,
  } as const;

  it('an earned session-start bump steps by the add-on, never a full stack jump forced by rounding', () => {
    // Previous session met the prescription at 182.5×12 @2 → bump earned.
    // e1RM = 182.5·(1+14/30) = 267.7; ideal for 12 @2 = 182.5·1.4667/1.4667…
    // capped at +10% = 200.75; grid rounds within the add-on step — and must
    // land strictly above 182.5.
    const rec = recommendSessionStart({
      prevWeightKg: 182.5,
      prevReps: 12,
      prevRir: 2,
      ...ctx,
      prevSessionSets: [
        { weightKg: 182.5, reps: 12, rir: 2 },
        { weightKg: 182.5, reps: 11, rir: 1 },
      ],
    });
    expect(rec.rationale).toBe('increase_load');
    expect(rec.weightKg).toBeGreaterThan(182.5);
    // On the 2.5 grid: a real curve-derived value, not a coarse 192.5 forced
    // by a 10-only grid.
    expect(rec.weightKg % 2.5).toBe(0);
  });

  it('position-match add_load steps by the smallest available increment (2.5, not the 10 stack)', () => {
    const t = matchPositionTarget({
      position: 0,
      prevSessionSets: [
        { weightKg: 192.5, reps: 12, rir: 2 },
        { weightKg: 192.5, reps: 10, rir: 1 },
        { weightKg: 192.5, reps: 9, rir: 1 },
        { weightKg: 182.5, reps: 9, rir: 1 },
      ],
      todaySets: [],
      plannedSetCount: ISO_INCLINE_PLANNED_SETS,
      targetRepRange: ISO_INCLINE_TARGET_REP_RANGE,
      targetRir: ISO_INCLINE_TARGET_RIR,
      minIncrementKg: ISO_INCLINE_STACK_INCREMENT,
      availableIncrementsKg: ISO_INCLINE_AVAILABLE_INCREMENTS,
    });
    expect(t).toEqual(
      expect.objectContaining({ weightKg: 195, progression: 'add_load' })
    );
  });

  it('within-session: a sub-half-increment adjustment is a flagged hold, not a fabricated jump', () => {
    // Coarse grid (10-only, no add-ons): a clear-the-range set whose curve
    // bump is tiny must hold WITH the no-meaningful-change flag instead of
    // fabricating a full 10 jump the curve doesn't support.
    const rec = recommendSet({
      lastWeightKg: 100,
      lastReps: 12,
      lastRir: 4,
      setsCompletedThisExercise: 1,
      // Session-best pins the curve: ideal for 12 @2 ≈ e1rm/1.4667. With
      // e1rm = 153.3 (the last set's own Epley), ideal ≈ 104.5 — within half
      // of the 10 increment above 100.
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 10,
    });
    expect(rec.rationale).toBe('maintain');
    expect(rec.noMeaningfulChange).toBe(true);
    expect(rec.weightKg).toBe(100);
  });

  it('within-session: the same set with add-ons available gets its real increase', () => {
    const rec = recommendSet({
      lastWeightKg: 100,
      lastReps: 12,
      lastRir: 4,
      setsCompletedThisExercise: 1,
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 10,
      availableIncrementsKg: [10, 2.5],
    });
    expect(rec.rationale).toBe('increase_load');
    expect(rec.weightKg).toBeGreaterThan(100);
    expect(rec.weightKg % 2.5).toBe(0);
    expect(rec.noMeaningfulChange).toBeUndefined();
  });

  it('regression fixture is unaffected by the grid change (position-matched holds are grid-independent)', () => {
    const t = matchPositionTarget({
      position: 3,
      prevSessionSets: JUL_21_SESSION,
      todaySets: [],
      plannedSetCount: ISO_INCLINE_PLANNED_SETS,
      targetRepRange: ISO_INCLINE_TARGET_REP_RANGE,
      targetRir: ISO_INCLINE_TARGET_RIR,
      minIncrementKg: ISO_INCLINE_STACK_INCREMENT,
      availableIncrementsKg: ISO_INCLINE_AVAILABLE_INCREMENTS,
    });
    expect(t).toEqual(expect.objectContaining({ weightKg: 182.5, reps: 7, progression: 'hold' }));
  });
});
