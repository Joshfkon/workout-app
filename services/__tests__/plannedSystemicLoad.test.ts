/**
 * assessPlannedSystemicLoad — the schedule builder's systemic /
 * connective-tissue check (plannedRecovery), separate from the per-muscle
 * hard-set warning.
 *
 * Pins: consecutive-high-intensity-day detection (RIR-weighted low-intensity
 * days break the streak; wrap-around across the repeating cycle counts; an
 * unbroken cycle always warns), and the steady-state stabilizer replay
 * through the real recovery model — including that rear-delt / pressing
 * dose still reaches the connective channel despite being exempt from the
 * hard-set warning rollup, and that stock stabilizer tags are looked up by
 * exercise name when generated entries lack the column.
 */

import {
  assessPlannedSystemicLoad,
  CONSECUTIVE_HIGH_INTENSITY_DAY_LIMIT,
  LOW_INTENSITY_DAY_WEIGHTED_SET_CEILING,
  type PlannedExercise,
  type PlannedScheduleDay,
} from '@/services/plannedRecovery';

const hardLegs: PlannedExercise = {
  primaryMuscle: 'quads',
  secondaryMuscles: ['glutes'],
  sets: 6,
  targetRir: 1,
};

const heavyHinge: PlannedExercise = {
  primaryMuscle: 'hamstrings',
  secondaryMuscles: ['glutes', 'erectors', 'forearms'],
  stabilizers: ['erectors', 'forearms'],
  sets: 6,
  targetRir: 1,
};

const heavyPress: PlannedExercise = {
  primaryMuscle: 'chest',
  secondaryMuscles: ['front_delts', 'triceps_lat_med'],
  stabilizers: ['rotator_cuff', 'rear_delts'],
  sets: 8,
  targetRir: 1,
};

const oneCurl: PlannedExercise = {
  primaryMuscle: 'biceps',
  secondaryMuscles: [],
  sets: 1,
  targetRir: 0,
};

const days = (offsets: number[], exercise: PlannedExercise): PlannedScheduleDay[] =>
  offsets.map((day) => ({ day, exercises: [exercise] }));

describe('consecutive high-intensity days', () => {
  it('6 hard days in a row trips the warning with the streak in the copy', () => {
    const result = assessPlannedSystemicLoad({
      days: days([0, 1, 2, 3, 4, 5], hardLegs),
      cycleLengthDays: 7,
    });
    expect(result.maxConsecutiveHighIntensityDays).toBe(6);
    expect(result.unbrokenCycle).toBe(false);
    expect(result.consecutiveDaysWarning).toBe(
      '6 consecutive hard training days with no low-intensity day — watch joint/tendon load.'
    );
  });

  it('5 in a row does not', () => {
    const result = assessPlannedSystemicLoad({
      days: days([0, 1, 2, 3, 4], hardLegs),
      cycleLengthDays: 7,
    });
    expect(result.maxConsecutiveHighIntensityDays).toBe(
      CONSECUTIVE_HIGH_INTENSITY_DAY_LIMIT - 1
    );
    expect(result.consecutiveDaysWarning).toBeNull();
  });

  it('the streak wraps across the cycle boundary (Fri–Wed is 6 straight days)', () => {
    const result = assessPlannedSystemicLoad({
      days: days([4, 5, 6, 0, 1, 2], hardLegs),
      cycleLengthDays: 7,
    });
    expect(result.maxConsecutiveHighIntensityDays).toBe(6);
    expect(result.consecutiveDaysWarning).not.toBeNull();
  });

  it('a genuinely light day breaks the streak — one hard curl is not a training day', () => {
    // Hard Mon–Wed and Fri–Sat, light Thu, rest Sun. Without the light day
    // reading as low-intensity this would be a 5-day run and stay quiet
    // anyway, so pin the computed run length: 3, not 6.
    const schedule = days([0, 1, 2, 4, 5], hardLegs);
    schedule.push({ day: 3, exercises: [oneCurl] });
    const result = assessPlannedSystemicLoad({ days: schedule, cycleLengthDays: 7 });
    // Day 3's single weighted set sits under the low-intensity ceiling.
    expect(LOW_INTENSITY_DAY_WEIGHTED_SET_CEILING).toBeGreaterThan(1);
    expect(result.maxConsecutiveHighIntensityDays).toBe(3);
    expect(result.consecutiveDaysWarning).toBeNull();
  });

  it('high-RIR volume is weighted down: 8 sets at 4 RIR is a low-intensity day', () => {
    // Same seven-day shape as the six-in-a-row case, but day 3's session is
    // all 4-RIR cruise volume (2 weighted sets) — it must break the streak
    // exactly as a rest day would.
    const cruiseDay: PlannedScheduleDay = {
      day: 3,
      exercises: [{ primaryMuscle: 'quads', secondaryMuscles: [], sets: 8, targetRir: 4 }],
    };
    const result = assessPlannedSystemicLoad({
      days: [...days([0, 1, 2, 4, 5], hardLegs), cruiseDay],
      cycleLengthDays: 7,
    });
    expect(result.maxConsecutiveHighIntensityDays).toBe(3);
    expect(result.consecutiveDaysWarning).toBeNull();
  });

  it('an unbroken cycle (train hard every single day) always warns', () => {
    const result = assessPlannedSystemicLoad({
      days: days([0], hardLegs),
      cycleLengthDays: 1, // interval mode, every day
    });
    expect(result.unbrokenCycle).toBe(true);
    expect(result.consecutiveDaysWarning).toContain('Every day');
  });

  it('every-other-day interval schedules never streak', () => {
    const result = assessPlannedSystemicLoad({
      days: days([0], hardLegs),
      cycleLengthDays: 2,
    });
    expect(result.unbrokenCycle).toBe(false);
    expect(result.maxConsecutiveHighIntensityDays).toBe(1);
    expect(result.consecutiveDaysWarning).toBeNull();
  });
});

