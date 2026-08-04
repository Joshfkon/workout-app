// ============================================================
// TRAINING SCHEDULE
//
// Two ways to say when you train:
//
//   'fixed_days' — the same weekdays every week (Mon/Tue/Thu/Fri).
//   'interval'   — every N days, anchored to a start date ("every other
//                  day"). An interval schedule deliberately does NOT tile a
//                  7-day week: every other day is 3.5 sessions/week and its
//                  weekdays shift every week, which is exactly why it cannot
//                  be expressed as a set of preferred weekdays.
//
// Everything that asks "is there a workout on this date, and which slot of
// the split is it?" goes through resolveScheduledSlot() so the two modes
// cannot drift apart across the dashboard / log / train / mesocycle pages.
//
// Pure module: no DB access, no I/O. Callers pass the mesocycle row fields.
// ============================================================

import type { MuscleGroup, WorkoutDay } from '@/types/schema';
import { DAYS_OF_WEEK } from '@/types/schema';

export type ScheduleMode = 'fixed_days' | 'interval';

/** Intervals offered in the UI: every 2nd, 3rd or 4th day. */
export const TRAINING_INTERVAL_OPTIONS = [2, 3, 4] as const;

export const MIN_TRAINING_INTERVAL_DAYS = 2;
export const MAX_TRAINING_INTERVAL_DAYS = 14;

/** How far ahead the "next training day" search will look. */
const MAX_LOOKAHEAD_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface TrainingSchedule {
  mode: ScheduleMode;
  /**
   * Planned sessions per week used by the program/progression math. In
   * interval mode this is a rounded stand-in for 7 / intervalDays — the
   * calendar is driven by intervalDays, not by this number.
   */
  daysPerWeek: number;
  /** fixed_days: the weekdays the user picked. Null falls back to a default spread. */
  preferredWorkoutDays: WorkoutDay[] | null;
  /** interval: train every N days. */
  intervalDays: number | null;
  /** interval: local YYYY-MM-DD of the first training day (the block's start date). */
  anchorDate: string | null;
}

/** The mesocycle row columns a schedule is built from. */
export interface ScheduleSourceRow {
  days_per_week: number;
  preferred_workout_days?: WorkoutDay[] | null;
  schedule_mode?: string | null;
  training_interval_days?: number | null;
  start_date?: string | null;
}

// ============================================================
// Date helpers (LOCAL dates — see the app-wide timezone convention)
// ============================================================

