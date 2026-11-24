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
  creditedSetsByHead,
  RAMP_HEADS,
  mevSessionFloors,
  fairShareSessionSets,
} from '@/services/sessionBuilderWithFatigue';
import {
  buildPeriodizationPlan,
  calculateRecoveryFactors,
  effectiveTrainingAge,
} from '@/services/mesocycleBuilder';
import { getEffectiveBand } from '@/services/volumeBands';
import { deliveredSetsAtPeak, onceWeeklyCeilingMuscles, onceWeeklyCeilingNote } from '@/lib/training/builderDefaults';
import {
  MUSCLE_PRIORITY_HEADS,
  type Equipment,
  type Experience,
  type ExtendedUserProfile,
  type Goal,
  type Rating,
  type Split,
} from '@/types/schema';

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

type Weeks = NonNullable<ReturnType<typeof generateFullMesocycleWithFatigue>['mesocycleWeeks']>;
const totalSets = (r: Record<string, number | undefined>) => Object.values(r).reduce<number>((s, v) => s + (v ?? 0), 0);

/** Every RAMP_HEADS head that falls between two accumulation weeks the ramp climbs. */
function headDips(weeks: Weeks): string[] {
  const training = weeks.filter((w) => !w.isDeload);
  const dips: string[] = [];
  for (let k = 0; k + 1 < training.length; k++) {
    if (training[k].volumeModifier > training[k + 1].volumeModifier) continue; // a planned step down
    const a = creditedSetsByHead(training[k].sessions);
    const b = creditedSetsByHead(training[k + 1].sessions);
    for (const head of RAMP_HEADS) {
      if ((b[head] ?? 0) + 1e-6 < (a[head] ?? 0)) dips.push(`${head} ${a[head]} in week ${k + 1} → ${b[head] ?? 0} in week ${k + 2}`);
    }
  }
  return dips;
}

describe('heads ramp too (UX round 20: side delts 6 → 5 → 6 → 6 under climbing shoulders)', () => {
  for (const [experience, goal] of PROFILES) {
    for (const [split, days] of SPLITS) {
      for (const minutes of [45, 60, 90]) {
        it(`${experience} ${goal}, ${split} ×${days}, ${minutes} min: no head the table shows falls`, () => {
          const p = profile(experience, goal, effectiveTrainingAge(0, experience));
          const program = generateFullMesocycleWithFatigue(days, p, minutes, [], [], 1, 5, [], split);
          expect(headDips(program.mesocycleWeeks!)).toEqual([]);
        });
      }
    }
  }

  it('holds every head the week table can show (so every prioritizable head)', () => {
    for (const heads of Object.values(MUSCLE_PRIORITY_HEADS)) {
      for (const h of heads ?? []) expect(RAMP_HEADS).toContain(h);
    }
  });

  it.each([['Bro Split', 5], ['PPL', 6], ['Upper/Lower', 4]] as [Split, number][])(
    'advanced bulk %s ×%i at 75 min: side delts never fall W1 → W4; the deload still holds less than the peak',
    (split, days) => {
      const p = profile('advanced', 'bulk', effectiveTrainingAge(0, 'advanced'));
      const weeks = generateFullMesocycleWithFatigue(days, p, 75, [], [], 1, 5, [], split).mesocycleWeeks!;
      const training = weeks.filter((w) => !w.isDeload);
      const side = training.map((w) => creditedSetsByHead(w.sessions).lateral_delts ?? 0);
      for (let k = 0; k + 1 < side.length; k++) expect(side[k + 1]).toBeGreaterThanOrEqual(side[k]);
      expect(headDips(weeks)).toEqual([]);
      const deload = weeks.find((w) => w.isDeload)!;
      const biggest = Math.max(...training.map((w) => totalSets(creditedSetsByGroup(w.sessions))));
      expect(totalSets(creditedSetsByGroup(deload.sessions))).toBeLessThan(biggest);
    }
  );

  it('a prioritized side-delt head never falls on a Bro Split, and the group invariant still holds', () => {
    const p = profile('advanced', 'bulk', effectiveTrainingAge(0, 'advanced'));
    const adjustments = [
      { muscleGroup: 'shoulders' as const, head: 'lateral_delts' as const, volumeMultiplier: 1.1, reason: 'user_priority' as const },
    ];
    const weeks = generateFullMesocycleWithFatigue(5, p, 75, [], [], 1, 5, adjustments, 'Bro Split').mesocycleWeeks!;
    expect(headDips(weeks)).toEqual([]);
    const training = weeks.filter((w) => !w.isDeload);
    expect(creditedSetsByHead(training[training.length - 1].sessions).lateral_delts ?? 0).toBeGreaterThan(0);
    for (let k = 0; k + 1 < training.length; k++) {
      const a = creditedSetsByGroup(training[k].sessions);
      const b = creditedSetsByGroup(training[k + 1].sessions);
      for (const m of Object.keys(a) as (keyof typeof a)[]) expect(b[m] ?? 0).toBeGreaterThanOrEqual((a[m] ?? 0) - 1e-6);
    }
  });

  it('enforceNonDecreasingRamp trims a head that dips while its group climbs', () => {
    const ex = (primaryMuscle: string, sets: number) => ({ exercise: { primaryMuscle, secondaryMuscles: [] as string[] }, sets });
    // Shoulders 9 → 10, but side delts 6 → 5.
    const weeks = [
      { isDeload: false, volumeModifier: 0.9, sessions: [{ exercises: [ex('lateral_delts', 6), ex('rear_delts', 3)] }] },
      { isDeload: false, volumeModifier: 1, sessions: [{ exercises: [ex('lateral_delts', 5), ex('rear_delts', 5)] }] },
    ];
    expect(enforceNonDecreasingRamp(weeks)).toBe(1);
    expect(creditedSetsByHead(weeks[0].sessions).lateral_delts).toBe(5);
    expect(creditedSetsByHead(weeks[0].sessions).rear_delts).toBe(3);
    expect(creditedSetsByGroup(weeks[0].sessions).shoulders).toBe(8);
  });
});

