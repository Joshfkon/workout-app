/**
 * UX panel round 22 (Dre, advanced natural bodybuilder on a cut, Upper/Lower
 * ×4, 75-minute sessions): "Back, quads, hamstrings, calves and traps sit at
 * or below MEV" and "in the deload week, quad and hamstring sets stay at 6
 * while the other muscles drop". Three causes:
 *  1. advanced + cut got block periodization (110 → 80 → 60% of the sets, a
 *     strength peak), so weeks 3–4 sat under MEV and the deload matched W4;
 *  2. the direct-volume second pass subtracted indirect credit from
 *     first-pass exercises it then didn't pick (RDL → hack squat + leg curl);
 *  3. the indirect-aware trim measures in the uncapped projection, so it
 *     trimmed back to 9 tracked sets (MEV 10) believing it sat at 13.
 */
import { generateFullMesocycleWithFatigue, creditedSetsByGroup } from '@/services/sessionBuilderWithFatigue';
import { buildPeriodizationPlan, calculateRecoveryFactors, effectiveTrainingAge } from '@/services/mesocycleBuilder';
import { getEffectiveBand, type CoarseMuscle } from '@/services/volumeBands';
import type { Equipment, ExtendedUserProfile, Rating } from '@/types/schema';

const dre: ExtendedUserProfile = {
  goal: 'cut',
  experience: 'advanced',
  heightCm: 178,
  latestDexa: null,
  age: 31,
  sleepQuality: 3 as Rating,
  stressLevel: 3 as Rating,
  trainingAge: effectiveTrainingAge(0, 'advanced'),
  availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'] as Equipment[],
  injuryHistory: [],
};

describe('advanced lifter on a cut (Dre)', () => {
  it('accumulates (linear ramp) instead of a strength peak', () => {
    const plan = buildPeriodizationPlan(dre, calculateRecoveryFactors(dre), 5);
    expect(plan.model).toBe('linear');
    const mods = plan.weeklyProgression.slice(0, 4).map((w) => w.volumeModifier);
    expect([...mods].sort((a, b) => a - b)).toEqual(mods);
  });

  const program = generateFullMesocycleWithFatigue(4, dre, 75, [], [], 1, 5, [], 'Upper/Lower', {
    startingVolume: 'standard',
  });
  const weeks = program.mesocycleWeeks!;
  const planned: CoarseMuscle[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'traps'];

  it('holds every planned muscle at MEV or above as the review counts it (week 1 may open a set under)', () => {
    const training = weeks.filter((w) => !w.isDeload);
    for (const week of training) {
      const credited = creditedSetsByGroup(week.sessions);
      // Week 1 opens near MEV by design and ramps from there.
      const slack = week === training[0] ? 1 : 0;
      for (const muscle of planned) {
        const mev = getEffectiveBand(muscle)!.mev;
        if ((credited[muscle] ?? 0) < mev - slack) {
          throw new Error(`${muscle} at ${credited[muscle] ?? 0} (MEV ${mev}) in week ${week.weekNumber}`);
        }
      }
    }
  });

  it('cuts every muscle in the deload', () => {
    const deload = creditedSetsByGroup(weeks.find((w) => w.isDeload)!.sessions);
    for (const muscle of planned) {
      const peak = Math.max(...weeks.filter((w) => !w.isDeload).map((w) => creditedSetsByGroup(w.sessions)[muscle] ?? 0));
      expect(deload[muscle] ?? 0).toBeLessThan(peak);
    }
  });
});