/** Parse YYYY-MM-DD (or a timestamp's date portion) as local midnight. */
export function parseLocalDate(dateStr: string): Date | null {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const parsed = new Date(y, m - 1, d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Strip the time portion, keeping the local calendar day. */
function atLocalMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Whole local days from `from` to `to` (negative when `to` is earlier). */
export function localDaysBetween(from: Date, to: Date): number {
  return Math.round((atLocalMidnight(to).getTime() - atLocalMidnight(from).getTime()) / MS_PER_DAY);
}

/** ISO weekday number: Monday = 1 ... Sunday = 7. */
export function isoDayOfWeek(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

export function dayNameToNumber(dayName: WorkoutDay): number {
  return DAYS_OF_WEEK.indexOf(dayName) + 1;
}

export function numberToDayName(dayNumber: number): WorkoutDay {
  return DAYS_OF_WEEK[dayNumber - 1] || 'Monday';
}

// ============================================================
// Schedule construction
// ============================================================

/** Default weekday spreads when the user never picked days. Monday-anchored. */
const DEFAULT_TRAINING_DAY_MAPS: Record<number, number[]> = {
  1: [1],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 7],
};

/** Training days of the week (Monday=1..Sunday=7) for a fixed-day schedule. */
export function getTrainingDays(
  daysPerWeek: number,
  preferredWorkoutDays?: WorkoutDay[] | null
): number[] {
  if (preferredWorkoutDays && preferredWorkoutDays.length > 0) {
    return preferredWorkoutDays.map(dayNameToNumber).sort((a, b) => a - b);
  }
  return DEFAULT_TRAINING_DAY_MAPS[daysPerWeek] || DEFAULT_TRAINING_DAY_MAPS[4];
}

/**
 * Sessions-per-week to plan for an every-N-days cadence. Every other day is
 * 3.5 sessions/week, which the program/progression math (integer slots per
 * week) cannot represent — round to the nearest whole session and clamp to
 * the range the mesocycle builder supports.
 */
export function intervalDaysPerWeek(intervalDays: number): number {
  const safeInterval = clampInterval(intervalDays);
  return Math.max(2, Math.min(6, Math.round(7 / safeInterval)));
}

export function clampInterval(intervalDays: number): number {
  if (!Number.isFinite(intervalDays)) return MIN_TRAINING_INTERVAL_DAYS;
  return Math.max(
    MIN_TRAINING_INTERVAL_DAYS,
    Math.min(MAX_TRAINING_INTERVAL_DAYS, Math.round(intervalDays))
  );
}

/**
 * Build a normalized schedule from raw mesocycle fields. An interval schedule
 * missing its interval or anchor degrades to fixed days rather than silently
 * scheduling nothing.
 */
export function buildTrainingSchedule(row: ScheduleSourceRow): TrainingSchedule {
  const daysPerWeek = Math.max(1, Math.floor(row.days_per_week || 4));
  const preferredWorkoutDays = row.preferred_workout_days?.length
    ? row.preferred_workout_days
    : null;

  const wantsInterval = row.schedule_mode === 'interval';
  const intervalDays = row.training_interval_days ? clampInterval(row.training_interval_days) : null;
  const anchorDate = row.start_date ? row.start_date.slice(0, 10) : null;

  if (wantsInterval && intervalDays && anchorDate && parseLocalDate(anchorDate)) {
    return { mode: 'interval', daysPerWeek, preferredWorkoutDays, intervalDays, anchorDate };
  }

  return {
    mode: 'fixed_days',
    daysPerWeek,
    preferredWorkoutDays,
    intervalDays: null,
    anchorDate,
  };
}

// ============================================================
// Resolution
// ============================================================

export interface ScheduledSlot {
  /**
   * 0-based ordinal of this session within the rotation. Fixed-day schedules
   * restart at 0 each calendar week; interval schedules count continuously
   * from the anchor, so the split rotates through the week instead of
   * re-pinning to weekdays.
   */
  ordinal: number;
}

/** The scheduled slot for a date, or null when it is a rest day. */
export function resolveScheduledSlot(schedule: TrainingSchedule, date: Date): ScheduledSlot | null {
  if (schedule.mode === 'interval') {
    if (!schedule.intervalDays || !schedule.anchorDate) return null;
    const anchor = parseLocalDate(schedule.anchorDate);
    if (!anchor) return null;

    const elapsed = localDaysBetween(anchor, date);
    if (elapsed < 0) return null;
    if (elapsed % schedule.intervalDays !== 0) return null;
    return { ordinal: elapsed / schedule.intervalDays };
  }

  const trainingDays = getTrainingDays(schedule.daysPerWeek, schedule.preferredWorkoutDays);
  const ordinal = trainingDays.indexOf(isoDayOfWeek(date));
  return ordinal === -1 ? null : { ordinal };
}

export function isTrainingDate(schedule: TrainingSchedule, date: Date): boolean {
  return resolveScheduledSlot(schedule, date) !== null;
}

/**
 * The next training date strictly after `from` (or `from` itself when
 * `includeFrom`), plus how many days out it is. Null when nothing is
 * scheduled within the lookahead window.
 */
export function nextTrainingDate(
  schedule: TrainingSchedule,
  from: Date = new Date(),
  options: { includeFrom?: boolean; maxLookaheadDays?: number } = {}
): { date: Date; offsetDays: number } | null {
  const { includeFrom = false, maxLookaheadDays = MAX_LOOKAHEAD_DAYS } = options;
  const start = includeFrom ? 0 : 1;

  for (let offset = start; offset <= maxLookaheadDays; offset++) {
    const candidate = atLocalMidnight(from);
    candidate.setDate(candidate.getDate() + offset);
    if (isTrainingDate(schedule, candidate)) return { date: candidate, offsetDays: offset };
  }
  return null;
}

/** Every scheduled date in [start, end] (inclusive), in calendar order. */
export function scheduledDatesBetween(
  schedule: TrainingSchedule,
  start: Date,
  end: Date
): Date[] {
  const dates: Date[] = [];
  const cursor = atLocalMidnight(start);
  const last = atLocalMidnight(end);

  while (cursor.getTime() <= last.getTime()) {
    if (isTrainingDate(schedule, cursor)) dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

// ============================================================
// Split rotation
// ============================================================

export interface TodayWorkout {
  dayName: string;
  muscles: MuscleGroup[];
  dayNumber: number;
}

/** The split-day rotation for each split type. */
function getSplitRotation(splitType: string): { dayName: string; muscles: MuscleGroup[] }[] {
  const splits: Record<string, { dayName: string; muscles: MuscleGroup[] }[]> = {
    'Full Body': [
      { dayName: 'Full Body A', muscles: ['chest', 'back', 'quads', 'shoulders', 'triceps'] },
      { dayName: 'Full Body B', muscles: ['back', 'hamstrings', 'glutes', 'biceps', 'calves'] },
      { dayName: 'Full Body C', muscles: ['chest', 'quads', 'shoulders', 'biceps', 'abs'] },
    ],
    'Upper/Lower': [
      { dayName: 'Upper A', muscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] },
      { dayName: 'Lower A', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
      { dayName: 'Upper B', muscles: ['back', 'chest', 'shoulders', 'triceps', 'biceps'] },
      { dayName: 'Lower B', muscles: ['hamstrings', 'quads', 'glutes', 'calves', 'abs'] },
    ],
    'PPL': [
      { dayName: 'Push', muscles: ['chest', 'shoulders', 'triceps'] },
      { dayName: 'Pull', muscles: ['back', 'biceps', 'shoulders'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
      { dayName: 'Push 2', muscles: ['chest', 'shoulders', 'triceps'] },
      { dayName: 'Pull 2', muscles: ['back', 'biceps', 'shoulders'] },
      { dayName: 'Legs 2', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    'Arnold': [
      { dayName: 'Chest & Back', muscles: ['chest', 'back'] },
      { dayName: 'Shoulders & Arms', muscles: ['shoulders', 'biceps', 'triceps'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    'Bro Split': [
      { dayName: 'Chest', muscles: ['chest'] },
      { dayName: 'Back', muscles: ['back'] },
      { dayName: 'Shoulders', muscles: ['shoulders'] },
      { dayName: 'Arms', muscles: ['biceps', 'triceps'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
    ],
  };

  return splits[splitType] || splits['Upper/Lower'];
}

/**
 * The scheduled workout for a calendar date, or null on a rest day.
 *
 * Works for both schedule modes: a fixed-day schedule maps the weekday to its
 * position in the week, an every-N-days schedule counts sessions from the
 * anchor so the split keeps rotating instead of re-pinning to weekdays.
 */
export function getWorkoutForDate(
  splitType: string,
  date: Date,
  schedule: TrainingSchedule
): TodayWorkout | null {
  const slot = resolveScheduledSlot(schedule, date);
  if (!slot) return null;

  const rotation = getSplitRotation(splitType);
  return {
    ...rotation[slot.ordinal % rotation.length],
    // Fixed-day schedules keep their historical 1-based position in the week;
    // interval ordinals grow without bound, so wrap them into the week.
    dayNumber:
      schedule.mode === 'interval'
        ? (slot.ordinal % Math.max(1, schedule.daysPerWeek)) + 1
        : slot.ordinal + 1,
  };
}

/**
 * Weekday-based convenience wrapper for fixed-day schedules.
 * Prefer getWorkoutForDate — it is the only form that can express an
 * every-N-days cadence.
 */
export function getWorkoutForDay(
  splitType: string,
  dayOfWeek: number,
  daysPerWeek: number,
  preferredWorkoutDays?: WorkoutDay[] | null
): TodayWorkout | null {
  const trainingDays = getTrainingDays(daysPerWeek, preferredWorkoutDays);
  const dayIndex = trainingDays.indexOf(dayOfWeek);
  if (dayIndex === -1) return null; // Rest day

  const rotation = getSplitRotation(splitType);
  return {
    ...rotation[dayIndex % rotation.length],
    dayNumber: dayIndex + 1,
  };
}

// ============================================================
// Display
// ============================================================

/** Average sessions per week — 3.5 for every other day, not rounded. */
export function sessionsPerWeek(schedule: TrainingSchedule): number {
  if (schedule.mode === 'interval' && schedule.intervalDays) {
    return 7 / schedule.intervalDays;
  }
  return schedule.preferredWorkoutDays?.length || schedule.daysPerWeek;
}

function formatSessionsPerWeek(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Human-readable summary, e.g. "Every other day (~3.5 sessions/week)" or
 * "Mon, Tue, Thu, Fri".
 */
export function describeTrainingSchedule(
  schedule: TrainingSchedule,
  options: { short?: boolean } = {}
): string {
  if (schedule.mode === 'interval' && schedule.intervalDays) {
    const cadence =
      schedule.intervalDays === 2
        ? 'Every other day'
        : `Every ${schedule.intervalDays} days`;
    return options.short
      ? cadence
      : `${cadence} (~${formatSessionsPerWeek(sessionsPerWeek(schedule))} sessions/week)`;
  }

  const days = schedule.preferredWorkoutDays?.length
    ? [...schedule.preferredWorkoutDays].sort(
        (a, b) => DAYS_OF_WEEK.indexOf(a) - DAYS_OF_WEEK.indexOf(b)
      )
    : getTrainingDays(schedule.daysPerWeek).map(numberToDayName);

  return days.map((day) => (options.short ? day.slice(0, 3) : day)).join(', ');
}
