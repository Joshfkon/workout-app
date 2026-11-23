/**
 * Generated sessions fill the plan (UX panel round 18).
 *
 * The builder's review showed weekly targets the workouts never contained:
 * advanced bulk, 60-minute sessions, peak week — Upper/Lower triceps 0/22,
 * calves 0/20, abs 0/18; PPL calves and abs 0; Bro Split hamstrings 6/20.
 * Root cause: each session filled its template's muscles first come, first
 * served against a fixed exercise count and the session clock, so the
 * muscles listed last got nothing; PPL Push/Pull and the Bro Split had no
 * place for calves or abs at all; and the stimulus-to-fatigue check refused
 * late-slot exercises outright.
 */
import {
  generateFullMesocycleWithFatigue,
  buildDetailedSessionWithFatigue,
  fairShareSessionSets,
  sessionSetCapacity,
  creditedSetsByGroup,
  peakTrainingWeek,
  MAX_SETS_PER_MUSCLE_PER_SESSION,
  MIN_SETS_PER_PLANNED_MUSCLE,
} from '../sessionBuilderWithFatigue';
import { createFatigueBudget } from '../fatigueBudgetEngine';
import { PlannedWeekRecovery } from '../plannedRecovery';
import { resolveMuscleToStandard } from '@/types/schema';
import type {
  Equipment,
  Experience,
  ExtendedUserProfile,
  FullProgramRecommendation,
  Goal,
  MuscleGroup,
  Rating,
  Split,
} from '@/types/schema';
import type { CoarseMuscle } from '../volumeBands';

function profile(goal: Goal, experience: Experience): ExtendedUserProfile {
  return {
    goal,
    experience,
    heightCm: 180,
    latestDexa: null,
    age: 30,
    sleepQuality: 3 as Rating,
    stressLevel: 3 as Rating,
    trainingAge: experience === 'novice' ? 0.5 : 5,
    availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine'] as Equipment[],
    injuryHistory: [],
  };
}

const SPLITS: [Split, number][] = [
  ['Upper/Lower', 4],
  ['PPL', 6],
  ['Bro Split', 5],
];

/** Muscles some session of the week is built to train: every targeted
 *  group except traps, which no template lists (indirect credit only; the
 *  review flags it against MEV instead). */
function plannedMuscles(program: FullProgramRecommendation): MuscleGroup[] {
  return (Object.keys(program.volumePerMuscle) as MuscleGroup[]).filter((m) => m !== 'traps');
}

function peakDelivered(program: FullProgramRecommendation) {
  const peak = peakTrainingWeek(program.mesocycleWeeks ?? []);
  if (!peak) throw new Error('no training weeks');
  return creditedSetsByGroup(peak.sessions);
}

describe('fairShareSessionSets', () => {
  it('returns the requests unchanged when they fit', () => {
    expect(fairShareSessionSets([4, 3, 2], 12)).toEqual([4, 3, 2]);
  });

  it('keeps every muscle a floor and shares the rest by what each still wants', () => {
    const out = fairShareSessionSets([12, 12, 12, 11, 11], 22);
    expect(out.reduce((a, b) => a + b, 0)).toBe(22);
    for (const s of out) expect(s).toBeGreaterThanOrEqual(MIN_SETS_PER_PLANNED_MUSCLE);
    // The LAST muscle is not starved by the ones before it.
    expect(out[4]).toBeGreaterThanOrEqual(4);
  });

  it('never gives a muscle more than it asked for', () => {
    expect(fairShareSessionSets([1, 20], 10)).toEqual([1, 9]);
  });

  it('falls back to the floors when even those do not fit', () => {
    expect(fairShareSessionSets([6, 6, 6], 4)).toEqual([2, 2, 2]);
  });
});

describe('sessionSetCapacity', () => {
  it('grows with the session length and is shorter-rest (more sets) on a cut', () => {
    expect(sessionSetCapacity(75, 'bulk')).toBeGreaterThan(sessionSetCapacity(60, 'bulk'));
    expect(sessionSetCapacity(60, 'cut')).toBeGreaterThan(sessionSetCapacity(60, 'bulk'));
  });
});

