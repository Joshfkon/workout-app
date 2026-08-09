/**
 * Within-session reaction on rep_total exercises — the Abdominal Crunch
 * Machine regression.
 *
 * Live defect (docs/PRESCRIPTION_STALENESS_AUDIT.md): last session 3 × 10 @
 * 175 lb / 2 RIR; today the plan bumps to 180 lb × [9,9,9] = 27. Set 1 goes
 * 9 @ 2 RIR (on plan). Set 2 goes 7 @ 1 RIR — two reps short and a full rep
 * hotter than target. The prescription for set 3 came back 180 × 9 @ 2 RIR:
 * byte-identical to the set-2 prescription, as if set 2 had never happened.
 * The rest timer, meanwhile, DID react (+30 s, "ran hotter than target").
 *
 * It was never a staleness bug — `recommendRepTotalNextSet` received set 2,
 * read its reps and its RIR, and classified it 'harder'. The ask was
 * raise-only: a flat plan target, an evidence floor that is a Math.max, and
 * a capacity ceiling anchored to the session's BEST set (which set 1 held
 * up). Nothing in the chain could lower a number.
 *
 * These tests pin the two properties that fix required:
 *   1. a short/hot set must MOVE the next ask (and must not move the load —
 *      reps absorb fatigue, the load absorbs a wrong load);
 *   2. the rest timer and the prescription must grade one set the same way.
 */

import {
  recommendRepTotalSessionStart,
  recommendRepTotalNextSet,
  type RepTotalObservedSet,
} from '@/services/suggestionEngine/repTotalPolicy';
import { prescribeRestSeconds } from '@/services/restPrescription';
import { gradeEffort } from '@/services/suggestionEngine/effortGrade';

const LB = 0.45359237;
const lb = (n: number) => n * LB;
/** Round-trip kg → lb for readable assertions on an lb-entered load. */
const asLb = (kg: number) => Math.round((kg / LB) * 10) / 10;

const TARGET_RIR = 2;
const INCREMENTS = [lb(5)];

function crunchPlan(range: [number, number]) {
  return recommendRepTotalSessionStart({
    prevSessionSets: [10, 10, 10].map((reps) => ({ weightKg: lb(175), reps, rir: 2 })),
    targetRepRange: range,
    targetRir: TARGET_RIR,
    minIncrementKg: lb(5),
    availableIncrementsKg: INCREMENTS,
    plannedSets: 3,
  })!;
}

function nextAfter(range: [number, number], observedSets: RepTotalObservedSet[]) {
  return recommendRepTotalNextSet({
    sessionPlan: crunchPlan(range),
    observedSets,
    targetRepRange: range,
    targetRir: TARGET_RIR,
    minIncrementKg: lb(5),
    availableIncrementsKg: INCREMENTS,
  });
}

const SET_1: RepTotalObservedSet = { weightKg: lb(180), reps: 9, rir: 2 };
const SHORT_HOT_SET_2: RepTotalObservedSet = { weightKg: lb(180), reps: 7, rir: 1 };

describe('Abdominal Crunch Machine — a short, hot set must move the next ask', () => {
  // The reported session's range floor is at/below 7, so set 2's 7 reps did
  // not trip the below-floor load lever. Every such range reproduced the
  // defect identically before the fix.
  const RANGES: Array<[number, number]> = [
    [6, 10],
    [8, 12],
    [5, 10],
  ];

  it.each(RANGES)('range %i-%i: the session plan reproduces the reported 180 lb × 27', (min, max) => {
    const plan = crunchPlan([min, max]);
    expect(asLb(plan.weightKg)).toBe(180);
    expect(plan.perSetRepTargets).toEqual([9, 9, 9]);
    expect(plan.sessionRepTotalTarget).toBe(27);
    expect(plan.bumped).toBe(true);
  });

  it.each(RANGES)('range %i-%i: set 3 ≠ set 1 prescription after a short set 2', (min, max) => {
    const range: [number, number] = [min, max];

    // Set 1 logged on plan → the ask for set 2 is the reported 180 × 9.
    const forSet2 = nextAfter(range, [SET_1]);
    expect(asLb(forSet2.weightKg)).toBe(180);
    expect(forSet2.reps).toBe(9);

    // Set 2 comes in 2 reps short and a rep hotter than target.
    const forSet3 = nextAfter(range, [SET_1, SHORT_HOT_SET_2]);

    // THE REGRESSION: this is what shipped 180 × 9 twice in a row.
    expect(forSet3.reps).not.toBe(forSet2.reps);
    expect(forSet3.reps).toBeLessThan(forSet2.reps);

    // And it moved for the stated reason, not by accident.
    expect(forSet3.sessionDeclineTrimmed).toBe(true);
    expect(forSet3.effortVsTarget).toBe('harder');

    // The ask tracks what set 2 actually demonstrated: 7 reps with 1 left is
    // 8 in the tank, so 6 at the 2-RIR target — not 9.
    expect(forSet3.reps).toBe(6);
  });

  it('absorbs the decline in REPS at a HELD load, not with a mid-session deload', () => {
    // The brief's explicit ordering: drop reps, hold load. One weaker set is
    // not evidence that the LOAD is wrong — that lever stays gated on today's
    // best set failing to hold the range.
    const forSet3 = nextAfter([6, 10], [SET_1, SHORT_HOT_SET_2]);
    expect(asLb(forSet3.weightKg)).toBe(180);
    expect(forSet3.rationale).toBe('follow_plan');
  });

  it('does not trim a session that is holding steady', () => {
    // Guard against over-correction: three on-plan sets must keep asking the
    // plan's number. A fix that trimmed on every set would be a different bug.
    const steady = nextAfter([6, 10], [SET_1, { weightKg: lb(180), reps: 9, rir: 2 }]);
    expect(steady.reps).toBe(9);
    expect(steady.sessionDeclineTrimmed).toBeUndefined();
    expect(steady.effortVsTarget).toBe('on_target');
  });

  it('still RAISES the ask off a strong set — the evidence floor is intact', () => {
    // The fix makes the ask two-directional, not downward-only. A set that
    // beat its slot at reserve must still pull the next ask up.
    const strong = nextAfter([6, 10], [{ weightKg: lb(180), reps: 10, rir: 3 }]);
    expect(strong.reps).toBeGreaterThan(9);
    expect(strong.effortVsTarget).toBe('easier');
  });

  it('keeps the progress counter honest and independent of the ask', () => {
    // "16 of 27" was correct all along — it is a progress counter, and spec §2
    // forbids deriving the ask from the remainder (that would let a strong set
    // SHRINK later targets). The counter and the ask stay decoupled.
    const forSet3 = nextAfter([6, 10], [SET_1, SHORT_HOT_SET_2]);
    expect(forSet3.totalSoFar).toBe(16);
    expect(forSet3.sessionRepTotalTarget).toBe(27);
    expect(forSet3.remainingToTarget).toBe(11);
    // The ask is emphatically NOT the remainder, nor the remainder split
    // across the one remaining set.
    expect(forSet3.reps).not.toBe(11);
  });
});

