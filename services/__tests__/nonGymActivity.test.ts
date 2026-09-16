import {
  ACTIVITY_MUSCLE_OPTIONS,
  ACTIVITY_PRESETS,
  CARDIO_MODALITY_MUSCLES,
  musclesForOptionKeys,
  NON_GYM_ACTIVITY_CONFIG,
  activityToRecoverySession,
  cardioLogToRecoverySession,
  cardioPerformedAt,
  durationScaleFor,
  sanitizeMuscleGroups,
} from '../nonGymActivity';
import { computeMuscleRecovery, RECOVERY_CONFIG } from '../muscleRecovery';
import { STANDARD_MUSCLE_GROUPS } from '@/types/schema';

const HOUR = 1000 * 60 * 60;

describe('nonGymActivity', () => {
  describe('config sanity', () => {
    it('doses are monotone in intensity', () => {
      const { setsByIntensity, hardSetsByIntensity } = NON_GYM_ACTIVITY_CONFIG;
      expect(setsByIntensity.light).toBeLessThan(setsByIntensity.moderate);
      expect(setsByIntensity.moderate).toBeLessThan(setsByIntensity.hard);
      expect(hardSetsByIntensity.light).toBeLessThanOrEqual(hardSetsByIntensity.moderate);
      expect(hardSetsByIntensity.moderate).toBeLessThanOrEqual(hardSetsByIntensity.hard);
    });

    it('hard synthetic sets actually register as hard in the recovery model', () => {
      // If this drifts above the recovery model's threshold, "hard" activities
      // silently lose their hard-set window bonus.
      expect(NON_GYM_ACTIVITY_CONFIG.hardSetRir).toBeLessThanOrEqual(
        RECOVERY_CONFIG.hardRirThreshold
      );
      // And easy sets must NOT register as hard, or every intensity is "hard".
      for (const rir of Object.values(NON_GYM_ACTIVITY_CONFIG.easyRirByIntensity)) {
        expect(rir).toBeGreaterThan(RECOVERY_CONFIG.hardRirThreshold);
      }
    });

    it('every picker option maps only to live StandardMuscleGroups', () => {
      for (const option of ACTIVITY_MUSCLE_OPTIONS) {
        expect(option.muscles.length).toBeGreaterThan(0);
        for (const muscle of option.muscles) {
          expect(STANDARD_MUSCLE_GROUPS).toContain(muscle);
        }
      }
      const keys = ACTIVITY_MUSCLE_OPTIONS.map((o) => o.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('every preset default references a real picker option', () => {
      const keys = new Set(ACTIVITY_MUSCLE_OPTIONS.map((o) => o.key));
      for (const preset of ACTIVITY_PRESETS) {
        for (const key of preset.defaultOptionKeys) {
          expect(keys.has(key)).toBe(true);
        }
        // Every preset except 'other' must pre-select something — an empty
        // default would silently log zero-fatigue activities.
        if (preset.type !== 'other') {
          expect(preset.defaultOptionKeys.length).toBeGreaterThan(0);
        }
      }
    });

    it('musclesForOptionKeys flattens and dedupes', () => {
      expect(musclesForOptionKeys(['quads', 'back'])).toEqual(
        expect.arrayContaining(['quads', 'lats', 'upper_back'])
      );
      expect(musclesForOptionKeys(['quads', 'quads'])).toEqual(['quads']);
      expect(musclesForOptionKeys(['nope'])).toEqual([]);
    });

    it('every cardio modality mapping names live StandardMuscleGroups', () => {
      for (const muscles of Object.values(CARDIO_MODALITY_MUSCLES)) {
        expect(muscles!.length).toBeGreaterThan(0);
        for (const muscle of muscles!) {
          expect(STANDARD_MUSCLE_GROUPS).toContain(muscle);
        }
      }
    });
  });

  describe('sanitizeMuscleGroups', () => {
    it('drops unknown tokens and dedupes', () => {
      expect(sanitizeMuscleGroups(['quads', 'legs', 'quads', 'calves', ''])).toEqual([
        'quads',
        'calves',
      ]);
    });
  });

  describe('durationScaleFor', () => {
    it('is 1 at the reference and for missing durations', () => {
      expect(durationScaleFor(60)).toBe(1);
      expect(durationScaleFor(null)).toBe(1);
      expect(durationScaleFor(0)).toBe(1);
      expect(durationScaleFor(Number.NaN)).toBe(1);
    });

    it('clamps at both ends', () => {
      expect(durationScaleFor(5)).toBe(NON_GYM_ACTIVITY_CONFIG.durationScale.min);
      expect(durationScaleFor(600)).toBe(NON_GYM_ACTIVITY_CONFIG.durationScale.max);
      expect(durationScaleFor(90)).toBeCloseTo(1.5, 5);
      expect(durationScaleFor(45)).toBeCloseTo(0.75, 5);
    });
  });

  describe('activityToRecoverySession', () => {
    const performedAt = new Date('2026-09-13T16:00:00Z');

    it('builds one full-dose pseudo-exercise per affected muscle', () => {
      const session = activityToRecoverySession({
        performedAt,
        durationMinutes: 60,
        intensity: 'hard',
        muscleGroups: ['quads', 'calves'],
      })!;

      expect(session.performedAt).toBe(performedAt);
      expect(session.exercises).toHaveLength(2);
      for (const exercise of session.exercises) {
        expect(exercise.secondaryMuscles).toEqual([]);
        expect(exercise.sets).toHaveLength(NON_GYM_ACTIVITY_CONFIG.setsByIntensity.hard);
        const hard = exercise.sets.filter(
          (s) => s.repsInTank !== null && s.repsInTank <= RECOVERY_CONFIG.hardRirThreshold
        );
        expect(hard).toHaveLength(NON_GYM_ACTIVITY_CONFIG.hardSetsByIntensity.hard);
      }
      expect(session.exercises.map((e) => e.primaryMuscle)).toEqual(['quads', 'calves']);
    });

    it('returns null when no valid muscles remain', () => {
      expect(
        activityToRecoverySession({
          performedAt,
          durationMinutes: 60,
          intensity: 'hard',
          muscleGroups: [],
        })
      ).toBeNull();
      expect(
        activityToRecoverySession({
          performedAt,
          durationMinutes: 60,
          intensity: 'hard',
          muscleGroups: ['legs' as never],
        })
      ).toBeNull();
    });

    it('scales set counts with duration but never below one set', () => {
      const short = activityToRecoverySession({
        performedAt,
        durationMinutes: 10,
        intensity: 'light',
        muscleGroups: ['quads'],
      })!;
      expect(short.exercises[0].sets).toHaveLength(1);

      const long = activityToRecoverySession({
        performedAt,
        durationMinutes: 120,
        intensity: 'hard',
        muscleGroups: ['quads'],
      })!;
      const base = NON_GYM_ACTIVITY_CONFIG.setsByIntensity.hard;
      expect(long.exercises[0].sets.length).toBe(
        Math.round(base * NON_GYM_ACTIVITY_CONFIG.durationScale.max)
      );
    });

    it('gives each pseudo-exercise its own set array instances', () => {
      const session = activityToRecoverySession({
        performedAt,
        durationMinutes: 60,
        intensity: 'moderate',
        muscleGroups: ['quads', 'calves'],
      })!;
      expect(session.exercises[0].sets).not.toBe(session.exercises[1].sets);
      expect(session.exercises[0].sets[0]).not.toBe(session.exercises[1].sets[0]);
    });
  });

  describe('integration with computeMuscleRecovery', () => {
    const activityAt = (hoursAgo: number, now: Date) =>
      new Date(now.getTime() - hoursAgo * HOUR);

    it('a hard ride yesterday leaves quads not-fresh; an untouched muscle stays fresh', () => {
      const now = new Date('2026-09-14T16:00:00');
      const session = activityToRecoverySession({
        performedAt: activityAt(24, now),
        durationMinutes: 90,
        intensity: 'hard',
        muscleGroups: ['quads', 'calves'],
      })!;

      const quads = computeMuscleRecovery([session], 'quads', now, RECOVERY_CONFIG);
      expect(quads.status).not.toBe('fresh');
      expect(quads.lastTrainedAt).not.toBeNull();

      const chest = computeMuscleRecovery([session], 'chest_upper', now, RECOVERY_CONFIG);
      expect(chest.status).toBe('fresh');
      expect(chest.lastTrainedAt).toBeNull();
    });

    it('a light activity clears by the next day; a hard one does not', () => {
      const now = new Date('2026-09-14T18:00:00');
      const light = activityToRecoverySession({
        performedAt: activityAt(26, now),
        durationMinutes: 45,
        intensity: 'light',
        muscleGroups: ['quads'],
      })!;
      expect(computeMuscleRecovery([light], 'quads', now, RECOVERY_CONFIG).status).toBe('fresh');

      const hard = activityToRecoverySession({
        performedAt: activityAt(26, now),
        durationMinutes: 90,
        intensity: 'hard',
        muscleGroups: ['quads'],
      })!;
      expect(computeMuscleRecovery([hard], 'quads', now, RECOVERY_CONFIG).status).not.toBe(
        'fresh'
      );
    });

    it('windows are monotone in intensity for the same activity', () => {
      const now = new Date('2026-09-14T12:00:00');
      const windows = (['light', 'moderate', 'hard'] as const).map((intensity) => {
        const session = activityToRecoverySession({
          performedAt: activityAt(2, now),
          durationMinutes: 60,
          intensity,
          muscleGroups: ['quads'],
        })!;
        return computeMuscleRecovery([session], 'quads', now, RECOVERY_CONFIG).windowHours!;
      });
      expect(windows[0]).toBeLessThanOrEqual(windows[1]);
      expect(windows[1]).toBeLessThan(windows[2]);
    });
  });

  describe('cardio_log bridge', () => {
    it('maps a bike entry to a light-dose session on its quads/calves', () => {
      const session = cardioLogToRecoverySession({
        logged_at: '2026-09-13',
        minutes: 40,
        modality: 'bike',
        created_at: null,
      })!;
      expect(session.exercises.map((e) => e.primaryMuscle)).toEqual(
        CARDIO_MODALITY_MUSCLES.bike
      );
      // Light dose: no hard sets, ever.
      for (const exercise of session.exercises) {
        for (const set of exercise.sets) {
          expect(set.repsInTank).toBeGreaterThan(RECOVERY_CONFIG.hardRirThreshold);
        }
      }
    });

    it("returns null for 'other' and unknown modalities", () => {
      expect(
        cardioLogToRecoverySession({ logged_at: '2026-09-13', minutes: 30, modality: 'other' })
      ).toBeNull();
      expect(
        cardioLogToRecoverySession({ logged_at: '2026-09-13', minutes: 30, modality: 'sauna' })
      ).toBeNull();
    });

    it('uses created_at when it falls on the logged local day, else local noon', () => {
      const sameDay = cardioPerformedAt({
        logged_at: '2026-09-13',
        minutes: 30,
        modality: 'bike',
        created_at: new Date(2026, 8, 13, 18, 30).toISOString(),
      })!;
      expect(sameDay.getHours()).toBe(18);

      const backdated = cardioPerformedAt({
        logged_at: '2026-09-10',
        minutes: 30,
        modality: 'bike',
        created_at: new Date(2026, 8, 13, 18, 30).toISOString(),
      })!;
      expect(backdated.getFullYear()).toBe(2026);
      expect(backdated.getMonth()).toBe(8);
      expect(backdated.getDate()).toBe(10);
      expect(backdated.getHours()).toBe(12);

      expect(
        cardioPerformedAt({ logged_at: 'not-a-date', minutes: 30, modality: 'bike' })
      ).toBeNull();
    });
  });
});
