/**
 * The Train page's data, as plain rows (pure — no React, no I/O).
 *
 * The page used to fetch-in-useEffect on every visit (a getUser() round
 * trip, a five-query batch, then a SERIAL mesocycle tail) and showed
 * "Loading..." in the plan card and the recent list each time (UX panel r19:
 * "The Train page … loaded slowly"). It is now one persisted React Query
 * (hooks/useTrainPageData) whose payload is these JSON-plain rows; this
 * module turns them into what the page shows, so a payload restored from
 * disk on a later day still derives today's numbers correctly.
 */

import { deriveWorkoutTitle, toRepeatableExercises, type RecentSessionRow, type RepeatableExercise } from '@/lib/training/repeatWorkout';
import type { ActiveMesocycleRow } from '@/lib/training/fetchActiveMesocycle';

export interface TrainInProgressSummary {
  id: string;
  /** null for ad-hoc (blank/quick/AI) sessions. */
  mesocycleId: string | null;
  startedAt: string | null;
  setsDone: number;
  /** exercise_block ids, needed by the discard path. */
  blockIds: string[];
}

export interface TrainWeekSessionRow {
  started_at: string | null;
  completed_at: string;
  duration_seconds: number | null;
}

export interface TrainMesoCompletedRow {
  started_at: string | null;
  planned_date: string | null;
}

/** What the query stores (persisted: JSON-plain rows only). */
export interface TrainPageData {
  /** Local YYYY-MM-DD the payload was fetched on — guards day-scoped fields. */
  date: string;
  userId: string;
  /** Today's unfinished session (planned_date = `date`), if any. */
  inProgress: TrainInProgressSummary | null;
  /** The active mesocycle — null with none, or when training freestyle. */
  activeMeso: ActiveMesocycleRow | null;
  isFreestyle: boolean;
  /** Last 5 completed sessions, newest first. */
  recentRows: RecentSessionRow[];
  /** Completed sessions in the rolling week window. */
  weekRows: TrainWeekSessionRow[];
  /** The active mesocycle's completed sessions, oldest first; null with no mesocycle. */
  mesoCompleted: TrainMesoCompletedRow[] | null;
  /** users.experience, for the progression summary. */
  experience: string | null;
}

export interface RecentWorkout {
  id: string;
  completedAt: Date;
  title: string;
  setCount: number;
  /** null when started_at is missing (can't compute a duration). */
  durationMin: number | null;
  /** Exercise list for the "Repeat previous workout" clone path. */
  exercises: RepeatableExercise[];
}

/**
 * Active workout minutes: the duration_seconds snapshot (pauses excluded)
 * when present, else the completed_at − started_at wall-clock span for legacy
 * sessions without one. Null when neither yields a positive duration.
 */
export function activeDurationMin(row: TrainWeekSessionRow): number | null {
  if (row.duration_seconds != null && row.duration_seconds > 0) {
    return row.duration_seconds / 60;
  }
  if (!row.started_at) return null;
  const min = (new Date(row.completed_at).getTime() - new Date(row.started_at).getTime()) / 60000;
  return min > 0 ? min : null;
}

export function toRecentWorkouts(rows: readonly RecentSessionRow[]): RecentWorkout[] {
  return rows.map((row) => {
    const blocks = row.exercise_blocks ?? [];
    const setCount = blocks.reduce(
      (sum, b) => sum + (b.set_logs ?? []).filter((l) => !l.is_warmup).length,
      0
    );
    const rawDurationMin = activeDurationMin(row);
    const durationMin = rawDurationMin != null ? Math.round(rawDurationMin) : null;
    return {
      id: row.id,
      completedAt: new Date(row.completed_at),
      title: deriveWorkoutTitle(blocks),
      setCount,
      durationMin: durationMin != null && durationMin > 0 ? durationMin : null,
      exercises: toRepeatableExercises(blocks),
    };
  });
}

export interface TrainWeekStats {
  sessionsThisWeek: number;
  /** Time trained over the same window; avgMin null until a session has a usable duration. */
  weekTime: { totalMin: number; avgMin: number | null };
}

/**
 * Sessions and time over the rolling week. `weekStartIso` is re-applied here
 * so a payload fetched on an earlier day never counts sessions that have
 * since left the window.
 */
export function weekStats(rows: readonly TrainWeekSessionRow[], weekStartIso: string): TrainWeekStats {
  const start = new Date(weekStartIso).getTime();
  const inWindow = rows.filter((r) => new Date(r.completed_at).getTime() >= start);
  // Sessions without a usable duration still count as sessions but are
  // dropped from the time math rather than skewing the totals.
  const durationsMin = inWindow.map(activeDurationMin).filter((min): min is number => min !== null);
  const totalMin = durationsMin.reduce((sum, min) => sum + min, 0);
  return {
    sessionsThisWeek: inWindow.length,
    weekTime: { totalMin, avgMin: durationsMin.length > 0 ? totalMin / durationsMin.length : null },
  };
}

export interface TrainMesoProgress {
  /** Completed sessions in the block — drives the next session index. */
  mesoCompletedCount: number | null;
  /** Completed sessions dated today — picks a two-a-day date's next session. */
  completedTodayCount: number;
  /** "Last done": one full cycle (days_per_week sessions) ago in completion order. */
  lastCycleDone: Date | null;
}

export function mesoProgress(
  completed: readonly TrainMesoCompletedRow[] | null,
  daysPerWeek: number | null,
  today: string
): TrainMesoProgress {
  if (!completed || daysPerWeek == null) {
    return { mesoCompletedCount: null, completedTodayCount: 0, lastCycleDone: null };
  }
  const lastCycleIdx = completed.length - daysPerWeek;
  const lastStartedAt = lastCycleIdx >= 0 ? completed[lastCycleIdx]?.started_at : null;
  return {
    mesoCompletedCount: completed.length,
    completedTodayCount: completed.filter((row) => row.planned_date === today).length,
    lastCycleDone: lastStartedAt ? new Date(lastStartedAt) : null,
  };
}
