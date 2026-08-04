// ============================================================
// SLEEP LOG (Phase 1 — manual capture)
//
// DB access for the sleep_log table (one entry per user per LOCAL day).
// Writers ALWAYS upsert on (user_id, local_day): a second save for the same
// day edits the existing row — duplicates are impossible by construction
// (UNIQUE constraint) and by write path. DB access lives here in lib/ (same
// placement as lib/training/deloadRecommendation.ts), NOT in /services.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { getLocalDateString } from '@/lib/utils';
import {
  SLEEP_QUALITIES,
  type SleepLogEntry,
  type SleepQuality,
  type SleepSource,
} from '@/types/schema';

interface SleepLogRow {
  local_day: string;
  hours: number;
  quality: string;
  source: string;
}

function rowToEntry(row: SleepLogRow): SleepLogEntry {
  const quality = (SLEEP_QUALITIES as readonly string[]).includes(row.quality)
    ? (row.quality as SleepQuality)
    : 'ok';
  return {
    localDay: row.local_day,
    hours: Number(row.hours),
    quality,
    source: row.source === 'healthkit' ? 'healthkit' : ('manual' as SleepSource),
  };
}

/**
 * Fetch the trailing `days` of sleep entries (newest first). The window is
 * anchored to the LOCAL day, matching how entries are written.
 */
export async function fetchRecentSleep(
  supabase: SupabaseClient,
  userId: string,
  days: number,
  now: Date = new Date()
): Promise<SleepLogEntry[]> {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const { data, error } = await supabase
    .from('sleep_log')
    .select('local_day, hours, quality, source')
    .eq('user_id', userId)
    .gte('local_day', getLocalDateString(cutoff))
    .order('local_day', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SleepLogRow[]).map(rowToEntry);
}

/**
 * Fetch the entries for a specific set of local days, keyed by day.
 *
 * Unlike `fetchRecentSleep` this is not a trailing window: the days come from
 * past sessions (a "last workout" can be months old), so they're queried by
 * exact match. Days absent from the result simply weren't logged.
 */
export async function fetchSleepForDays(
  supabase: SupabaseClient,
  userId: string,
  localDays: string[]
): Promise<Record<string, SleepLogEntry>> {
  const days = Array.from(new Set(localDays.filter(Boolean)));
  if (days.length === 0) return {};
  const { data, error } = await supabase
    .from('sleep_log')
    .select('local_day, hours, quality, source')
    .eq('user_id', userId)
    .in('local_day', days);
  if (error) throw new Error(error.message);
  const byDay: Record<string, SleepLogEntry> = {};
  for (const row of (data ?? []) as SleepLogRow[]) {
    const entry = rowToEntry(row);
    byDay[entry.localDay] = entry;
  }
  return byDay;
}

/**
 * The user's most recent entry regardless of age — the stepper's default
 * ("default = last entry") so re-logging a typical night is one tap.
 */
export async function fetchLastSleepEntry(
  supabase: SupabaseClient,
  userId: string
): Promise<SleepLogEntry | null> {
  const { data, error } = await supabase
    .from('sleep_log')
    .select('local_day, hours, quality, source')
    .eq('user_id', userId)
    .order('local_day', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToEntry(data as SleepLogRow) : null;
}

/**
 * Save (or edit) the entry for one local day. Manual saves stamp
 * source='manual' — in Phase 2 this is what lets a hand entry override a
 * HealthKit-imported row for the same day.
 */
export async function upsertSleepEntry(
  supabase: SupabaseClient,
  userId: string,
  entry: { localDay: string; hours: number; quality: SleepQuality }
): Promise<void> {
  const { error } = await supabase.from('sleep_log').upsert(
    {
      user_id: userId,
      local_day: entry.localDay,
      hours: entry.hours,
      quality: entry.quality,
      source: 'manual',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,local_day' }
  );
  if (error) throw new Error(error.message);
}
