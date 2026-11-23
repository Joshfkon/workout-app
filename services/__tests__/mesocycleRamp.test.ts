/**
 * The accumulation ramp never takes sets away (UX panel round 19: an
 * advanced bodybuilder's chest went 11 → 9 → 9 → 8 across a block labelled
 * "climbs to 100%"). Cause: the per-session fatigue budget was checked at
 * each week's own RIR, so as RIR fell the same session held fewer sets.
 */
import {
  enforceNonDecreasingRamp,
  generateFullMesocycleWithFatigue,
  creditedSetsByGroup,
  FATIGUE_GATE_RIR,
  sessionMuscleCeiling,
  MAX_SETS_PER_MUSCLE_PER_SESSION,
} from '@/services/sessionBuilderWithFatigue';
import {
  buildPeriodizationPlan,
  calculateRecoveryFactors,
  effectiveTrainingAge,
} from '@/services/mesocycleBuilder';
import type { Equipment, Experience, ExtendedUserProfile, Goal, Rating, Split } from '@/types/schema';

function profile(experience: Experience, goal: Goal, trainingAge: number): ExtendedUserProfile {
  return {
    goal,
    experience,
    heightCm: 180,
    latestDexa: null,
    age: 29,
    sleepQuality: 3 as Rating,
    stressLevel: 3 as Rating,
    trainingAge,
    availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'] as Equipment[],
    injuryHistory: [],
  };
}

const SPLITS: [Split, number][] = [
  ['Full Body', 3],
  ['Upper/Lower', 4],
  ['PPL', 6],
  ['Arnold', 3],
  ['Bro Split', 5],
];

const PROFILES: [Experience, Goal][] = [
  ['novice', 'bulk'],
  ['intermediate', 'bulk'],
  ['intermediate', 'maintenance'],
  ['advanced', 'bulk'],
  ['advanced', 'cut'],
  ['advanced', 'recomp'],
];

describe('accumulation ramp: per-muscle sets never fall while the volume share climbs', () => {
  for (const [experience, goal] of PROFILES) {
    for (const [split, days] of SPLITS) {
      for (const minutes of [45, 60, 90]) {
        it(`${experience} ${goal}, ${split} ×${days}, ${minutes} min`, () => {
          const p = profile(experience, goal, effectiveTrainingAge(0, experience));
          const program = generateFullMesocycleWithFatigue(days, p, minutes, [], [], 1, 5, [], split);
          const weeks = program.mesocycleWeeks!;
          const training = weeks.filter((w) => !w.isDeload);
          for (let k = 0; k + 1 < training.length; k++) {
            if (training[k].volumeModifier > training[k + 1].volumeModifier) continue; // a planned step down
            const a = creditedSetsByGroup(training[k].sessions);
            const b = creditedSetsByGroup(training[k + 1].sessions);
            for (const muscle of Object.keys(a) as (keyof typeof a)[]) {
              if ((b[muscle] ?? 0) + 1e-6 < (a[muscle] ?? 0)) {
                throw new Error(`${muscle} fell from ${a[muscle]} in week ${k + 1} to ${b[muscle] ?? 0} in week ${k + 2}`);
              }
            }
          }
          // The deload holds less than the block's biggest week.
          const total = (r: Record<string, number | undefined>) => Object.values(r).reduce<number>((s, v) => s + (v ?? 0), 0);
          const deload = weeks.find((w) => w.isDeload)!;
          const biggest = Math.max(...training.map((w) => total(creditedSetsByGroup(w.sessions))));
          expect(total(creditedSetsByGroup(deload.sessions))).toBeLessThan(biggest);
        });
      }
    }
  }
});

describe('Vince: advanced off-season bodybuilder, Bro Split ×5', () => {
  // users.training_age is 0 (never set) for him; the builder derives it.
  const vince = profile('advanced', 'bulk', effectiveTrainingAge(0, 'advanced'));

  it('accumulates (linear ramp), with no "under a year" volume cut', () => {
    const rf = calculateRecoveryFactors(vince);
    expect(rf.volumeReasons ?? []).not.toContain('under a year of training ×0.85');
    expect(rf.volumeMultiplier).toBe(1);
    const plan = buildPeriodizationPlan(vince, rf, 5);
    expect(plan.model).toBe('linear');
    const mods = plan.weeklyProgression.slice(0, 4).map((w) => w.volumeModifier);
    expect([...mods].sort((x, y) => x - y)).toEqual(mods);
  });

  it.each([60, 75])('chest and hamstrings do not fall W1 → W4 at %i min', (minutes) => {
    const program = generateFullMesocycleWithFatigue(5, vince, minutes, [], [], 1, 5, [], 'Bro Split');
    const sets = program.mesocycleWeeks!.map((w) => creditedSetsByGroup(w.sessions));
    for (const muscle of ['chest', 'hamstrings', 'back', 'quads'] as const) {
      for (let k = 0; k < 3; k++) expect(sets[k + 1][muscle] ?? 0).toBeGreaterThanOrEqual(sets[k][muscle] ?? 0);
    }
  });

  it('checks the fatigue budget at a fixed effort', () => {
    expect(FATIGUE_GATE_RIR).toBe(3);
  });
});