describe('buildDetailedSessionWithFatigue: the last muscle a template lists still trains', () => {
  it.each(['novice', 'intermediate', 'advanced'] as Experience[])(
    '%s Upper day at 60 min trains all five muscles (triceps was 0)',
    (experience) => {
      const p = profile('bulk', experience);
      const volume = {
        chest: { sets: 20, frequency: 2 },
        back: { sets: 22, frequency: 2 },
        shoulders: { sets: 26, frequency: 2 },
        biceps: { sets: 24, frequency: 2 },
        triceps: { sets: 22, frequency: 2 },
      } as Record<MuscleGroup, { sets: number; frequency: number }>;
      const session = buildDetailedSessionWithFatigue(
        { day: 'Upper A', focus: 'Upper', targetMuscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] },
        volume,
        p,
        createFatigueBudget(p),
        new PlannedWeekRecovery({ experience, sleepQuality: p.sleepQuality }),
        0,
        1,
        6,
        'block',
        { week: 1, intensityModifier: 0.75, volumeModifier: 1.1, rpeTarget: { min: 7, max: 8 }, focus: 'Accumulation' },
        false,
        [],
        60
      );
      const delivered = creditedSetsByGroup([session]);
      for (const m of ['chest', 'back', 'shoulders', 'biceps', 'triceps'] as CoarseMuscle[]) {
        expect(delivered[m] ?? 0).toBeGreaterThanOrEqual(MIN_SETS_PER_PLANNED_MUSCLE);
      }
    }
  );
});

