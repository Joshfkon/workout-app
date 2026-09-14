/**
 * plannedVolumeProjection — projection math for the in-workout weekly volume
 * strip. The credited numbers must stay in the SAME unit as the week-to-date
 * rows (canonical per-set credit, within-group cap), and the lock-in rule must
 * only fire on deficits recovery has actually decided.
 */

import {
  hoursLeftInLocalDay,
  isDeficitLockedIn,
  plannedGroupSets,
  remainingPlannedSets,
  type PlannedBlockVolume,
} from '@/services/plannedVolumeProjection';

const block = (
  primaryMuscle: string | null,
  secondaryMuscles: string[],
  remainingSets: number
): PlannedBlockVolume => ({ primaryMuscle, secondaryMuscles, remainingSets });

describe('remainingPlannedSets', () => {
  it('is target minus logged working sets', () => {
    expect(remainingPlannedSets(4, 1)).toBe(3);
    expect(remainingPlannedSets(3, 0)).toBe(3);
  });

  it('floors at zero when the user logged past the plan', () => {
    expect(remainingPlannedSets(3, 5)).toBe(0);
  });

  it('plans nothing after a mid-session target cut below what was logged', () => {
    // Plan edited from 5 → 2 sets after 3 were logged: the logged sets stay
    // history; nothing further is planned, and never a negative contribution.
    expect(remainingPlannedSets(2, 3)).toBe(0);
  });

  it('treats a missing/invalid target as planning nothing', () => {
    expect(remainingPlannedSets(undefined, 0)).toBe(0);
    expect(remainingPlannedSets(null, 2)).toBe(0);
    expect(remainingPlannedSets(Number.NaN, 0)).toBe(0);
    expect(remainingPlannedSets(-2, 0)).toBe(0);
  });

  it('ignores a negative logged count (defensive)', () => {
    expect(remainingPlannedSets(4, -1)).toBe(4);
  });
});

describe('plannedGroupSets', () => {
  it('credits a precise primary tag 1.0 per remaining set', () => {
    const planned = plannedGroupSets([block('biceps', [], 3)]);
    expect(planned.get('biceps')).toBeCloseTo(3, 5);
  });

  it('credits secondaries 0.5 per set, cross-group (bench pattern)', () => {
    const planned = plannedGroupSets([block('chest_upper', ['front_delts', 'triceps'], 4)]);
    expect(planned.get('chest')).toBeCloseTo(4, 5);
    expect(planned.get('shoulders')).toBeCloseTo(2, 5);
    expect(planned.get('triceps')).toBeCloseTo(2, 5);
  });

  it('a legacy coarse primary still credits its group a full set per set', () => {
    // 'chest' splits chest_upper 0.5 + chest_lower 0.5 — both inside the chest
    // group, so the group total stays 1.0/set, same as the weekly rows count it.
    const planned = plannedGroupSets([block('chest', [], 4)]);
    expect(planned.get('chest')).toBeCloseTo(4, 5);
  });

  it('applies the within-group cap: primary + same-group secondary never exceed 1.0/set', () => {
    const planned = plannedGroupSets([block('chest_upper', ['chest_lower'], 4)]);
    // Uncapped would be 4 × (1.0 + 0.5) = 6; the canonical cap holds it at 4.
    expect(planned.get('chest')).toBeCloseTo(4, 5);
  });

  it('accumulates across blocks', () => {
    const planned = plannedGroupSets([
      block('biceps', [], 2),
      block('lats', ['biceps'], 3),
    ]);
    expect(planned.get('biceps')).toBeCloseTo(2 + 1.5, 5);
    expect(planned.get('back')).toBeCloseTo(3, 5);
  });

  it('skips blocks with nothing remaining and blocks with no primary tag', () => {
    const planned = plannedGroupSets([
      block('biceps', [], 0),
      block(null, ['biceps'], 3),
    ]);
    expect(planned.size).toBe(0);
  });

  it('drops an unresolvable primary tag (no band to project against)', () => {
    const planned = plannedGroupSets([block('not-a-muscle', [], 3)]);
    expect(planned.size).toBe(0);
  });

  it('a skipped exercise is simply absent from the inputs — projection follows', () => {
    const withExercise = plannedGroupSets([
      block('quads', [], 4),
      block('hamstrings', ['glutes'], 3),
    ]);
    const afterSkip = plannedGroupSets([block('quads', [], 4)]);
    expect(withExercise.get('hamstrings')).toBeCloseTo(3, 5);
    expect(afterSkip.has('hamstrings')).toBe(false);
    expect(afterSkip.get('quads')).toBeCloseTo(4, 5);
  });
});

describe('hoursLeftInLocalDay', () => {
  it('measures to the next local midnight', () => {
    expect(hoursLeftInLocalDay(new Date(2026, 7, 30, 21, 0, 0))).toBeCloseTo(3, 5);
    expect(hoursLeftInLocalDay(new Date(2026, 7, 30, 0, 0, 0))).toBeCloseTo(24, 5);
  });
});

describe('isDeficitLockedIn', () => {
  it('locks an under-minimum muscle whose recovery ETA runs past the day', () => {
    expect(
      isDeficitLockedIn({ projectedBelowMin: true, readyInHours: 30, hoursLeftInDay: 6 })
    ).toBe(true);
  });

  it('never locks a ready muscle — more sets are still the user’s choice', () => {
    expect(
      isDeficitLockedIn({ projectedBelowMin: true, readyInHours: 0, hoursLeftInDay: 6 })
    ).toBe(false);
  });

  it('does not lock when the muscle recovers before the day ends', () => {
    expect(
      isDeficitLockedIn({ projectedBelowMin: true, readyInHours: 2, hoursLeftInDay: 6 })
    ).toBe(false);
  });

  it('boundary: an ETA exactly at end of day is still (just) reachable', () => {
    expect(
      isDeficitLockedIn({ projectedBelowMin: true, readyInHours: 6, hoursLeftInDay: 6 })
    ).toBe(false);
  });

  it('never fires on a muscle that is not below minimum', () => {
    expect(
      isDeficitLockedIn({ projectedBelowMin: false, readyInHours: 30, hoursLeftInDay: 6 })
    ).toBe(false);
  });
});
