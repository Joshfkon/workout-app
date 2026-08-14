/**
 * Planned per-muscle weekly frequency — the session-capacity denominator.
 *
 * The central property here is that this is PLAN-derived. A frequency derived
 * from trailing completed sessions would climb as the week filled, which would
 * silently re-interpret an already-completed session as a lighter dose and
 * shrink its recovery window retroactively. These tests pin the plan reading
 * and the source accounting that lets production see when it is unavailable.
 */

import {
  getFrequencySourceMetrics,
  plannedSessionsPerWeekByMuscle,
  recordFrequencySource,
  resetFrequencySourceMetrics,
  type PlannedSessionLike,
} from '@/services/plannedFrequency';
import {
  DEFAULT_PLANNED_SESSIONS_PER_WEEK,
  RECOVERY_CONFIG,
  computeDoseScale,
  sessionCapacityFor,
} from '@/services/muscleRecovery';

const day = (...exercises: Array<[string, string[]?]>): PlannedSessionLike => ({
  exercises: exercises.map(([primaryMuscle, secondaryMuscles]) => ({
    primaryMuscle,
    secondaryMuscles: secondaryMuscles ?? [],
  })),
});

describe('plannedSessionsPerWeekByMuscle', () => {
  it('counts SESSIONS, not exercises — four quad exercises in one day is frequency 1', () => {
    const counts = plannedSessionsPerWeekByMuscle([
      day(['quads'], ['quads'], ['quads'], ['quads']),
    ]);
    expect(counts.quads).toBe(1);
  });

  it('counts a muscle once per day across a multi-day week', () => {
    const counts = plannedSessionsPerWeekByMuscle([
      day(['quads'], ['hamstrings']),
      day(['chest_upper']),
      day(['quads'], ['quads']),
    ]);
    expect(counts.quads).toBe(2);
    expect(counts.hamstrings).toBe(1);
    expect(counts.chest_upper).toBe(1);
  });

  it('counts secondary tags — a muscle trained only as a secondary is still trained', () => {
    const counts = plannedSessionsPerWeekByMuscle([
      day(['hamstrings', ['glutes', 'erectors']]),
    ]);
    expect(counts.glutes).toBe(1);
    expect(counts.erectors).toBe(1);
  });

  it('resolves coarse and fine tags through the canonical resolver', () => {
    const counts = plannedSessionsPerWeekByMuscle([day(['chest']), day(['gastrocnemius'])]);
    // Legacy 'chest' expands to both heads.
    expect(counts.chest_upper).toBe(1);
    expect(counts.chest_lower).toBe(1);
    // A component tag DOES imply its capacity owner. This map is the divisor
    // under the capacity owner's MRV in sessionCapacityFor, so counting a
    // gastrocnemius session against the parent's schedule but not the parent
    // itself would normalize one set of work against two schedules. Siblings
    // are still not implied — soleus was never planned.
    expect(counts.gastrocnemius).toBe(1);
    expect(counts.calves).toBe(1);
    expect(counts.soleus).toBeUndefined();
  });

  it('spreads a coarse plan across the family it cannot name', () => {
    // Three coarsely-tagged pull days: the parent and both heads must agree on
    // the schedule, or the same sets get normalized against 16/3 for the group
    // and the 16/2 fallback for the heads — which sent the head rows Fresh
    // ahead of the group row on the Train page.
    const counts = plannedSessionsPerWeekByMuscle([
      day(['glutes', ['traps']]),
      day(['glutes', ['traps']]),
      day(['glutes', ['traps']]),
    ]);
    expect(counts.traps).toBe(3);
    expect(counts.upper_traps).toBe(3);
    expect(counts.mid_lower_traps).toBe(3);
  });

  it('gives a family member the same session capacity as its capacity owner', () => {
    const counts = plannedSessionsPerWeekByMuscle([
      day(['glutes', ['traps']]),
      day(['glutes', ['traps']]),
      day(['glutes', ['traps']]),
    ]);
    const config = {
      ...RECOVERY_CONFIG,
      experienceForCapacity: 'intermediate' as const,
      plannedSessionsPerWeekByMuscle: counts,
    };

    const parent = sessionCapacityFor('traps', config);
    for (const child of ['upper_traps', 'mid_lower_traps'] as const) {
      const component = sessionCapacityFor(child, config);
      expect(component.plannedFrequencySource).toBe('perMuscle');
      expect(component.plannedSessionsPerWeek).toBe(parent.plannedSessionsPerWeek);
      expect(component.sessionCapacity).toBe(parent.sessionCapacity);
      // Not the silent fallback the exact-row lookup used to land on.
      expect(component.plannedSessionsPerWeek).not.toBe(DEFAULT_PLANNED_SESSIONS_PER_WEEK);
    }
  });

  it('omits muscles absent from the plan rather than defaulting them', () => {
    const counts = plannedSessionsPerWeekByMuscle([day(['quads'])]);
    expect(counts.biceps).toBeUndefined();
    expect('biceps' in counts).toBe(false);
  });

  it('handles an empty or malformed plan without throwing', () => {
    expect(plannedSessionsPerWeekByMuscle([])).toEqual({});
    expect(
      plannedSessionsPerWeekByMuscle([{ exercises: [] }, { exercises: [{ primaryMuscle: null }] }])
    ).toEqual({});
    expect(
      plannedSessionsPerWeekByMuscle([{ exercises: [{ primaryMuscle: 'not_a_muscle' }] }])
    ).toEqual({});
  });

  it('is INDEPENDENT of how much of the week has been completed', () => {
    // The property that rules out an observed-history derivation: the plan for
    // a week is the same number whether it is read on Monday or Sunday.
    const week = [day(['quads']), day(['chest_upper']), day(['quads'])];
    expect(plannedSessionsPerWeekByMuscle(week).quads).toBe(2);
    expect(plannedSessionsPerWeekByMuscle(week).quads).toBe(2);
  });
});

