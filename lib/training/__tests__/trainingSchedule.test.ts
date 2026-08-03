import {
  buildTrainingSchedule,
  describeTrainingSchedule,
  getTrainingDays,
  getWorkoutForDate,
  getWorkoutForDay,
  intervalDaysPerWeek,
  isTrainingDate,
  localDaysBetween,
  nextTrainingDate,
  resolveScheduledSlot,
  scheduledDatesBetween,
  sessionsPerWeek,
} from '@/lib/training/trainingSchedule';
import { recommendSplit } from '@/services/mesocycleBuilder';
import type { WorkoutDay } from '@/types/schema';

/** Local-midnight date, matching the app's local-date convention. */
function d(iso: string): Date {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(y, m - 1, day);
}

// 2026-08-03 is a Monday.
const MONDAY = '2026-08-03';

describe('buildTrainingSchedule', () => {
  it('defaults to fixed days for legacy rows with no schedule columns', () => {
    const schedule = buildTrainingSchedule({ days_per_week: 4 });
    expect(schedule.mode).toBe('fixed_days');
    expect(schedule.intervalDays).toBeNull();
  });

  it('builds an interval schedule when mode, interval and anchor are present', () => {
    const schedule = buildTrainingSchedule({
      days_per_week: 4,
      schedule_mode: 'interval',
      training_interval_days: 2,
      start_date: MONDAY,
    });
    expect(schedule.mode).toBe('interval');
    expect(schedule.intervalDays).toBe(2);
    expect(schedule.anchorDate).toBe(MONDAY);
  });

  it('degrades to fixed days when an interval schedule is missing its interval', () => {
    const schedule = buildTrainingSchedule({
      days_per_week: 4,
      schedule_mode: 'interval',
      training_interval_days: null,
      start_date: MONDAY,
    });
    expect(schedule.mode).toBe('fixed_days');
  });

  it('degrades to fixed days when an interval schedule has no anchor date', () => {
    const schedule = buildTrainingSchedule({
      days_per_week: 4,
      schedule_mode: 'interval',
      training_interval_days: 2,
      start_date: null,
    });
    expect(schedule.mode).toBe('fixed_days');
  });

  it('clamps an out-of-range stored interval', () => {
    expect(
      buildTrainingSchedule({
        days_per_week: 4,
        schedule_mode: 'interval',
        training_interval_days: 99,
        start_date: MONDAY,
      }).intervalDays
    ).toBe(14);
  });

  it('trims a timestamp anchor to its date portion', () => {
    expect(
      buildTrainingSchedule({
        days_per_week: 4,
        schedule_mode: 'interval',
        training_interval_days: 2,
        start_date: `${MONDAY}T12:34:56Z`,
      }).anchorDate
    ).toBe(MONDAY);
  });
});

describe('fixed-day schedules', () => {
  const days: WorkoutDay[] = ['Monday', 'Tuesday', 'Thursday', 'Friday'];
  const schedule = buildTrainingSchedule({
    days_per_week: 4,
    preferred_workout_days: days,
  });

  it('trains on the selected weekdays and rests on the others', () => {
    expect(isTrainingDate(schedule, d('2026-08-03'))).toBe(true); // Mon
    expect(isTrainingDate(schedule, d('2026-08-04'))).toBe(true); // Tue
    expect(isTrainingDate(schedule, d('2026-08-05'))).toBe(false); // Wed
    expect(isTrainingDate(schedule, d('2026-08-06'))).toBe(true); // Thu
    expect(isTrainingDate(schedule, d('2026-08-08'))).toBe(false); // Sat
  });

  it('supports a weekend-only schedule — no weekday is privileged', () => {
    const weekend = buildTrainingSchedule({
      days_per_week: 2,
      preferred_workout_days: ['Saturday', 'Sunday'],
    });
    expect(isTrainingDate(weekend, d('2026-08-08'))).toBe(true); // Sat
    expect(isTrainingDate(weekend, d('2026-08-09'))).toBe(true); // Sun
    expect(isTrainingDate(weekend, d('2026-08-03'))).toBe(false); // Mon
    expect(getWorkoutForDate('Upper/Lower', d('2026-08-08'), weekend)?.dayName).toBe('Upper A');
    expect(getWorkoutForDate('Upper/Lower', d('2026-08-09'), weekend)?.dayName).toBe('Lower A');
  });

  it('repeats the same split slots every week', () => {
    const week1 = getWorkoutForDate('Upper/Lower', d('2026-08-03'), schedule);
    const week2 = getWorkoutForDate('Upper/Lower', d('2026-08-10'), schedule);
    expect(week1?.dayName).toBe('Upper A');
    expect(week2?.dayName).toBe('Upper A');
  });

  it('matches the legacy weekday API', () => {
    for (let dow = 1; dow <= 7; dow++) {
      const date = d('2026-08-02'); // Sunday before
      date.setDate(date.getDate() + dow);
      expect(getWorkoutForDate('PPL', date, schedule)).toEqual(
        getWorkoutForDay('PPL', dow, 4, days)
      );
    }
  });

  it('falls back to the default spread when no days were picked', () => {
    expect(getTrainingDays(3, null)).toEqual([1, 3, 5]);
    expect(getTrainingDays(4, [])).toEqual([1, 2, 4, 5]);
  });
});

