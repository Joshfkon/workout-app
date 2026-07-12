'use client';

/**
 * React Query hooks for the Eat tab's month calendar sheet.
 *
 * Two query families:
 *  - ['nutrition','month', 'YYYY-MM'] — ONE aggregate food_log query for the
 *    whole visible month (logged_at + calories, summed per day client-side).
 *    Never a per-day fetch: paging a 31-day month costs exactly one round
 *    trip. Past months are immutable-in-practice (long staleTime); the
 *    current month gets a short staleTime, and the sheet overlays today's
 *    live totals from the day cache anyway.
 *  - ['nutrition','phase-history'] — the user's phase-change log (small,
 *    date-independent, fetched once). Missing table / error degrades to []
 *    and the calendar falls back to the current phase for every day.
 *
 * Both keys are 'nutrition'-prefixed so lib/query/idbPersister.ts persists
 * them to IndexedDB — reopening the calendar on a cold start paints from disk.
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';
import { normalizePacingPhase } from '@/services/intakePacing';
import type { PhaseHistoryEntry } from '@/services/nutritionCalendar';

const CURRENT_MONTH_STALE_TIME = 1000 * 60 * 5; // 5 min — still being logged
const PHASE_HISTORY_STALE_TIME = 1000 * 60 * 5;

export function nutritionMonthKey(monthKey: string) {
  return ['nutrition', 'month', monthKey] as const;
}

export const NUTRITION_PHASE_HISTORY_KEY = ['nutrition', 'phase-history'] as const;

export interface NutritionMonthData {
  /** Calorie totals keyed by YYYY-MM-DD — only days with ≥1 log entry. */
  dayCalories: Record<string, number>;
}

/** Last calendar day of a 'YYYY-MM' month, as YYYY-MM-DD. */
function monthEndKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthKey}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * The one aggregate query per visible month: every food_log row in the date
 * range, reduced to per-day calorie totals. A day whose entries sum to 0
 * still counts as logged (key present) — how to grade it is the calendar
 * engine's call, not the fetcher's.
 */
export async function fetchNutritionMonth(monthKey: string): Promise<NutritionMonthData> {
  const supabase = createUntypedClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { dayCalories: {} };

  const { data, error } = await supabase
    .from('food_log')
    .select('logged_at, calories')
    .eq('user_id', user.id)
    .gte('logged_at', `${monthKey}-01`)
    .lte('logged_at', monthEndKey(monthKey));
  if (error) throw error;

  const dayCalories: Record<string, number> = {};
  for (const row of (data || []) as Array<{ logged_at: string | null; calories: number | null }>) {
    if (!row.logged_at) continue;
    dayCalories[row.logged_at] = (dayCalories[row.logged_at] || 0) + (row.calories || 0);
  }
  return { dayCalories };
}

export function useNutritionMonth(monthKey: string | null, enabled: boolean) {
  const currentMonthKey = getLocalDateString().slice(0, 7);
  const isPastMonth = !!monthKey && monthKey < currentMonthKey;
  return useQuery({
    queryKey: nutritionMonthKey(monthKey ?? '__none__'),
    queryFn: () => fetchNutritionMonth(monthKey as string),
    enabled: enabled && !!monthKey,
    staleTime: isPastMonth ? IMMUTABLE_GC_TIME : CURRENT_MONTH_STALE_TIME,
    gcTime: IMMUTABLE_GC_TIME,
    // Month paging keeps the previous month's grid up instead of blanking.
    placeholderData: keepPreviousData,
  });
}

export async function fetchPhaseHistory(): Promise<PhaseHistoryEntry[]> {
  const supabase = createUntypedClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('phase_history')
    .select('phase, started_on')
    .eq('user_id', user.id)
    .order('started_on', { ascending: true });
  // Degrade gracefully (e.g. table not migrated yet): no history means the
  // calendar grades every day against the current phase.
  if (error) return [];

  return ((data || []) as Array<{ phase: string; started_on: string }>).map((row) => ({
    phase: normalizePacingPhase(row.phase),
    startedOn: row.started_on,
  }));
}

export function usePhaseHistory(enabled: boolean) {
  return useQuery({
    queryKey: NUTRITION_PHASE_HISTORY_KEY,
    queryFn: fetchPhaseHistory,
    enabled,
    staleTime: PHASE_HISTORY_STALE_TIME,
    gcTime: IMMUTABLE_GC_TIME,
  });
}