describe('enforceNonDecreasingRamp', () => {
  const ex = (primaryMuscle: string, sets: number, secondaryMuscles: string[] = []) => ({
    exercise: { primaryMuscle, secondaryMuscles },
    sets,
  });

  it('trims an earlier week down to the next week where the share climbs', () => {
    const weeks = [
      { isDeload: false, volumeModifier: 0.9, sessions: [{ exercises: [ex('chest', 4), ex('chest', 4), ex('chest', 3)] }] },
      { isDeload: false, volumeModifier: 1, sessions: [{ exercises: [ex('chest', 3), ex('chest', 3), ex('chest', 3)] }] },
      { isDeload: true, volumeModifier: 0.5, sessions: [{ exercises: [ex('chest', 2)] }] },
    ];
    expect(enforceNonDecreasingRamp(weeks)).toBe(2);
    expect(creditedSetsByGroup(weeks[0].sessions).chest).toBe(9);
    expect(creditedSetsByGroup(weeks[2].sessions).chest).toBe(2); // deload untouched
  });

  it('leaves a planned step down (block, weekly undulating) alone', () => {
    const weeks = [
      { isDeload: false, volumeModifier: 1.1, sessions: [{ exercises: [ex('quads', 12)] }] },
      { isDeload: false, volumeModifier: 0.8, sessions: [{ exercises: [ex('quads', 8)] }] },
    ];
    expect(enforceNonDecreasingRamp(weeks)).toBe(0);
    expect(weeks[0].sessions[0].exercises[0].sets).toBe(12);
  });

  it('removes an exercise it empties', () => {
    const weeks = [
      { isDeload: false, volumeModifier: 0.9, sessions: [{ exercises: [ex('biceps', 1), ex('chest', 3)] }] },
      { isDeload: false, volumeModifier: 1, sessions: [{ exercises: [ex('chest', 3)] }] },
    ];
    enforceNonDecreasingRamp(weeks);
    expect(weeks[0].sessions[0].exercises.map((e) => e.exercise.primaryMuscle)).toEqual(['chest']);
  });
});

describe('effectiveTrainingAge', () => {
  it('keeps a stored value', () => {
    expect(effectiveTrainingAge(11, 'advanced')).toBe(11);
    expect(effectiveTrainingAge(0.5, 'intermediate')).toBe(0.5);
  });

  it('reads 0 / null (the column default, never set) from experience', () => {
    expect(effectiveTrainingAge(0, 'advanced')).toBe(5);
    expect(effectiveTrainingAge(null, 'intermediate')).toBe(2);
    expect(effectiveTrainingAge(undefined, 'novice')).toBe(0.5);
  });

  it('keeps a novice under the one-year line and lifts the others off it', () => {
    const reasons = (e: Experience) =>
      calculateRecoveryFactors(profile(e, 'bulk', effectiveTrainingAge(0, e))).volumeReasons ?? [];
    expect(reasons('novice')).toContain('under a year of training ×0.85');
    expect(reasons('intermediate')).not.toContain('under a year of training ×0.85');
    expect(reasons('advanced')).not.toContain('under a year of training ×0.85');
  });
});

describe('the ramp adds sets you can see (UX panel round 19: "only RIR changes")', () => {
  it('a linear block opens at 75% of the weekly target and reaches 100% in its last accumulation week', () => {
    const p = profile('advanced', 'bulk', effectiveTrainingAge(0, 'advanced'));
    const plan = buildPeriodizationPlan(p, calculateRecoveryFactors(p), 5);
    expect(plan.model).toBe('linear');
    const training = plan.weeklyProgression.slice(0, plan.mesocycleWeeks - 1);
    expect(training[0].volumeModifier).toBeCloseTo(0.75);
    expect(training[training.length - 1].volumeModifier).toBeCloseTo(1);
  });

  it('the per-session muscle ceiling scales with the week, full at the peak', () => {
    expect(sessionMuscleCeiling(1)).toBe(MAX_SETS_PER_MUSCLE_PER_SESSION);
    expect(sessionMuscleCeiling(0.75)).toBe(9);
    expect(sessionMuscleCeiling(0)).toBeGreaterThanOrEqual(2);
  });

  for (const [split, days] of [['Bro Split', 5], ['PPL', 6], ['Upper/Lower', 4]] as [Split, number][]) {
    it(`advanced bulk ${split} ×${days}, 75 min: most muscles gain sets from week 1 to the peak`, () => {
      const p = profile('advanced', 'bulk', effectiveTrainingAge(0, 'advanced'));
      const weeks = generateFullMesocycleWithFatigue(days, p, 75, [], [], 1, 5, [], split).mesocycleWeeks!;
      const training = weeks.filter((w) => !w.isDeload);
      const first = creditedSetsByGroup(training[0].sessions);
      const peak = creditedSetsByGroup(training[training.length - 1].sessions);
      const muscles = ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes', 'triceps', 'biceps'] as const;
      const grew = muscles.filter((m) => (peak[m] ?? 0) > (first[m] ?? 0));
      expect(grew.length).toBeGreaterThanOrEqual(6);
    });
  }
});