describe('traps have a home in the session templates (UX round 20: ~1.5 sets a week, indirect only)', () => {
  const trapsMev = getEffectiveBand('traps', { recoveryProfile: 'standard' })!.mev;

  for (const [split, days] of SPLITS) {
    for (const minutes of [60, 75, 90]) {
      it(`advanced bulk ${split} ×${days}, ${minutes} min: direct traps work, at or above MEV every training week`, () => {
        const p = profile('advanced', 'bulk', effectiveTrainingAge(0, 'advanced'));
        const weeks = generateFullMesocycleWithFatigue(days, p, minutes, [], [], 1, 5, [], split).mesocycleWeeks!;
        const training = weeks.filter((w) => !w.isDeload);
        for (const w of training) {
          const direct = w.sessions.flatMap((s) => s.exercises).filter((e) => /traps/.test(e.exercise.primaryMuscle));
          expect(direct.length).toBeGreaterThan(0);
          expect(creditedSetsByGroup(w.sessions).traps ?? 0).toBeGreaterThanOrEqual(trapsMev);
        }
        const deload = weeks.find((w) => w.isDeload)!;
        const peak = Math.max(...training.map((w) => creditedSetsByGroup(w.sessions).traps ?? 0));
        expect(creditedSetsByGroup(deload.sessions).traps ?? 0).toBeLessThan(peak);
      });
    }
  }

  it('mevSessionFloors shares MEV over the sessions that train the muscle, capped at the target', () => {
    type Vol = Parameters<typeof mevSessionFloors>[0];
    type Templates = Parameters<typeof mevSessionFloors>[1];
    const templates = [
      { day: 'Upper A', focus: '', targetMuscles: ['chest', 'traps'] },
      { day: 'Upper B', focus: '', targetMuscles: ['chest', 'traps'] },
    ] as unknown as Templates;
    const vol = { traps: { sets: 11, frequency: 2 }, chest: { sets: 20, frequency: 2 } } as unknown as Vol;
    const floors = mevSessionFloors(vol, templates, { recoveryProfile: 'standard' });
    expect(floors.traps).toBe(Math.ceil(trapsMev / 2));
    expect(floors.chest).toBeUndefined(); // only MEV_FLOOR_MUSCLES
    const small = { traps: { sets: 2, frequency: 1 } } as unknown as Vol;
    expect(mevSessionFloors(small, [templates[0]], { recoveryProfile: 'standard' }).traps).toBe(2);
  });

  it('fairShareSessionSets keeps a muscle minimum when every minimum fits, else the uniform floor', () => {
    expect(fairShareSessionSets([10, 10, 10, 3], 12, [0, 0, 0, 3])[3]).toBe(3);
    expect(fairShareSessionSets([10, 10, 10, 3], 12)[3]).toBe(2);
    expect(fairShareSessionSets([8, 8], 4, [4, 4])).toEqual([2, 2]);
  });
});

describe('a once-a-week muscle past the per-session ceiling names the fix (UX round 20: Bro chest 11 of 20)', () => {
  it('Bro Split ×5 at 75 min: chest is listed, with a second day or a twice-a-week split as the fix', () => {
    const p = profile('advanced', 'bulk', effectiveTrainingAge(0, 'advanced'));
    const program = generateFullMesocycleWithFatigue(5, p, 75, [], [], 1, 5, [], 'Bro Split');
    const muscles = onceWeeklyCeilingMuscles(program.volumePerMuscle, deliveredSetsAtPeak(program)!);
    const chest = muscles.find((m) => m.muscle === 'chest')!;
    expect(chest).toBeDefined();
    expect(chest.delivered).toBeLessThanOrEqual(MAX_SETS_PER_MUSCLE_PER_SESSION);
    const note = onceWeeklyCeilingNote(muscles, 'Bro Split')!;
    expect(note).toMatch(/trained once a week/);
    expect(note).toMatch(/longer sessions won't raise/);
    expect(note).toMatch(/second day/);
    expect(note).toMatch(/Upper\/Lower \(4 days\)/);
    expect(note).not.toMatch(/Bro Split/);
    expect(note).toContain(`Chest ${chest.delivered} of ${chest.wanted}`);
  });

  it('a split that trains chest twice has nothing to say about it', () => {
    const p = profile('advanced', 'bulk', effectiveTrainingAge(0, 'advanced'));
    const program = generateFullMesocycleWithFatigue(4, p, 75, [], [], 1, 5, [], 'Upper/Lower');
    const muscles = onceWeeklyCeilingMuscles(program.volumePerMuscle, deliveredSetsAtPeak(program)!);
    expect(muscles).toEqual([]);
    expect(onceWeeklyCeilingNote([], 'Upper/Lower')).toBeNull();
  });

  it('one muscle reads "it"; a target one session can hold is not listed', () => {
    const note = onceWeeklyCeilingNote([{ muscle: 'chest', delivered: 11, wanted: 20 }], 'Bro Split')!;
    expect(note).toMatch(/^Chest is trained once a week/);
    expect(note).toMatch(/give it a second day/);
    expect(onceWeeklyCeilingMuscles({ traps: { sets: 11, frequency: 1 } }, { traps: 6 })).toEqual([]);
  });
});