describe('generateFullMesocycleWithFatigue fills what it plans', () => {
  const cases: [Goal, Experience, Split, number, number][] = [];
  for (const [goal, experience] of [
    ['bulk', 'advanced'],
    ['cut', 'advanced'],
    ['bulk', 'intermediate'],
    ['maintenance', 'novice'],
  ] as [Goal, Experience][]) {
    for (const minutes of [60, 75]) {
      for (const [split, days] of SPLITS) cases.push([goal, experience, split, days, minutes]);
    }
  }

  it.each(cases)('%s %s %s ×%i at %i min: no planned muscle gets 0 sets', (goal, experience, split, days, minutes) => {
    const program = generateFullMesocycleWithFatigue(days, profile(goal, experience), minutes, undefined, [], 1, undefined, undefined, split);
    expect(program.split).toBe(split);
    const delivered = peakDelivered(program);
    for (const m of plannedMuscles(program)) {
      expect({ m, sets: (delivered[m as CoarseMuscle] ?? 0) >= MIN_SETS_PER_PLANNED_MUSCLE }).toEqual({ m, sets: true });
    }
  });

  it.each(cases)(
    '%s %s %s ×%i at %i min: sessions hold ≥ 85% of each effective target, and a cap never hides a collapse',
    (goal, experience, split, days, minutes) => {
      const program = generateFullMesocycleWithFatigue(days, profile(goal, experience), minutes, undefined, [], 1, undefined, undefined, split);
      const delivered = peakDelivered(program);
      const caps = program.volumeCaps ?? {};
      for (const m of plannedMuscles(program)) {
        const wanted = program.volumePerMuscle[m].sets;
        const target = caps[m]?.fits ?? wanted;
        const got = delivered[m as CoarseMuscle] ?? 0;
        // The review's target is what the sessions hold…
        expect(got).toBeGreaterThanOrEqual(target * 0.85);
        // …and holding it never means quietly dropping a muscle: every
        // planned muscle keeps at least 35% of what the plan wanted (the
        // old generator delivered 0% of triceps, calves and abs).
        expect({ m, share: got / wanted >= 0.35 }).toEqual({ m, share: true });
      }
    }
  );

  it('says so when a target is capped to fit the sessions', () => {
    const program = generateFullMesocycleWithFatigue(4, profile('bulk', 'advanced'), 60, undefined, [], 1, undefined, undefined, 'Upper/Lower');
    const capped = Object.keys(program.volumeCaps ?? {});
    expect(capped.length).toBeGreaterThan(0);
    expect(program.warnings.join(' ')).toMatch(/60-minute sessions hold fewer weekly sets than the plan wants/);
    // volumePerMuscle stays the plan's target (priorities still move it).
    for (const m of capped as MuscleGroup[]) {
      expect(program.volumeCaps![m]!.wanted).toBe(program.volumePerMuscle[m].sets);
      expect(program.volumeCaps![m]!.fits).toBeLessThan(program.volumePerMuscle[m].sets);
    }
  });

  it('places calves and abs in the week on every split (PPL Push had neither, the Bro Split had no abs)', () => {
    for (const [split, days] of SPLITS) {
      const program = generateFullMesocycleWithFatigue(days, profile('bulk', 'advanced'), 60, undefined, [], 1, undefined, undefined, split);
      const delivered = peakDelivered(program);
      expect(delivered.calves ?? 0).toBeGreaterThan(0);
      expect(delivered.abs ?? 0).toBeGreaterThan(0);
    }
  });

  it('keeps one muscle under the per-session ceiling', () => {
    const program = generateFullMesocycleWithFatigue(5, profile('bulk', 'advanced'), 90, undefined, [], 1, undefined, undefined, 'Bro Split');
    for (const week of program.mesocycleWeeks ?? []) {
      for (const session of week.sessions) {
        const perMuscle = new Map<string, number>();
        for (const e of session.exercises) {
          const key = e.exercise.primaryMuscle;
          perMuscle.set(key, (perMuscle.get(key) ?? 0) + e.sets);
        }
        for (const sets of Array.from(perMuscle.values())) expect(sets).toBeLessThanOrEqual(MAX_SETS_PER_MUSCLE_PER_SESSION);
      }
    }
  });

  it('ramps even when the sessions are full: the deload holds fewer sets than the peak week', () => {
    for (const [split, days] of SPLITS) {
      const program = generateFullMesocycleWithFatigue(days, profile('bulk', 'advanced'), 60, undefined, [], 1, 6, undefined, split);
      const weeks = program.mesocycleWeeks!;
      const deload = creditedSetsByGroup(weeks[weeks.length - 1].sessions);
      const peak = peakDelivered(program);
      const total = (r: Partial<Record<CoarseMuscle, number>>) => Object.values(r).reduce((a, b) => a + (b ?? 0), 0);
      expect(total(deload)).toBeLessThan(total(peak) * 0.75);
    }
  });

  it('prescribes the deload inside its own RPE window (it was 1 RIR on a block)', () => {
    const program = generateFullMesocycleWithFatigue(4, profile('bulk', 'advanced'), 60, undefined, [], 1, 6, undefined, 'Upper/Lower');
    const deload = program.mesocycleWeeks![5];
    expect(deload.isDeload).toBe(true);
    for (const s of deload.sessions) for (const e of s.exercises) expect(e.reps.targetRIR).toBeGreaterThanOrEqual(10 - deload.rpeTarget.max);
  });

  it('a prioritized head (rear delts) gets more direct sets than without the priority', () => {
    const p = profile('bulk', 'advanced');
    const rearDelts = (program: FullProgramRecommendation) => {
      const peak = peakTrainingWeek(program.mesocycleWeeks ?? [])!;
      return peak.sessions
        .flatMap((s) => s.exercises)
        .filter((e) => resolveMuscleToStandard(e.exercise.primaryMuscle).includes('rear_delts'))
        .reduce((sum, e) => sum + e.sets, 0);
    };
    const base = generateFullMesocycleWithFatigue(4, p, 60, undefined, [], 1, undefined, undefined, 'Upper/Lower');
    const prioritized = generateFullMesocycleWithFatigue(4, p, 60, undefined, [], 1, undefined, [
      { muscleGroup: 'shoulders', head: 'rear_delts', volumeMultiplier: 1.1, reason: 'user_priority' },
    ], 'Upper/Lower');
    expect(rearDelts(prioritized)).toBeGreaterThan(rearDelts(base));
    expect(prioritized.programNotes.join(' ')).toMatch(/priority muscles: rear_delts/);
  });
});
