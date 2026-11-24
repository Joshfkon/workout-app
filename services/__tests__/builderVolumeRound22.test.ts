/**
 * UX round 22 (builder): "volume is low for an advanced lifter. Quads sit at
 * MEV, back is at MEV" — the generator's leftover-time top-up, the Bro Split
 * calves move, and the landmark-anchored starting volume.
 */
import {
  generateFullMesocycleWithFatigue,
  peakTrainingWeek,
  sessionSetCapacity,
  splitRotationLength,
  splitWeekDays,
} from '../sessionBuilderWithFatigue';
import {
  effectiveTrainingAge,
  landmarkVolumeTarget,
  recommendVolume,
  STARTING_VOLUME_OPTIONS,
} from '../mesocycleBuilder';
import { COARSE_MUSCLES, coarseVolumeLandmarks, getEffectiveBand, mavBandFraction } from '../volumeBands';
import { deliveredSetsAtPeak } from '@/lib/training/builderDefaults';
import type { ExtendedUserProfile, Experience, Goal, Split } from '@/types/schema';

const advancedBulk: ExtendedUserProfile = {
  age: 30,
  experience: 'advanced',
  goal: 'bulk',
  sleepQuality: 3,
  stressLevel: 3,
  availableEquipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'],
  injuryHistory: [],
  trainingAge: effectiveTrainingAge(0, 'advanced'),
  heightCm: 180,
  latestDexa: null,
  enhancedAthleteMode: false,
};

const build = (split: Split, days: number, minutes = 75, options = {}) =>
  generateFullMesocycleWithFatigue(days, advancedBulk, minutes, undefined, [], 1, undefined, undefined, split, options);

describe('leftover session time goes to the muscles the fair share shorted', () => {
  it('a Bro Split Arms day holds more than the set-count capacity, inside its minutes', () => {
    const peak = peakTrainingWeek(build('Bro Split', 5).mesocycleWeeks ?? [])!;
    const arms = peak.sessions.find((s) => s.day === 'Arms')!;
    expect(arms.totalSets).toBeGreaterThan(sessionSetCapacity(75, 'bulk'));
    expect(arms.estimatedMinutes).toBeLessThanOrEqual(75);
  });

  it('the Upper days it tops up stay inside the chosen length', () => {
    const peak = peakTrainingWeek(build('Upper/Lower', 4).mesocycleWeeks ?? [])!;
    for (const s of peak.sessions.filter((x) => x.day.startsWith('Upper'))) {
      expect(s.estimatedMinutes).toBeLessThanOrEqual(75);
    }
  });

  it('Bro Split peak week: biceps and triceps above what they were (15 and 11)', () => {
    const delivered = deliveredSetsAtPeak(build('Bro Split', 5))!;
    expect(delivered.biceps!).toBeGreaterThanOrEqual(16);
    expect(delivered.triceps!).toBeGreaterThanOrEqual(13);
  });

  it('keeps the ramp: week 1 is lighter than the peak week', () => {
    const weeks = build('Bro Split', 5).mesocycleWeeks ?? [];
    const total = (i: number) => weeks[i].sessions.reduce((n, s) => n + s.totalSets, 0);
    expect(total(0)).toBeLessThan(total(weeks.findIndex((w) => w === peakTrainingWeek(weeks))));
  });

  it('with a raised per-session limit, the Back day keeps traps at MEV', () => {
    const delivered = deliveredSetsAtPeak(build('Bro Split', 5, 75, { maxSetsPerMusclePerSession: 16 }))!;
    expect(delivered.traps!).toBeGreaterThanOrEqual(getEffectiveBand('traps').mev);
    expect(delivered.back!).toBeGreaterThan(14);
  });
});

