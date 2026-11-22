'use client';

import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';

/**
 * Persisted ('analytics' prefix) so a revisit decides the Progress page's
 * default tab from cache on first paint. Two one-row existence probes —
 * nothing here blocks rendering.
 */
export const BODY_OR_FOOD_LOGGED_QUERY_KEY = ['analytics', 'body-or-food-logged'] as const;

/**
 * Whether the user has ever logged a weigh-in or a food entry. Null when
 * signed out. A failed probe counts as "no" for that source rather than
 * failing the query: it only picks a default tab.
 */
export async function fetchBodyOrFoodLogged(): Promise<boolean | null> {
  const supabase = createUntypedClient();
  const userId = await getLocalUserId(supabase);
  if (!userId) return null;

  const [weightRes, foodRes] = await Promise.all([
    supabase.from('weight_log').select('logged_at').eq('user_id', userId).limit(1),
    supabase.from('food_log').select('logged_at').eq('user_id', userId).limit(1),
  ]);
  const hasWeighIn = !weightRes.error && (weightRes.data?.length ?? 0) > 0;
  const hasFood = !foodRes.error && (foodRes.data?.length ?? 0) > 0;
  return hasWeighIn || hasFood;
}

export function useBodyOrFoodLogged() {
  return useQuery({
    queryKey: BODY_OR_FOOD_LOGGED_QUERY_KEY,
    queryFn: fetchBodyOrFoodLogged,
    staleTime: 1000 * 60 * 5,
    gcTime: IMMUTABLE_GC_TIME,
  });
}
