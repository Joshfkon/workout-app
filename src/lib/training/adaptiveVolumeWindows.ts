/**
 * Time windows and per-set effort for the adaptive-volume hook
 * (hooks/useAdaptiveVolume). Pure — no React, no Supabase — so the two things
 * that were wrong in the hook are testable here:
 *
 *  1. WINDOWS ARE INSTANTS, NOT BARE DATES. `workout_sessions.completed_at` is
 *     a timestamptz. Filtering it with a bare local `YYYY-MM-DD` makes Postgres
 *     read the bound as midnight UTC, so west of Greenwich a session finished
 *     the evening BEFORE the window opened was counted in the current week —
 *     and, because the previous window's upper bound was a correct instant, in
 *     the previous week too. Every bound here is a local-midnight instant, the
 *     same convention as `weeklyVolumeWindowStartISO` / `useWeeklyVolume`.
 *
 *  2. THE WINDOWS TILE. Each window is [start, end) with the next one's start
 *     as its end, stepped by CALENDAR days (never +24h), so no session can
 *     land in two weeks or fall between them across a DST change.
 */
import { rollingWindowStart, startOfLocalDay, localDay } from '@/lib/date/localDay';
import { now as clockNow } from '@/lib/clock';
import { rpeToRir } from '@/types/schema';

/** Length of one adaptive-volume window, in local calendar days. */
export const ADAPTIVE_VOLUME_WINDOW_DAYS = 7;

/**
 * How many consecutive windows the hook reads. Three, because the fatigue
 * monitor (`assessCurrentFatigueStatus`) needs at least two weeks per muscle
 * to say anything and three to measure RIR drift.
 */
export const ADAPTIVE_VOLUME_HISTORY_WEEKS = 3;

export interface AdaptiveVolumeWindow {
  /** Inclusive lower bound (local midnight), as an ISO instant. */
  startISO: string;
  /** Exclusive upper bound (local midnight), as an ISO instant. */
  endISO: string;
  /** The window's first local day, `YYYY-MM-DD` — for labels/ids only. */
  startDay: string;
}

/**
 * The trailing windows ending today, NEWEST FIRST: index 0 is the rolling
 * 7 local days including today, index 1 the 7 days before that, and so on.
 */
export function adaptiveVolumeWindows(
  now: Date = clockNow(),
  weeks: number = ADAPTIVE_VOLUME_HISTORY_WEEKS
): AdaptiveVolumeWindow[] {
  const windows: AdaptiveVolumeWindow[] = [];
  // Exclusive end of the newest window: local midnight starting TOMORROW.
  let end = startOfLocalDay(now);
  end.setDate(end.getDate() + 1);
  let start = rollingWindowStart(ADAPTIVE_VOLUME_WINDOW_DAYS, now);

  for (let i = 0; i < weeks; i++) {
    windows.push({
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      startDay: localDay(start),
    });
    end = start;
    const previousStart = new Date(start);
    previousStart.setDate(previousStart.getDate() - ADAPTIVE_VOLUME_WINDOW_DAYS);
    start = previousStart;
  }
  return windows;
}

/**
 * Index of the window an instant falls in, or -1 when it is outside all of
 * them (or unparseable). Windows are half-open, so the answer is unique.
 */
export function adaptiveVolumeWindowIndex(
  completedAt: string | null | undefined,
  windows: AdaptiveVolumeWindow[]
): number {
  if (!completedAt) return -1;
  const t = Date.parse(completedAt);
  if (!Number.isFinite(t)) return -1;
  return windows.findIndex((w) => t >= Date.parse(w.startISO) && t < Date.parse(w.endISO));
}

/**
 * Reps in reserve for one logged set: the RIR chip the lifter tapped when
 * there is one, else the stored RPE through the app's single RPE→RIR
 * conversion (`rpeToRir`), else `fallback`. The old `10 - rpe` read the RIR-2
 * chip (stored RPE 7.5) as 2.5.
 */
export function setRirOrFallback(
  set: { rpe?: number | null; feedback?: { repsInTank?: number | null } | null },
  fallback: number
): number {
  const logged = set.feedback?.repsInTank;
  if (logged != null) return logged;
  if (set.rpe) return rpeToRir(set.rpe);
  return fallback;
}