describe('interval schedules', () => {
  const everyOtherDay = buildTrainingSchedule({
    days_per_week: 4,
    schedule_mode: 'interval',
    training_interval_days: 2,
    start_date: MONDAY,
  });

  it('trains every other day from the anchor', () => {
    expect(isTrainingDate(everyOtherDay, d('2026-08-03'))).toBe(true);
    expect(isTrainingDate(everyOtherDay, d('2026-08-04'))).toBe(false);
    expect(isTrainingDate(everyOtherDay, d('2026-08-05'))).toBe(true);
    expect(isTrainingDate(everyOtherDay, d('2026-08-07'))).toBe(true);
  });

  it('lands on weekends — the shape a weekday picker cannot express', () => {
    expect(isTrainingDate(everyOtherDay, d('2026-08-09'))).toBe(true); // Sunday
    expect(isTrainingDate(everyOtherDay, d('2026-08-15'))).toBe(true); // Saturday
  });

  it('shifts weekdays week over week instead of repeating', () => {
    // Monday two weeks apart: 14 days is even, so both are training days,
    // but the Tuesday between weeks flips.
    expect(isTrainingDate(everyOtherDay, d('2026-08-17'))).toBe(true); // Mon +14
    expect(isTrainingDate(everyOtherDay, d('2026-08-11'))).toBe(true); // Tue +8
    expect(isTrainingDate(everyOtherDay, d('2026-08-04'))).toBe(false); // Tue +1
  });

  it('rotates the split continuously rather than re-pinning to weekdays', () => {
    const names = [0, 2, 4, 6, 8].map(
      (offset) => {
        const date = d(MONDAY);
        date.setDate(date.getDate() + offset);
        return getWorkoutForDate('Upper/Lower', date, everyOtherDay)?.dayName;
      }
    );
    expect(names).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B', 'Upper A']);
  });

  it('never schedules before the anchor date', () => {
    expect(isTrainingDate(everyOtherDay, d('2026-08-01'))).toBe(false);
    expect(resolveScheduledSlot(everyOtherDay, d('2026-07-20'))).toBeNull();
  });

  it('supports every-3-days', () => {
    const everyThird = buildTrainingSchedule({
      days_per_week: 2,
      schedule_mode: 'interval',
      training_interval_days: 3,
      start_date: MONDAY,
    });
    expect(isTrainingDate(everyThird, d('2026-08-06'))).toBe(true);
    expect(isTrainingDate(everyThird, d('2026-08-05'))).toBe(false);
  });

  it('keeps dayNumber inside the planned week', () => {
    const date = d(MONDAY);
    date.setDate(date.getDate() + 20); // 10th session
    const workout = getWorkoutForDate('Upper/Lower', date, everyOtherDay);
    expect(workout?.dayNumber).toBeGreaterThanOrEqual(1);
    expect(workout?.dayNumber).toBeLessThanOrEqual(everyOtherDay.daysPerWeek);
  });
});

describe('intervalDaysPerWeek', () => {
  it('rounds the cadence to whole sessions per week', () => {
    expect(intervalDaysPerWeek(2)).toBe(4); // 3.5 -> 4
    expect(intervalDaysPerWeek(3)).toBe(2); // 2.33 -> 2
    expect(intervalDaysPerWeek(4)).toBe(2); // 1.75 -> 2, clamped up
  });

  it('never falls below the mesocycle builder floor', () => {
    expect(intervalDaysPerWeek(14)).toBe(2);
  });
});