describe('connective-tissue (stabilizer) reload at steady state', () => {
  it('daily heavy hinging re-loads erectors before the channel clears', () => {
    const result = assessPlannedSystemicLoad({
      days: days([0, 1, 2, 3, 4], heavyHinge),
      cycleLengthDays: 7,
      recovery: { experience: 'intermediate' },
    });
    const muscles = result.stabilizerReloads.map((f) => f.muscle);
    expect(muscles).toContain('erectors');
    expect(result.stabilizerWarning).toMatch(/connective tissue/);
    expect(result.stabilizerWarning).toMatch(/readiness \d+% by day \d/);
    for (const finding of result.stabilizerReloads) {
      expect(finding.readinessRatio).toBeGreaterThanOrEqual(0);
      expect(finding.readinessRatio).toBeLessThan(1);
    }
  });

  it('pressing dose reaches the channel even though rear delts are warning-exempt', () => {
    const result = assessPlannedSystemicLoad({
      days: days([0, 1, 2, 3, 4], heavyPress),
      cycleLengthDays: 7,
      recovery: { experience: 'intermediate' },
    });
    const muscles = result.stabilizerReloads.map((f) => f.muscle);
    expect(muscles).toEqual(expect.arrayContaining(['rotator_cuff']));
  });

  it('one hinge day a week leaves the channel clear', () => {
    const result = assessPlannedSystemicLoad({
      days: days([0], heavyHinge),
      cycleLengthDays: 7,
      recovery: { experience: 'intermediate' },
    });
    expect(result.stabilizerReloads).toHaveLength(0);
    expect(result.stabilizerWarning).toBeNull();
  });

  it('stock stabilizer tags are looked up by exercise name when absent', () => {
    const untaggedRdl: PlannedExercise = {
      name: 'Romanian Deadlift',
      primaryMuscle: 'hamstrings',
      secondaryMuscles: ['glutes'],
      sets: 6,
      targetRir: 1,
    };
    const result = assessPlannedSystemicLoad({
      days: days([0, 1, 2, 3, 4], untaggedRdl),
      cycleLengthDays: 7,
      recovery: { experience: 'intermediate' },
    });
    expect(result.stabilizerReloads.map((f) => f.muscle)).toContain('erectors');
  });

  it('is deterministic — same schedule, same findings', () => {
    const input = {
      days: days([0, 1, 2, 3, 4], heavyHinge),
      cycleLengthDays: 7,
      recovery: { experience: 'intermediate' as const },
    };
    expect(assessPlannedSystemicLoad(input)).toEqual(assessPlannedSystemicLoad(input));
  });
});
