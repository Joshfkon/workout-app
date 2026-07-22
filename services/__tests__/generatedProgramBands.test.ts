/**
 * Generated-program band gate, parametrized across recovery profile
 * (residuals pass): for Full Body 3d / Upper-Lower 4d / PPL 6d, in BOTH
 * profiles —
 *   - no coarse group's CREDITED weekly total (direct + 0.5-secondary, the
 *     currency every tracking surface counts in) exceeds that profile's
 *     EFFECTIVE band MRV → the card can never render over-MRV for a program
 *     the engine generated inside the user's own band;
 *   - side delts (zero indirect inflow in every template) hold their
 *     child-MEV direct floor;
 *   - chest reaches its MEV on Full Body 3d (the template previously carried
 *     chest on one of three days against a ÷3 quota → 5 weekly sets);
 *   - traps reaches its MEV on credited terms (previously absent from
 *     planning entirely).
 */

import { generateFullProgram } from '../mesocycleBuilder';
import { resolvePrimaryMuscleCredits, SECONDARY_MUSCLE_CREDIT } from '../volumeTracker';
import { resolveMuscleToStandard } from '@/types/schema';
import {
  STANDARD_TO_COARSE,
  COARSE_MUSCLES,
  getEffectiveBand,
  type CoarseMuscle,
  type RecoveryProfile,
} from '../volumeBands';
import type { ExtendedUserProfile, Rating } from '@/types/schema';

function profileFor(enhanced: boolean): ExtendedUserProfile {
  return {
    goal: 'bulk',
    experience: 'intermediate',
    heightCm: 175,
    latestDexa: null,
    age: 30,
    sleepQuality: 3 as Rating,
    stressLevel: 3 as Rating,
    trainingAge: 2,
    availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'],
    injuryHistory: [],
    enhancedAthleteMode: enhanced,
  };
}

function creditedTotals(enhanced: boolean, days: number) {
  const program = generateFullProgram(days, profileFor(enhanced), 60);
  const byGroup = new Map<CoarseMuscle, number>();
  const fineDirect = new Map<string, number>();
  const add = (m: Map<CoarseMuscle, number>, k: CoarseMuscle | undefined, v: number) => {
    if (k) m.set(k, (m.get(k) ?? 0) + v);
  };
  for (const session of program.sessions) {
    for (const ex of session.exercises) {
      const primaryCredits = resolvePrimaryMuscleCredits(ex.exercise.primaryMuscle);
      const primarySet = new Set(primaryCredits.map((c) => c.muscle));
      for (const { muscle, weight } of primaryCredits) {
        add(byGroup, STANDARD_TO_COARSE[muscle], ex.sets * weight);
        fineDirect.set(muscle, (fineDirect.get(muscle) ?? 0) + ex.sets * weight);
      }
      for (const secondary of ex.exercise.secondaryMuscles ?? []) {
        const standards = resolveMuscleToStandard(secondary);
        if (standards.length === 0) continue;
        const per = SECONDARY_MUSCLE_CREDIT / standards.length;
        for (const std of standards) {
          if (primarySet.has(std)) continue;
          add(byGroup, STANDARD_TO_COARSE[std], ex.sets * per);
        }
      }
    }
  }
  return { byGroup, fineDirect };
}

describe.each([['standard'], ['enhanced']] as [RecoveryProfile][])(
  'profile: %s',
  (recoveryProfile) => {
    const enhanced = recoveryProfile === 'enhanced';

    describe.each([[3], [4], [6]])('%sd template', (days) => {
      const { byGroup, fineDirect } = creditedTotals(enhanced, days);

      it('no coarse group exceeds the effective band MRV', () => {
        const over = COARSE_MUSCLES.filter(
          (g) => (byGroup.get(g) ?? 0) > getEffectiveBand(g, { recoveryProfile }).mrv + 1e-9
        );
        expect(over).toEqual([]);
      });

      it('side delts hold their direct child-MEV floor (zero indirect in every template)', () => {
        expect(fineDirect.get('lateral_delts') ?? 0).toBeGreaterThanOrEqual(6);
      });

      it('chest and traps sit at/above their MEVs on credited terms', () => {
        expect(byGroup.get('chest') ?? 0).toBeGreaterThanOrEqual(
          getEffectiveBand('chest', { recoveryProfile }).mev
        );
        expect(byGroup.get('traps') ?? 0).toBeGreaterThanOrEqual(
          getEffectiveBand('traps', { recoveryProfile }).mev
        );
      });

      it('fixture sanity: the program is non-trivial', () => {
        expect(Array.from(byGroup.values()).filter((v) => v > 0).length).toBeGreaterThan(5);
      });
    });
  }
);
