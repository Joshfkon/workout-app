/**
 * "2/4 sessions" header context: how many of this mesocycle-week's sessions
 * are done. Shared by the dashboard's server initial-data path and the client
 * full-fetch path (same pattern as weeklyVolume.ts). Pure.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface WeekSessionRow {
  planned_date: string | null;
  state: string | null;
  completed_at: string | null;
}

export interface WeekSessions {
  done: number;
  total: number;
}

/**
 * Count completed vs expected sessions inside the current mesocycle week
 * (weeks run in 7-day windows from start_date). Expected = sessions planned
 * in the window, falling back to days_per_week when none are scheduled yet
 * (sessions can be generated lazily).
 */
export function computeWeekSessions(
  sessions: WeekSessionRow[],
  startDate: string,
  currentWeek: number,
  daysPerWeek: number
): WeekSessions | null {
  const startMs = Date.parse(startDate);
  if (Number.isNaN(startMs)) return null;

  const weekStart = startMs + (Math.max(1, currentWeek) - 1) * WEEK_MS;
  const weekEnd = weekStart + WEEK_MS;
  const inWindow = (ms: number) => ms >= weekStart && ms < weekEnd;

  let planned = 0;
  let done = 0;
  for (const session of sessions) {
    const plannedMs = session.planned_date ? Date.parse(session.planned_date) : NaN;
    const plannedInWindow = !Number.isNaN(plannedMs) && inWindow(plannedMs);
    if (plannedInWindow) planned++;

    if (session.state === 'completed') {
      const completedMs = session.completed_at ? Date.parse(session.completed_at) : NaN;
      if (plannedInWindow || (!Number.isNaN(completedMs) && inWindow(completedMs))) done++;
    }
  }

  const total = Math.max(planned > 0 ? planned : daysPerWeek || 0, done);
  if (total === 0) return null;
  return { done: Math.min(done, total), total };
}
