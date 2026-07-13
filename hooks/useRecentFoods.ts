'use client';

/**
 * useRecentFoods — the single food_log query that backs BOTH the "Recent" and
 * "Meals" views of the add-food flow.
 *
 * ONE indexed query over the user's food_log (last RECENTS_WINDOW_DAYS days,
 * newest first) with all derivation done client-side:
 *   - recents  = dedupeRecentFoods(rows)      (deduped, most-recent snapshot)
 *   - meals    = groupPriorMeals(rows)         (grouped day → meal)
 * so browsing prior meals never fans out into N per-day queries.
 *
 * 'nutrition'-prefixed key so lib/query/idbPersister persists it to IndexedDB —
 * the add-food sheet paints its Recent list from disk on a cold open while it
 * revalidates. Kept in sync with new logs via invalidation on the Eat page
 * (see handleAddFood / applyInsertedEntries invalidating this key), matching the
 * cached-first convention.
 */

import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { getLocalDateString } from '@/lib/utils';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';
import { RECENTS_WINDOW_DAYS } from '@/lib/nutrition/recentFoods';
import type { FoodLogEntry } from '@/types/nutrition';

const RECENTS_STALE_TIME = 1000 * 60 * 5; // 5 min — recents shift as the user logs

export const RECENT_FOODS_KEY = ['nutrition', 'recent-foods'] as const;

export async function fetchRecentFoodLog(): Promise<FoodLogEntry[]> {
  const supabase = createUntypedClient();
  // Local-session identity (no auth round trip) — a transient getUser()
  // failure must not be cached as "no recent foods". See lib/supabase/authState.
  const userId = await getLocalUserId(supabase);
  if (!userId) return [];

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - (RECENTS_WINDOW_DAYS - 1));

  const { data, error } = await supabase
    .from('food_log')
    .select('*')
    .eq('user_id', userId)
    .gte('logged_at', getLocalDateString(windowStart))
    .order('logged_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as FoodLogEntry[];
}

/**
 * @param enabled Gate the query so it only runs once the add-food flow has been
 *   opened (the recents window is a wider read than the per-day query, so we
 *   don't want it on every Eat page mount).
 */
export function useRecentFoods(enabled: boolean) {
  return useQuery({
    queryKey: RECENT_FOODS_KEY,
    queryFn: fetchRecentFoodLog,
    enabled,
    staleTime: RECENTS_STALE_TIME,
    gcTime: IMMUTABLE_GC_TIME,
  });
}
