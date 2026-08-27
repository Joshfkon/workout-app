/**
 * PlannedWeekRecovery — the #634 adapter that lets mesocycle generation read
 * the ONE recovery model (services/muscleRecovery) instead of the retired
 * points-based WeeklyFatigueTracker.
 *
 * These tests pin the adapter's own policy (skip/trim mapping, coarse-target
 * aggregation, virtual-day bookkeeping) and its contract with the model
 * (enhanced mode reaches mover windows but never the stabilizer channel).
 */

import {
  PlannedWeekRecovery,
  plannedSetScale,
  PLANNED_SKIP_READINESS,
  PLANNED_TRIM_READINESS,
  PLANNED_TRIM_FLOOR,
  type PlannedExercise,
} from '@/services/plannedRecovery';

const heavyHingeDay: PlannedExercise = {
  primaryMuscle: 'hamstrings',
  secondaryMuscles: ['glutes', 'erectors', 'forearms'],
  stabilizers: ['erectors', 'forearms'],
  sets: 6,
  targetRir: 1,
};

const chestDay: PlannedExercise = {
  primaryMuscle: 'chest',
  secondaryMuscles: ['front_delts', 'triceps_lat_med'],
  stabilizers: ['rotator_cuff', 'rear_delts'],
  sets: 8,
  targetRir: 2,
};

describe('plannedSetScale', () => {
  it('maps the readiness bands to skip / trim / full', () => {
    expect(plannedSetScale(0)).toBe(0);
    expect(plannedSetScale(PLANNED_SKIP_READINESS - 0.001)).toBe(0);
    expect(plannedSetScale(PLANNED_SKIP_READINESS)).toBeCloseTo(PLANNED_TRIM_FLOOR);
    expect(plannedSetScale(PLANNED_TRIM_READINESS)).toBe(1);
    expect(plannedSetScale(1)).toBe(1);
  });

  it('is monotone through the trim ramp', () => {
    const mid = (PLANNED_SKIP_READINESS + PLANNED_TRIM_READINESS) / 2;
    expect(plannedSetScale(mid)).toBeGreaterThan(plannedSetScale(PLANNED_SKIP_READINESS));
    expect(plannedSetScale(mid)).toBeLessThan(1);
  });
});

describe('virtual planned-week history', () => {
  it('a day never sees its own session — debt starts when the session completes', () => {
    const recovery = new PlannedWeekRecovery({ experience: 'intermediate' });
    recovery.record(0, chestDay);
    expect(recovery.readiness('chest', 0).readinessRatio).toBe(1);
  });

  it('the next day sees the debt, and rest days heal it monotonically', () => {
    const recovery = new PlannedWeekRecovery({ experience: 'intermediate' });
    recovery.record(0, chestDay);
    const day1 = recovery.readiness('chest', 1).readinessRatio;
    const day3 = recovery.readiness('chest', 3).readinessRatio;
    expect(day1).toBeLessThan(1);
    expect(day3).toBeGreaterThan(day1);
  });

  it('real schedule gaps matter: Mon→Wed is readier than Mon→Tue', () => {
    const recovery = new PlannedWeekRecovery({ experience: 'intermediate' });
    recovery.record(0, chestDay);
    expect(recovery.readiness('chest', 2).readinessRatio).toBeGreaterThan(
      recovery.readiness('chest', 1).readinessRatio
    );
  });

  it('an untouched muscle reads fresh', () => {
    const recovery = new PlannedWeekRecovery({});
    recovery.record(0, chestDay);
    expect(recovery.readiness('quads', 1)).toMatchObject({
      readinessRatio: 1,
      status: 'fresh',
    });
  });

  it('an unknown muscle token reads fresh instead of crashing the planner', () => {
    const recovery = new PlannedWeekRecovery({});
    expect(recovery.readiness('flux_capacitor', 1).readinessRatio).toBe(1);
  });
});

describe('coarse-target aggregation', () => {
  it("one fatigued head does not veto the group: 'shoulders' aggregates by mean", () => {
    const recovery = new PlannedWeekRecovery({ experience: 'intermediate' });
    // Hammer ONLY front delts (pressing day).
    recovery.record(0, {
      primaryMuscle: 'front_delts',
      secondaryMuscles: [],
      sets: 8,
      targetRir: 1,
    });
    const result = recovery.readiness('shoulders', 1);
    const front = result.byStandard.front_delts ?? 1;
    expect(front).toBeLessThan(1);
    // Untouched heads are fresh, so the aggregate sits between the fatigued
    // head and 1 — a rear-delt day after pressing is not skipped outright.
    expect(result.readinessRatio).toBeGreaterThan(front);
    expect(result.readinessRatio).toBeLessThan(1);
    expect(result.byStandard.lateral_delts).toBe(1);
  });
});