describe('a priority takes time above the others’ MEV, not their MEV', () => {
  it('Bro Split Legs day: high-priority hamstrings at a 16-set limit leaves quads at or above MEV', () => {
    const program = generateFullMesocycleWithFatigue(
      5, advancedBulk, 75, undefined, [], 1, undefined,
      [{ muscleGroup: 'hamstrings', volumeMultiplier: 1.2, reason: 'user_priority' }],
      'Bro Split',
      { maxSetsPerMusclePerSession: 16 }
    );
    const delivered = deliveredSetsAtPeak(program)!;
    expect(delivered.quads!).toBeGreaterThanOrEqual(getEffectiveBand('quads').mev);
    // …and the priority still gains over the plain plan.
    expect(delivered.hamstrings!).toBeGreaterThan(deliveredSetsAtPeak(build('Bro Split', 5, 75, { maxSetsPerMusclePerSession: 16 }))!.hamstrings!);
  });
});

describe('Bro Split days', () => {
  it('calves ride the Chest day, not the Back day', () => {
    expect(splitWeekDays('Bro Split', 5)).toEqual(['Chest', 'Back', 'Shoulders', 'Arms', 'Legs']);
    const peak = peakTrainingWeek(build('Bro Split', 5).mesocycleWeeks ?? [])!;
    const muscleOf = (day: string) =>
      peak.sessions.find((s) => s.day === day)!.exercises.map((e) => e.exercise.primaryMuscle);
    expect(muscleOf('Back').some((m) => ['calves', 'gastrocnemius', 'soleus'].includes(m))).toBe(false);
    expect(muscleOf('Chest').some((m) => ['calves', 'gastrocnemius', 'soleus'].includes(m))).toBe(true);
  });

  it('splitWeekDays follows the rotation length', () => {
    for (const split of ['Full Body', 'Upper/Lower', 'PPL', 'Arnold', 'Bro Split'] as Split[]) {
      expect(splitWeekDays(split, splitRotationLength(split)).length).toBe(splitRotationLength(split));
    }
  });
});

describe('landmark-anchored starting volume', () => {
  it('coarse MAV sits inside the band, at the landmark table’s place', () => {
    for (const experience of ['novice', 'intermediate', 'advanced'] as Experience[]) {
      for (const m of COARSE_MUSCLES) {
        const l = coarseVolumeLandmarks(m, experience);
        expect(l.mev).toBeLessThanOrEqual(l.mav);
        expect(l.mav).toBeLessThanOrEqual(l.mrv);
      }
    }
    // Advanced quads: landmarks 10 / 18 / 26 → halfway.
    expect(mavBandFraction('quads', 'advanced')).toBeCloseTo(0.5);
    expect(coarseVolumeLandmarks('quads', 'advanced').mav).toBe(14);
  });

  it('conservative < standard < high, between MEV and MRV for every goal', () => {
    for (const experience of ['novice', 'intermediate', 'advanced'] as Experience[]) {
      for (const goal of ['cut', 'maintenance', 'bulk'] as Goal[]) {
        for (const m of COARSE_MUSCLES) {
          const band = getEffectiveBand(m);
          const sets = STARTING_VOLUME_OPTIONS.map((v) => recommendVolume(experience, goal, m, false, v));
          for (const v of sets) {
            expect(v).toBeGreaterThanOrEqual(band.mev);
            expect(v).toBeLessThanOrEqual(band.mrv);
          }
          expect(sets[0]).toBeLessThanOrEqual(sets[1]);
          expect(sets[1]).toBeLessThanOrEqual(sets[2]);
        }
      }
    }
    expect(landmarkVolumeTarget('back', 'advanced', 'standard')).toBe(coarseVolumeLandmarks('back', 'advanced').mav);
  });

  it('omitted, the presets are unchanged', () => {
    expect(recommendVolume('advanced', 'bulk', 'chest')).toBe(20);
    expect(recommendVolume('intermediate', 'maintenance', 'back')).toBe(16);
  });

  it('the generator plans the chosen level', () => {
    const conservative = build('Upper/Lower', 4, 75, { startingVolume: 'conservative' }).volumePerMuscle;
    const high = build('Upper/Lower', 4, 75, { startingVolume: 'high' }).volumePerMuscle;
    expect(conservative.back.sets).toBeLessThan(high.back.sets);
    expect(conservative.quads.sets).toBeLessThan(high.quads.sets);
  });
});
