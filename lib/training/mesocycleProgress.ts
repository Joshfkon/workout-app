// ============================================================
// MESOCYCLE PROGRESS
// Pure week-advancement helpers for mesocycles. The app advances by COMPLETED
// SESSIONS (see computeCurrentWeekFromSessions) so progression tracks actual
// training, not the calendar. A date-based variant is kept for reference.
// No DB access — callers fetch the inputs and persist the result.
// ============================================================

import { getLocalDateString } from '@/lib/utils';

/**
 * Parse a YYYY-MM-DD date string as a LOCAL date (midnight local time).
 * Avoids the UTC shift that `new Date('YYYY-MM-DD')` introduces.
 */
function parseLocalDate(dateStr: string): Date {
  // Take only the date portion in case a timestamp was passed.
  const [y, m, d] = dateStr.slice(0, 10).split('-').map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

export interface CurrentWeekResult {
  /** 1-based current week, clamped to [1, totalWeeks]. */
  week: number;
  /** True once the full mesocycle duration has elapsed. */
  isComplete: boolean;
}

/**
 * Compute the effective current week of a mesocycle from its start date,
 * using LOCAL dates (not UTC).
 *
 * week = clamp(floor(daysSinceStart / 7) + 1, 1, totalWeeks)
 * isComplete = daysSinceStart >= totalWeeks * 7
 *
 * @param startDate YYYY-MM-DD (DATE column) the mesocycle started on.
 * @param totalWeeks Number of weeks in the program (>= 1).
 * @param today Optional override for "now" (used in tests).
 */
export function computeCurrentWeek(
  startDate: string,
  totalWeeks: number,
  today: Date = new Date()
): CurrentWeekResult {
  const safeTotalWeeks = Math.max(1, Math.floor(totalWeeks || 1));

  // Normalize both ends to local midnight so partial days don't skew the count.
  const start = parseLocalDate(startDate);
  const now = parseLocalDate(getLocalDateString(today));

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysSinceStart = Math.floor((now.getTime() - start.getTime()) / msPerDay);

  const rawWeek = Math.floor(Math.max(0, daysSinceStart) / 7) + 1;
  const week = Math.min(Math.max(rawWeek, 1), safeTotalWeeks);
  const isComplete = daysSinceStart >= safeTotalWeeks * 7;

  return { week, isComplete };
}

/**
 * Compute the effective current week from the number of COMPLETED sessions in the
 * mesocycle, so progression follows actual training rather than the calendar.
 * A week advances once the user has completed `daysPerWeek` sessions, and the
 * block completes after `totalWeeks * daysPerWeek` sessions.
 *
 * week = clamp(floor(completedSessions / daysPerWeek) + 1, 1, totalWeeks)
 * isComplete = completedSessions >= totalWeeks * daysPerWeek
 *
 * @param completedSessions Count of completed workout sessions for the mesocycle.
 * @param daysPerWeek Planned training days per week (>= 1).
 * @param totalWeeks Number of weeks in the program (>= 1).
 */
export function computeCurrentWeekFromSessions(
  completedSessions: number,
  daysPerWeek: number,
  totalWeeks: number
): CurrentWeekResult {
  const safeTotalWeeks = Math.max(1, Math.floor(totalWeeks || 1));
  const safeDaysPerWeek = Math.max(1, Math.floor(daysPerWeek || 1));
  const safeCompleted = Math.max(0, Math.floor(completedSessions || 0));

  const rawWeek = Math.floor(safeCompleted / safeDaysPerWeek) + 1;
  const week = Math.min(Math.max(rawWeek, 1), safeTotalWeeks);
  const isComplete = safeCompleted >= safeTotalWeeks * safeDaysPerWeek;

  return { week, isComplete };
}
