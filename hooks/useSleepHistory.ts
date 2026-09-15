'use client';

import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import { fetchRecentSleep } from '@/lib/sleep/sleepLog';
import { SLEEP_LOG_QUERY_KEY_PREFIX } from '@/hooks/useSleepLog';
import type { SleepLogEntry } from '@/types/schema';

/**
 * useSleepHistory — trailing sleep entries for the /dashboard/sleep detail
 * page's graph and stats.
 *
 * `useSleepLog` deliberately fetches only two weeks (the home card + recovery
 * lookback); the detail page charts up to three months, so it gets its own
 * window under the same query-key prefix. Saves made through `useSleepLog`
 * (the quick-log sheet) invalidate by that prefix, which covers this key too,
 * so a log from the detail page lands on the chart without extra wiring.
 */
const HISTORY_DAYS = 90;

export function useSleepHistory(): { entries: SleepLogEntry[]; isLoading: boolean } {
  const { user: storeUser } = useUserStore();
  const { user: authUser } = useAuthUser();
  const userId = storeUser?.id || authUser?.id || null;

  const query = useQuery<SleepLogEntry[]>({
    queryKey: [SLEEP_LOG_QUERY_KEY_PREFIX, 'history', userId, HISTORY_DAYS],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = createUntypedClient();
      return fetchRecentSleep(supabase, userId!, HISTORY_DAYS);
    },
  });

  return { entries: query.data ?? EMPTY_ENTRIES, isLoading: query.isLoading };
}

const EMPTY_ENTRIES: SleepLogEntry[] = [];