describe('interval cadence changes the recommended split', () => {
  // Why the /mesocycle schedule editor must persist newProgram.split into
  // split_type: an interval cadence sets days/week, and the program generator
  // picks the split from days/week. If split_type were left alone, the
  // calendar surfaces (which read split_type) would advertise a different
  // workout than the one Start builds from program_data.
  it('drops a 6-day PPL block onto a different split at every 3 days', () => {
    expect(recommendSplit(6, 'bulk', 'intermediate').split).toBe('PPL');

    const cadenceDaysPerWeek = intervalDaysPerWeek(3);
    expect(cadenceDaysPerWeek).toBe(2);
    expect(recommendSplit(cadenceDaysPerWeek, 'bulk', 'intermediate').split).not.toBe('PPL');
  });

  it('is stable when the cadence lands on the same days/week', () => {
    // Every other day rounds to 4/week, which is what a 4-day block already
    // had — the split (and so split_type) must not move.
    expect(intervalDaysPerWeek(2)).toBe(4);
    expect(recommendSplit(4, 'bulk', 'intermediate').split).toBe(
      recommendSplit(intervalDaysPerWeek(2), 'bulk', 'intermediate').split
    );
  });
});

describe('sessionsPerWeek', () => {
  it('reports the true fractional cadence for intervals', () => {
    const schedule = buildTrainingSchedule({
      days_per_week: 4,
      schedule_mode: 'interval',
      training_interval_days: 2,
      start_date: MONDAY,
    });
    expect(sessionsPerWeek(schedule)).toBeCloseTo(3.5);
  });

  it('counts the picked days for fixed schedules', () => {
    expect(
      sessionsPerWeek(
        buildTrainingSchedule({
          days_per_week: 4,
          preferred_workout_days: ['Saturday', 'Sunday'],
        })
      )
    ).toBe(2);
  });
});

describe('nextTrainingDate', () => {
  const schedule = buildTrainingSchedule({
    days_per_week: 2,
    preferred_workout_days: ['Saturday', 'Sunday'],
  });

  it('finds the next scheduled day after a rest day', () => {
    const next = nextTrainingDate(schedule, d('2026-08-03')); // Monday
    expect(next?.offsetDays).toBe(5); // Saturday
  });

  it('can include the given day', () => {
    const next = nextTrainingDate(schedule, d('2026-08-08'), { includeFrom: true });
    expect(next?.offsetDays).toBe(0);
  });

  it('spans gaps longer than a week for long intervals', () => {
    const everyTenDays = buildTrainingSchedule({
      days_per_week: 2,
      schedule_mode: 'interval',
      training_interval_days: 10,
      start_date: MONDAY,
    });
    expect(nextTrainingDate(everyTenDays, d(MONDAY))?.offsetDays).toBe(10);
  });
});

describe('scheduledDatesBetween', () => {
  it('lists every session in an inclusive window', () => {
    const schedule = buildTrainingSchedule({
      days_per_week: 4,
      schedule_mode: 'interval',
      training_interval_days: 2,
      start_date: MONDAY,
    });
    const dates = scheduledDatesBetween(schedule, d(MONDAY), d('2026-08-09'));
    expect(dates.map((date) => date.getDate())).toEqual([3, 5, 7, 9]);
  });

  it('returns nothing when the window ends before the anchor', () => {
    const schedule = buildTrainingSchedule({
      days_per_week: 4,
      schedule_mode: 'interval',
      training_interval_days: 2,
      start_date: MONDAY,
    });
    expect(scheduledDatesBetween(schedule, d('2026-07-01'), d('2026-07-31'))).toEqual([]);
  });
});

describe('localDaysBetween', () => {
  it('counts whole local days across a DST-style boundary', () => {
    expect(localDaysBetween(d('2026-03-07'), d('2026-03-09'))).toBe(2);
    expect(localDaysBetween(d('2026-11-01'), d('2026-11-02'))).toBe(1);
  });

  it('ignores the time of day', () => {
    const morning = new Date(2026, 7, 3, 6, 30);
    const night = new Date(2026, 7, 3, 23, 45);
    expect(localDaysBetween(morning, night)).toBe(0);
  });
});

describe('describeTrainingSchedule', () => {
  it('names the interval cadence', () => {
    const schedule = buildTrainingSchedule({
      days_per_week: 4,
      schedule_mode: 'interval',
      training_interval_days: 2,
      start_date: MONDAY,
    });
    expect(describeTrainingSchedule(schedule)).toBe('Every other day (~3.5 sessions/week)');
    expect(describeTrainingSchedule(schedule, { short: true })).toBe('Every other day');
  });

  it('lists fixed days in calendar order', () => {
    const schedule = buildTrainingSchedule({
      days_per_week: 3,
      preferred_workout_days: ['Sunday', 'Wednesday', 'Friday'],
    });
    expect(describeTrainingSchedule(schedule, { short: true })).toBe('Wed, Fri, Sun');
  });
});
