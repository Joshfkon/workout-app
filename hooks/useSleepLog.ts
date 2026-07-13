'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import { fetchRecentSleep, upsertSleepEntry } from '@/lib/sleep/sleepLog';
import { getLocalDateString } from '@/lib/utils';
import type { SleepLogEntry, SleepQuality } from '@/types/schema';

/**
 * useSleepLog — trailing sleep entries for the home Sleep card, the check-in
 * prefill and the recovery hooks' sleep window multiplier.
 *
 * One React Query key per user; the card, the quick-log sheet and both
 * recovery hooks all read this cache, and `logSleep` updates it in place so
 * every surface reflects a save immediately. Entries are newest-first.
 */

/** Exported so writers outside the hook (the daily check-in's dual-write)
 *  can invalidate the shared cache. */
export const SLEEP_LOG_QUERY_KEY_PREFIX = 'sleep-log';
const QUERY_KEY_PREFIX = SLEEP_LOG_QUERY_KEY_PREFIX;

/** Days fetched: covers the card's 7-day view + the recovery lookback. */
const SLEEP_FETCH_DAYS = 14;

export interface UseSleepLogResult {
  /** Trailing entries, newest first. */
  entries: SleepLogEntry[];
  /** Entry for today or yesterday's local day ("last night"), if logged. */
  lastNight: SleepLogEntry | null;
  /** Most recent entry regardless of age — the stepper's default. */
  lastEntry: SleepLogEntry | null;
  /** Mean hours over the trailing 7 local days (null with no entries). */
  sevenDayAvgHours: number | null;
  isLoading: boolean;
  /** Upsert one local day's entry (source 'manual') and sync the cache. */
  logSleep: (entry: { localDay: string; hours: number; quality: SleepQuality }) => Promise<void>;
}

export function useSleepLog(): UseSleepLogResult {
  const { user: storeUser } = useUserStore();
  const { user: authUser } = useAuthUser();
  const userId = storeUser?.id || authUser?.id || null;
  const queryClient = useQueryClient();

  const query = useQuery<SleepLogEntry[]>({
    queryKey: [QUERY_KEY_PREFIX, userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = createUntypedClient();
      return fetchRecentSleep(supabase, userId!, SLEEP_FETCH_DAYS);
    },
  });

  const entries = query.data ?? EMPTY_ENTRIES;

  const { lastNight, lastEntry, sevenDayAvgHours } = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const todayStr = getLocalDateString(today);
    const yesterdayStr = getLocalDateString(yesterday);
    const weekCutoff = new Date(today);
    weekCutoff.setDate(weekCutoff.getDate() - 6);
    const weekCutoffStr = getLocalDateString(weekCutoff);

    const last = entries.length > 0 ? entries[0] : null;
    const night =
      last && (last.localDay === todayStr || last.localDay === yesterdayStr) ? last : null;

    const week = entries.filter((e) => e.localDay >= weekCutoffStr && e.localDay <= todayStr);
    const avg =
      week.length > 0 ? week.reduce((sum, e) => sum + e.hours, 0) / week.length : null;

    return { lastNight: night, lastEntry: last, sevenDayAvgHours: avg };
  }, [entries]);

  const logSleep = useCallback(
    async (entry: { localDay: string; hours: number; quality: SleepQuality }) => {
      if (!userId) return;
      const supabase = createUntypedClient();
      await upsertSleepEntry(supabase, userId, entry);
      // Replace-or-insert into the cached list (newest first) — a same-day
      // save EDITS the entry, mirroring the DB's one-row-per-day upsert.
      queryClient.setQueryData<SleepLogEntry[]>([QUERY_KEY_PREFIX, userId], (prev) => {
        const next = (prev ?? []).filter((e) => e.localDay !== entry.localDay);
        next.push({ ...entry, source: 'manual' });
        next.sort((a, b) => b.localDay.localeCompare(a.localDay));
        return next;
      });
    },
    [userId, queryClient]
  );

  return {
    entries,
    lastNight,
    lastEntry,
    sevenDayAvgHours,
    isLoading: query.isLoading,
    logSleep,
  };
}

const EMPTY_ENTRIES: SleepLogEntry[] = [];