describe('one set, one verdict — rest timer and prescription grade identically', () => {
  // The defect's most misleading symptom: the rest bar announced "+30s — last
  // set ran hotter than target" while the banner said nothing, which reads as
  // "the set never reached the engine". Both consumers now grade through the
  // same `gradeEffort` reading, so they cannot describe one set two ways.

  const CASES: Array<{ name: string; rir: number; target: number }> = [
    { name: 'the reported set 2 (1 RIR vs 2)', rir: 1, target: 2 },
    { name: 'on target', rir: 2, target: 2 },
    { name: 'easier than target', rir: 4, target: 2 },
    { name: 'at failure', rir: 0, target: 2 },
    { name: 'hot against a 0-RIR target', rir: 0, target: 0 },
    { name: 'hot against a 3-RIR target', rir: 1, target: 3 },
  ];

  it.each(CASES)('$name: the timer only extends when the shared grade says hotter', ({ rir, target }) => {
    const grade = gradeEffort(rir, target)!;
    const rest = prescribeRestSeconds({ baseSeconds: 180, lastSetRir: rir, targetRir: target });

    // The timer's extension is exactly the shared grade's `hotterThanTarget`,
    // never an independently re-derived comparison.
    expect(rest.adjustmentSeconds > 0).toBe(grade.hotterThanTarget);
    if (grade.pastDeadband) expect(rest.adjustmentSeconds).toBe(60);
    else if (grade.hotterThanTarget) expect(rest.adjustmentSeconds).toBe(30);
  });

  it.each(CASES)('$name: the prescription reports the same verdict as the shared grade', ({ rir, target }) => {
    const grade = gradeEffort(rir, target)!;
    const range: [number, number] = [6, 10];
    const next = recommendRepTotalNextSet({
      sessionPlan: crunchPlan(range),
      observedSets: [SET_1, { weightKg: lb(180), reps: 8, rir }],
      targetRepRange: range,
      targetRir: target,
      minIncrementKg: lb(5),
      availableIncrementsKg: INCREMENTS,
    });
    expect(next.effortVsTarget).toBe(grade.vsTarget);
  });

  it('the reported set 2 makes BOTH consumers react — not just the timer', () => {
    // The whole complaint in one assertion.
    const rest = prescribeRestSeconds({ baseSeconds: 180, lastSetRir: 1, targetRir: TARGET_RIR });
    const forSet2 = nextAfter([6, 10], [SET_1]);
    const forSet3 = nextAfter([6, 10], [SET_1, SHORT_HOT_SET_2]);

    expect(rest.adjustmentSeconds).toBe(30);
    expect(rest.note).toContain('hotter than target');
    expect(forSet3.effortVsTarget).toBe('harder');
    expect(forSet3.reps).toBeLessThan(forSet2.reps);
  });

  it('an unrated set is graded as NO signal, never as on-target', () => {
    // The silent fallback that would let an unrated set pass for evidence of
    // reserve. `gradeEffort` returns null; the timer declines to modulate.
    expect(gradeEffort(undefined, 2)).toBeNull();
    expect(prescribeRestSeconds({ baseSeconds: 180, targetRir: 2 }).adjustmentSeconds).toBe(0);
  });
});
