/**
 * Display formatting for sleep durations — one convention app-wide so the
 * home Sleep tile and the workout page's "Last Workout" context line can't
 * drift apart ("7.5h" here, "7.50 hrs" there).
 */

import type { SleepQuality } from '@/types/schema';

/** Hours as "8h" / "7.5h" — whole numbers stay whole, otherwise one decimal. */
export function formatSleepHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/** User-facing name for a logged quality. Re-exported by SleepQuickLog. */
export const SLEEP_QUALITY_LABELS: Record<SleepQuality, string> = {
  poor: 'Poor',
  ok: 'OK',
  good: 'Good',
};
