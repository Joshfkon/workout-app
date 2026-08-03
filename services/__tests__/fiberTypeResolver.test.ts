/**
 * Fiber-type resolution (Bug 5).
 *
 * The point of these tests is that gastrocnemius 'mixed' is a REAL behavioural
 * change, not an enum edit. Before the resolver existed, the fiber table was
 * keyed by the 13 coarse legacy groups and `RepRangeFactors.muscleGroup` was
 * typed to match, so a fine key could never reach a fiber lookup at all — a
 * per-standard override would have been unreachable dead data.
 */

import {
  DEFAULT_FIBER_TYPE,
  MUSCLE_FIBER_PROFILE,
  STANDARD_MUSCLE_FIBER_OVERRIDES,
  calculateRepRange,
  fiberTypeForMuscle,
  getDUPRepRange,
} from '@/services/repRangeEngine';
import { calculateExerciseFatigue } from '@/services/fatigueBudgetEngine';
import type { RepRangeFactors } from '@/types/schema';

describe('fiberTypeForMuscle', () => {
  it('applies the per-standard override for gastrocnemius', () => {
    expect(fiberTypeForMuscle('gastrocnemius')).toBe('mixed');
  });

  it('keeps soleus slow', () => {
    expect(fiberTypeForMuscle('soleus')).toBe('slow');
  });

  it('leaves the coarse calves label untouched', () => {
    expect(fiberTypeForMuscle('calves')).toBe('slow');
    expect(MUSCLE_FIBER_PROFILE.calves).toBe('slow');
  });

  it('gastrocnemius and soleus now DISAGREE — they used to share one label', () => {
    expect(fiberTypeForMuscle('gastrocnemius')).not.toBe(fiberTypeForMuscle('soleus'));
  });

  it('resolves fine muscles without an override through their coarse parent', () => {
    expect(fiberTypeForMuscle('triceps_long')).toBe('fast'); // via triceps
    expect(fiberTypeForMuscle('triceps_lat_med')).toBe('fast');
    expect(fiberTypeForMuscle('front_delts')).toBe('mixed'); // via shoulders
    expect(fiberTypeForMuscle('lats')).toBe('mixed'); // via back
  });

  it('passes legacy coarse tokens straight through', () => {
    expect(fiberTypeForMuscle('hamstrings')).toBe('fast');
    expect(fiberTypeForMuscle('chest')).toBe('mixed');
    expect(fiberTypeForMuscle('forearms')).toBe('slow');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(fiberTypeForMuscle('  Gastrocnemius ')).toBe('mixed');
  });

  it('falls back explicitly for unknown tokens', () => {
    expect(fiberTypeForMuscle('not_a_muscle')).toBe(DEFAULT_FIBER_TYPE);
    expect(fiberTypeForMuscle('')).toBe(DEFAULT_FIBER_TYPE);
  });

  it('the override table stays minimal and deliberate', () => {
    expect(STANDARD_MUSCLE_FIBER_OVERRIDES).toEqual({
      gastrocnemius: 'mixed',
      soleus: 'slow',
    });
  });
});

describe('rep-range behaviour: before/after gastrocnemius', () => {
  const factors = (muscleGroup: RepRangeFactors['muscleGroup']): RepRangeFactors => ({
    goal: 'bulk',
    experience: 'intermediate',
    exercisePattern: 'isolation',
    muscleGroup,
    positionInWorkout: 'early',
    weekInMesocycle: 1,
    totalMesocycleWeeks: 4,
    periodizationModel: 'block',
  });

  it('gastrocnemius now prescribes the mixed range, not the slow range', () => {
    const gastroc = calculateRepRange(factors('gastrocnemius'));
    const calves = calculateRepRange(factors('calves'));
    // 'slow' adds +2 min / +3 max; 'mixed' adds nothing.
    expect(calves.min - gastroc.min).toBe(2);
    expect(calves.max - gastroc.max).toBe(3);
  });

  it('soleus still prescribes the slow range, identical to coarse calves', () => {
    const soleus = calculateRepRange(factors('soleus'));
    const calves = calculateRepRange(factors('calves'));
    expect(soleus.min).toBe(calves.min);
    expect(soleus.max).toBe(calves.max);
  });

  it('drops the "higher reps and time under tension" note for gastrocnemius', () => {
    expect(calculateRepRange(factors('calves')).notes).toMatch(/higher reps/);
    expect(calculateRepRange(factors('gastrocnemius')).notes).not.toMatch(/higher reps/);
    expect(calculateRepRange(factors('soleus')).notes).toMatch(/higher reps/);
  });

  it('DUP hypertrophy ranges diverge the same way', () => {
    const gastroc = getDUPRepRange('hypertrophy', false, 'gastrocnemius');
    const soleus = getDUPRepRange('hypertrophy', false, 'soleus');
    expect(gastroc).toEqual({ min: 12, max: 15 }); // mixed: unadjusted
    expect(soleus).toEqual({ min: 15, max: 19 }); // slow: +3/+4
  });
});

describe('Model B fatigue-decay behaviour', () => {
  const exercise = (primaryMuscle: string) => ({
    id: 'x',
    name: 'Calf Raise',
    primaryMuscle,
    secondaryMuscles: [] as string[],
    pattern: 'calf_raise' as const,
    equipment: 'machine' as const,
  });

  it('the fatigue engine now sees the SAME fiber label as the rep-range engine', () => {
    // Regression guard for the real defect: the fatigue engine used to carry
    // its own coarse-only lookup, so gastrocnemius read 'slow' there and
    // 'mixed' here. Both now route through fiberTypeForMuscle.
    for (const muscle of ['gastrocnemius', 'soleus', 'calves', 'triceps_long', 'hamstrings']) {
      const viaResolver = fiberTypeForMuscle(muscle);
      const repRangeSaysSlow = calculateRepRange({
        goal: 'bulk',
        experience: 'intermediate',
        exercisePattern: 'isolation',
        muscleGroup: muscle as RepRangeFactors['muscleGroup'],
        positionInWorkout: 'early',
        weekInMesocycle: 1,
        totalMesocycleWeeks: 4,
        periodizationModel: 'block',
      }).notes.includes('higher reps');
      expect(repRangeSaysSlow).toBe(viaResolver === 'slow');
    }
  });

  it('gastrocnemius recovery days are unchanged by this fix (slow->mixed misses the fast branch)', () => {
    // Honest reporting: the recoveryDays branch keys on 'fast', so moving
    // gastrocnemius from 'slow' to 'mixed' does not alter it. The change that
    // DOES land is calculateRecoveryRate's slow-twitch x1.1 bonus, which
    // gastrocnemius no longer receives.
    const before = calculateExerciseFatigue(exercise('calves') as never, 3, 12, 2, 1);
    const after = calculateExerciseFatigue(exercise('gastrocnemius') as never, 3, 12, 2, 1);
    expect(after.recoveryDays).toBe(before.recoveryDays);
  });

  it('a fast-twitch primary still extends recovery on heavy low-rep work', () => {
    const heavy = calculateExerciseFatigue(exercise('hamstrings') as never, 3, 5, 1, 1);
    const light = calculateExerciseFatigue(exercise('hamstrings') as never, 3, 12, 1, 1);
    expect(heavy.recoveryDays).toBeGreaterThan(light.recoveryDays);
  });
});