describe('frequency feeds the dose model', () => {
  it('a plan-derived frequency changes the window vs the fallback', () => {
    const plan = plannedSessionsPerWeekByMuscle([
      day(['quads']),
      day(['quads']),
      day(['quads']),
    ]);
    expect(plan.quads).toBe(3);

    const withPlan = sessionCapacityFor('quads', {
      ...RECOVERY_CONFIG,
      experienceForCapacity: 'advanced',
      plannedSessionsPerWeekByMuscle: plan,
    });
    const withFallback = sessionCapacityFor('quads', {
      ...RECOVERY_CONFIG,
      experienceForCapacity: 'advanced',
    });

    expect(withPlan.plannedFrequencySource).toBe('perMuscle');
    expect(withPlan.plannedSessionsPerWeek).toBe(3);
    expect(withFallback.plannedFrequencySource).toBe('fallback');
    expect(withFallback.plannedSessionsPerWeek).toBe(DEFAULT_PLANNED_SESSIONS_PER_WEEK);
    // Higher planned frequency → smaller session capacity → same work reads heavier.
    expect(withPlan.sessionCapacity).toBeLessThan(withFallback.sessionCapacity);

    const heavier = computeDoseScale('quads', 8, 3, {
      ...RECOVERY_CONFIG,
      experienceForCapacity: 'advanced',
      plannedSessionsPerWeekByMuscle: plan,
    }).doseScale;
    const lighter = computeDoseScale('quads', 8, 3, {
      ...RECOVERY_CONFIG,
      experienceForCapacity: 'advanced',
    }).doseScale;
    expect(heavier).toBeGreaterThan(lighter);
  });

  it('a muscle missing from the plan falls back per-muscle, not per-user', () => {
    const plan = plannedSessionsPerWeekByMuscle([day(['quads']), day(['quads'])]);
    const config = {
      ...RECOVERY_CONFIG,
      experienceForCapacity: 'advanced' as const,
      plannedSessionsPerWeekByMuscle: plan,
    };
    expect(sessionCapacityFor('quads', config).plannedFrequencySource).toBe('perMuscle');
    expect(sessionCapacityFor('biceps', config).plannedFrequencySource).toBe('fallback');
  });
});

describe('frequency-source metrics', () => {
  beforeEach(() => resetFrequencySourceMetrics());
  afterEach(() => resetFrequencySourceMetrics());

  it('starts empty with zero shares', () => {
    const m = getFrequencySourceMetrics();
    expect(m).toMatchObject({ perMuscle: 0, program: 0, fallback: 0, total: 0 });
    expect(m.fallbackShare).toBe(0);
  });

  it('counts each source and reports shares', () => {
    recordFrequencySource('perMuscle');
    recordFrequencySource('perMuscle');
    recordFrequencySource('program');
    recordFrequencySource('fallback');
    const m = getFrequencySourceMetrics();
    expect(m.total).toBe(4);
    expect(m.perMuscleShare).toBeCloseTo(0.5, 10);
    expect(m.programShare).toBeCloseTo(0.25, 10);
    expect(m.fallbackShare).toBeCloseTo(0.25, 10);
  });

  it('every dose evaluation records its source', () => {
    const plan = plannedSessionsPerWeekByMuscle([day(['quads']), day(['quads'])]);
    computeDoseScale('quads', 6, 2, {
      ...RECOVERY_CONFIG,
      experienceForCapacity: 'advanced',
      plannedSessionsPerWeekByMuscle: plan,
    });
    computeDoseScale('biceps', 6, 2, {
      ...RECOVERY_CONFIG,
      experienceForCapacity: 'advanced',
    });
    const m = getFrequencySourceMetrics();
    expect(m.perMuscle).toBe(1);
    expect(m.fallback).toBe(1);
    expect(m.total).toBe(2);
  });
});
