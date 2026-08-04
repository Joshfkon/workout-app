'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import { fetchSleepForDays } from '@/lib/sleep/sleepLog';
import { SLEEP_LOG_QUERY_KEY_PREFIX } from '@/hooks/useSleepLog';
import type { SleepLogEntry } from '@/types/schema';

/**
 * useSleepForDays — sleep entries for an ARBITRARY set of past local days,
 * keyed by day.
 *
 * `useSleepLog` covers the trailing two weeks (today's card + recovery
 * lookback). This hook exists for the other direction: the workout page's
 * "Last Workout" blocks reference sessions that may be months old, so their
 * nights fall outside any trailing window and must be fetched by exact day.
 *
 * The query key includes the sorted day list, so switching exercises (or a
 * history refresh moving a date) refetches rather than serving another day's
 * entry. Past nights are immutable in practice — they change only when the user
 * edits one — so the window is cached for the length of a session.
 */
export function useSleepForDays(localDays: string[]): Record<string, SleepLogEntry> {
  const { user: storeUser } = useUserStore();
  const { user: authUser } = useAuthUser();
  const userId = storeUser?.id || authUser?.id || null;

  // Stable identity: the same set of days in any order is the same query.
  const days = useMemo(
    () => Array.from(new Set(localDays.filter(Boolean))).sort(),
    [localDays]
  );
  const daysKey = days.join(',');

  const query = useQuery<Record<string, SleepLogEntry>>({
    queryKey: [SLEEP_LOG_QUERY_KEY_PREFIX, 'days', userId, daysKey],
    enabled: !!userId && days.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const supabase = createUntypedClient();
      return fetchSleepForDays(supabase, userId!, days);
    },
  });

  return query.data ?? EMPTY_BY_DAY;
}

const EMPTY_BY_DAY: Record<string, SleepLogEntry> = {};
