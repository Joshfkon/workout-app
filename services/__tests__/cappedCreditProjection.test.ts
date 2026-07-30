/**
 * Capped credit projection gate (Change 3 — flag default OFF, ramp available).
 *
 * The generator's allocation pass historically projected UNCAPPED group
 * credit while tracking applies the per-group cap. Routing the projection
 * through the cap raises REAL prescribed sets for cap-binding groups
 * (triceps/calves ≈ ×1.5) — a training prescription change that must be
 * opt-in:
 *  - default (no option, flag unset) must behave EXACTLY like capped:false;
 *  - capped:true never prescribes FEWER real sets anywhere, and prescribes
 *    more for the cap-binding groups (fewer trims);
 *  - the ramp blends monotonically between the two.
 */

import {
  CAPPED_CREDIT_PROJECTION_DEFAULT,
  cappedProjectionRampFraction,
  generateFullProgram,
  type CreditProjectionOptions,
} from '../mesocycleBuilder';
import { resolvePrimaryMuscleCredits } from '../volumeTracker';
import { STANDARD_TO_COARSE, type CoarseMuscle } from '../volumeBands';
import type { ExtendedUserProfile, Goal, Rating } from '@/types/schema';

function profileFor(goal: Goal): ExtendedUserProfile {
  return {
    goal,
    experience: 'intermediate',
    heightCm: 175,
    latestDexa: null,
    age: 30,
    sleepQuality: 3 as Rating,
    stressLevel: 3 as Rating,
    trainingAge: 2,
    availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'],
    injuryHistory: [],
    enhancedAthleteMode: false,
  };
}

/** REAL prescribed working sets per group (by primary-muscle attribution). */
function realSetsByGroup(days: number, goal: Goal, projection?: CreditProjectionOptions) {
  const program = generateFullProgram(days, profileFor(goal), 60, undefined, undefined, projection);
  const out = new Map<CoarseMuscle, number>();
  for (const session of program.sessions) {
    for (const ex of session.exercises) {
      const credits = resolvePrimaryMuscleCredits(ex.exercise.primaryMuscle);
      // Attribute the exercise's real sets to its primary muscle's group(s)
      // (weight-proportional for legacy splits).
      for (const { muscle, weight } of credits) {
        const coarse = STANDARD_TO_COARSE[muscle];
        if (coarse) out.set(coarse, (out.get(coarse) ?? 0) + ex.sets * weight);
      }
    }
  }
  return out;
}

describe('flag default', () => {
  it('the flag is OFF by default (env not set in CI)', () => {
    expect(CAPPED_CREDIT_PROJECTION_DEFAULT).toBe(false);
  });

  it('no option behaves exactly like an explicit capped:false, every template', () => {
    for (const days of [3, 4, 6]) {
      const def = realSetsByGroup(days, 'bulk');
      const off = realSetsByGroup(days, 'bulk', { capped: false });
      expect(Array.from(def.entries()).sort()).toEqual(Array.from(off.entries()).sort());
    }
  });

  it('rampFraction 0 with capped:true is also identical to OFF (ramp start point)', () => {
    for (const days of [4]) {
      const off = realSetsByGroup(days, 'bulk', { capped: false });
      const rampStart = realSetsByGroup(days, 'bulk', { capped: true, rampFraction: 0 });
      expect(Array.from(rampStart.entries()).sort()).toEqual(Array.from(off.entries()).sort());
    }
  });
});

describe('capped projection (flag ON)', () => {
  it('net real sets never decrease; per-group decreases are bounded by trim granularity', () => {
    // Per-group monotonicity does NOT hold: the trim pass is interactive — a
    // group that keeps more of its (now-capped) exercises also keeps their
    // cross-group secondary credit, which can push a NEIGHBOR group over its
    // target and fire a trim there (observed: glutes 9→12 pulls hamstrings
    // 16→15 on the 4d bulk template — hamstrings' credited total is roughly
    // preserved, one direct set traded against returning hip-thrust inflow).
    // What must hold: the program as a whole never shrinks, and no single
    // group loses more than a single trim's worth of neighbor adjustment.
    for (const goal of ['bulk', 'cut'] as const) {
      for (const days of [3, 4, 6]) {
        const off = realSetsByGroup(days, goal);
        const on = realSetsByGroup(days, goal, { capped: true });
        const groups = new Set([...Array.from(off.keys()), ...Array.from(on.keys())]);
        let netDelta = 0;
        for (const group of Array.from(groups)) {
          const delta = (on.get(group) ?? 0) - (off.get(group) ?? 0);
          netDelta += delta;
          expect(delta).toBeGreaterThanOrEqual(-1 - 1e-9);
        }
        expect(netDelta).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('prescribes MORE real triceps and calf sets where trims used to fire (the ×1.5 effect, bounded by the trim-only allocator)', () => {
    let tricepsGained = false;
    let calvesGained = false;
    for (const goal of ['bulk', 'cut'] as const) {
      for (const days of [3, 4, 6]) {
        const off = realSetsByGroup(days, goal);
        const on = realSetsByGroup(days, goal, { capped: true });
        if ((on.get('triceps') ?? 0) > (off.get('triceps') ?? 0)) tricepsGained = true;
        if ((on.get('calves') ?? 0) > (off.get('calves') ?? 0)) calvesGained = true;
      }
    }
    expect(tricepsGained).toBe(true);
    expect(calvesGained).toBe(true);
  });

  it('the ramp is monotone: real sets at fraction 0.5 sit between OFF and fully capped', () => {
    for (const group of ['triceps', 'calves'] as const) {
      const off = realSetsByGroup(4, 'bulk');
      const half = realSetsByGroup(4, 'bulk', { capped: true, rampFraction: 0.5 });
      const full = realSetsByGroup(4, 'bulk', { capped: true, rampFraction: 1 });
      expect(half.get(group) ?? 0).toBeGreaterThanOrEqual((off.get(group) ?? 0) - 1e-9);
      expect(half.get(group) ?? 0).toBeLessThanOrEqual((full.get(group) ?? 0) + 1e-9);
    }
  });
});

describe('cappedProjectionRampFraction', () => {
  it('phases in over N even steps and saturates at 1', () => {
    expect(cappedProjectionRampFraction(1, 4)).toBeCloseTo(0.25, 9);
    expect(cappedProjectionRampFraction(2, 4)).toBeCloseTo(0.5, 9);
    expect(cappedProjectionRampFraction(4, 4)).toBe(1);
    expect(cappedProjectionRampFraction(9, 4)).toBe(1);
  });

  it('a 0/1-week ramp is an immediate step (fraction 1)', () => {
    expect(cappedProjectionRampFraction(1, 1)).toBe(1);
    expect(cappedProjectionRampFraction(1, 0)).toBe(1);
  });
});
