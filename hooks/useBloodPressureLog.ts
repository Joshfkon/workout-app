'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import {
  fetchRecentBloodPressure,
  insertBloodPressureEntry,
  deleteBloodPressureEntry,
} from '@/lib/bloodPressure/bloodPressureLog';
import {
  averageReadings,
  classifyBloodPressure,
  filterByPeriod,
  type BloodPressureAverage,
  type BloodPressureCategory,
} from '@/services/bloodPressure';
import type { BloodPressureEntry, BloodPressureInput } from '@/types/schema';

/**
 * useBloodPressureLog — trailing blood-pressure readings for the Wellness BP
 * card and the history/trends page.
 *
 * One React Query key per user; the card and the history page read the same
 * cache, and `logReading` / `deleteReading` update it in place so every
 * surface reflects a write immediately. Entries are newest-first.
 *
 * Prefix 'blood-pressure' is registered in lib/query/queryClient.ts so the
 * cache survives a cold start (paint-from-disk while revalidating).
 */

export const BLOOD_PRESSURE_QUERY_KEY_PREFIX = 'blood-pressure';
const QUERY_KEY_PREFIX = BLOOD_PRESSURE_QUERY_KEY_PREFIX;

/**
 * Days fetched: covers the history page's 90-day filter plus headroom. The
 * "All" filter is a superset that the page fetches separately on demand.
 */
const BP_FETCH_DAYS = 400;

export interface UseBloodPressureLogResult {
  /** Trailing readings, newest first. */
  entries: BloodPressureEntry[];
  /** Most recent reading, if any. */
  latest: BloodPressureEntry | null;
  /** Category of the latest reading (null with no readings). */
  latestCategory: BloodPressureCategory | null;
  /** Mean over the trailing 7 local days (null without readings). */
  sevenDayAverage: BloodPressureAverage | null;
  /** Mean over the trailing 30 local days (null without readings). */
  thirtyDayAverage: BloodPressureAverage | null;
  isLoading: boolean;
  /** Insert one reading and sync the cache. */
  logReading: (input: BloodPressureInput) => Promise<BloodPressureEntry>;
  /** Delete one reading by id and sync the cache. */
  deleteReading: (id: string) => Promise<void>;
}

export function useBloodPressureLog(): UseBloodPressureLogResult {
  const { user: storeUser } = useUserStore();
  const { user: authUser } = useAuthUser();
  const userId = storeUser?.id || authUser?.id || null;
  const queryClient = useQueryClient();

  const query = useQuery<BloodPressureEntry[]>({
    queryKey: [QUERY_KEY_PREFIX, userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = createUntypedClient();
      return fetchRecentBloodPressure(supabase, userId!, BP_FETCH_DAYS);
    },
  });

  const entries = query.data ?? EMPTY_ENTRIES;

  const { latest, latestCategory, sevenDayAverage, thirtyDayAverage } = useMemo(() => {
    const last = entries.length > 0 ? entries[0] : null;
    const week = filterByPeriod(entries, '7d');
    const month = filterByPeriod(entries, '30d');
    return {
      latest: last,
      latestCategory: last ? classifyBloodPressure(last.systolic, last.diastolic) : null,
      sevenDayAverage: averageReadings(week),
      thirtyDayAverage: averageReadings(month),
    };
  }, [entries]);

  const logReading = useCallback(
    async (input: BloodPressureInput) => {
      if (!userId) throw new Error('You need to be signed in to log a reading.');
      const supabase = createUntypedClient();
      const saved = await insertBloodPressureEntry(supabase, userId, input);
      // Insert into the cached list, keeping it newest-first.
      queryClient.setQueryData<BloodPressureEntry[]>([QUERY_KEY_PREFIX, userId], (prev) => {
        const next = [saved, ...(prev ?? [])];
        next.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
        return next;
      });
      return saved;
    },
    [userId, queryClient]
  );

  const deleteReading = useCallback(
    async (id: string) => {
      if (!userId) return;
      const supabase = createUntypedClient();
      await deleteBloodPressureEntry(supabase, id);
      queryClient.setQueryData<BloodPressureEntry[]>([QUERY_KEY_PREFIX, userId], (prev) =>
        (prev ?? []).filter((e) => e.id !== id)
      );
    },
    [userId, queryClient]
  );

  return {
    entries,
    latest,
    latestCategory,
    sevenDayAverage,
    thirtyDayAverage,
    isLoading: query.isLoading,
    logReading,
    deleteReading,
  };
}

const EMPTY_ENTRIES: BloodPressureEntry[] = [];
