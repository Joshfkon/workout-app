// ============================================================
// EATING WINDOW READ/WRITE
//
// The user's eating window (drives intake pacing) lives on their
// nutrition_targets row as minutes-from-midnight columns. Both helpers
// tolerate databases that predate the 20260709000001_eating_window
// migration: reads fall back to the 07:00–21:00 default, writes retry
// without the window columns (same ship-before-migrate pattern as
// lib/body/bodyLog).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_EATING_WINDOW, type EatingWindow } from '@/services/intakePacing';

function isValidWindow(start: unknown, end: unknown): start is number {
  return (
    typeof start === 'number' &&
    typeof end === 'number' &&
    start >= 0 &&
    end <= 1440 &&
    end > start
  );
}

/**
 * The user's eating window, or the 07:00–21:00 default when unset,
 * unmigrated, or unreadable. Never throws.
 */
export async function fetchEatingWindow(
  supabase: SupabaseClient,
  userId: string
): Promise<EatingWindow> {
  const { data, error } = await supabase
    .from('nutrition_targets')
    .select('eating_window_start_min, eating_window_end_min')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return DEFAULT_EATING_WINDOW;
  const { eating_window_start_min: start, eating_window_end_min: end } = data as {
    eating_window_start_min: number | null;
    eating_window_end_min: number | null;
  };
  if (!isValidWindow(start, end)) return DEFAULT_EATING_WINDOW;
  return { startMinutes: start, endMinutes: end as number };
}

/**
 * Persist the eating window (upserts the user's nutrition_targets row).
 * Throws on failure — including when the columns don't exist yet.
 */
export async function saveEatingWindow(
  supabase: SupabaseClient,
  userId: string,
  window: EatingWindow
): Promise<void> {
  const { error } = await supabase.from('nutrition_targets').upsert(
    {
      user_id: userId,
      eating_window_start_min: window.startMinutes,
      eating_window_end_min: window.endMinutes,
    },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
}

/** "07:00"-style value for <input type="time"> from minutes-of-day. */
export function minutesToTimeValue(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Minutes-of-day from an <input type="time"> value; null when unparsable. */
export function timeValueToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 1440 ? minutes : null;
}