describe('stabilizer awareness', () => {
  it('a heavy hinge day leaves erectors + forearms stabilizer-fatigued next day', () => {
    const recovery = new PlannedWeekRecovery({ experience: 'intermediate' });
    recovery.record(0, heavyHingeDay);
    const fatigued = recovery.fatiguedStabilizers(1);
    expect(fatigued.has('erectors')).toBe(true);
    expect(fatigued.has('forearms')).toBe(true);
    expect(fatigued.has('rotator_cuff')).toBe(false);
  });

  it('stabilizers clear after enough rest days', () => {
    const recovery = new PlannedWeekRecovery({ experience: 'intermediate' });
    recovery.record(0, heavyHingeDay);
    expect(recovery.fatiguedStabilizers(6).size).toBe(0);
  });
});

describe('profile modifiers', () => {
  it('enhanced mode shortens MOVER recovery but never touches the stabilizer channel', () => {
    const natural = new PlannedWeekRecovery({ experience: 'intermediate' });
    const enhanced = new PlannedWeekRecovery({
      experience: 'intermediate',
      enhancedAthleteMode: true,
    });
    for (const recovery of [natural, enhanced]) recovery.record(0, heavyHingeDay);

    // Mover readiness recovers faster under the mode…
    expect(enhanced.readiness('hamstrings', 1).readinessRatio).toBeGreaterThan(
      natural.readiness('hamstrings', 1).readinessRatio
    );
    // …while the stabilizer verdicts are identical (exerciseSafety invariant,
    // inherited from computeStabilizerRecovery).
    expect(Array.from(enhanced.fatiguedStabilizers(1)).sort()).toEqual(
      Array.from(natural.fatiguedStabilizers(1)).sort()
    );
  });

  it('chronic short sleep (profile rating ≤2) stretches recovery windows', () => {
    const rested = new PlannedWeekRecovery({ experience: 'intermediate', sleepQuality: 4 });
    const shortSleep = new PlannedWeekRecovery({ experience: 'intermediate', sleepQuality: 2 });
    for (const recovery of [rested, shortSleep]) recovery.record(0, chestDay);
    expect(shortSleep.readiness('chest', 1).readinessRatio).toBeLessThan(
      rested.readiness('chest', 1).readinessRatio
    );
  });

  it('excellent sleep (5) shrinks them slightly', () => {
    const normal = new PlannedWeekRecovery({ experience: 'intermediate', sleepQuality: 3 });
    const great = new PlannedWeekRecovery({ experience: 'intermediate', sleepQuality: 5 });
    for (const recovery of [normal, great]) recovery.record(0, chestDay);
    expect(great.readiness('chest', 1).readinessRatio).toBeGreaterThan(
      normal.readiness('chest', 1).readinessRatio
    );
  });

  it('higher planned frequency reads the same session as a bigger relative dose', () => {
    const lowFreq = new PlannedWeekRecovery({
      experience: 'intermediate',
      plannedSessionsPerWeekByMuscle: { chest_upper: 1, chest_lower: 1 },
    });
    const highFreq = new PlannedWeekRecovery({
      experience: 'intermediate',
      plannedSessionsPerWeekByMuscle: { chest_upper: 4, chest_lower: 4 },
    });
    for (const recovery of [lowFreq, highFreq]) recovery.record(0, chestDay);
    expect(highFreq.readiness('chest', 1).readinessRatio).toBeLessThan(
      lowFreq.readiness('chest', 1).readinessRatio
    );
  });
});

describe('determinism', () => {
  it('same inputs, same plan-facing outputs — no clock reads anywhere', () => {
    const build = () => {
      const recovery = new PlannedWeekRecovery({ experience: 'advanced', sleepQuality: 3 });
      recovery.record(0, heavyHingeDay);
      recovery.record(2, chestDay);
      return {
        back: recovery.readiness('back', 4),
        chest: recovery.readiness('chest', 4),
        stabilizers: Array.from(recovery.fatiguedStabilizers(4)).sort(),
      };
    };
    expect(build()).toEqual(build());
  });
});
