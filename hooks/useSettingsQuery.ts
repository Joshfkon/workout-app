'use client';

import { useContext, useEffect } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';

/**
 * The Settings page's data: the users row plus the latest weigh-in, cached
 * under ['settings', 'user'] (a persisted prefix). Shared by the page and
 * the prefetch below so both use the same key, fetcher and freshness.
 */
export const SETTINGS_KEY = ['settings', 'user'] as const;

// Kept as '*': two columns Settings reads/writes (`age`, `training_age`) are
// not created by any migration in the repo, so naming them explicitly would
// turn schema drift into a hard load failure (PostgREST 42703).
const SETTINGS_USER_SELECT = '*';

export const SETTINGS_STALE_TIME = 1000 * 60;
export const SETTINGS_GC_TIME = IMMUTABLE_GC_TIME;

export interface SettingsBundle {
  userId: string;
  // The page reads the row loosely (several columns aren't in the generated types).
  userRow: any;
  latestWeightLog: { weight: number | string; unit: string | null; logged_at: string } | null;
}

export async function fetchSettingsBundle(): Promise<SettingsBundle | null> {
  const supabase = createUntypedClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  // A failed read must FAIL the query, not be cached as "this user has no
  // row": the form then showed defaults, and Save upserted those defaults
  // over the real goal / experience / landmarks / equipment / injuries
  // (and dropped every preferences key it didn't know about). maybeSingle
  // so a genuinely missing row / empty weight log is null, not an error.
  const [userResult, weightResult] = await Promise.all([
    supabase.from('users').select(SETTINGS_USER_SELECT).eq('id', user.id).maybeSingle(),
    supabase
      .from('weight_log')
      .select('weight, unit, logged_at')
      .eq('user_id', user.id)
      .order('logged_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (userResult.error) throw userResult.error;
  if (weightResult.error) throw weightResult.error;
  return { userId: user.id, userRow: userResult.data, latestWeightLog: weightResult.data };
}

/**
 * Warm Settings from the screens that link to it (Home's gear, More), so the
 * first tap in a session finds data instead of the cold-start skeleton (UX
 * panel round 19: "a loading state for a moment after I tapped the gear").
 * Deferred so it never competes with the current screen's own loading;
 * prefetchQuery is a no-op while the cached copy is fresh.
 */
export function usePrefetchSettings(enabled = true, delayMs = 1200) {
  // Read without throwing: a screen rendered outside the dashboard's
  // QueryProvider (tests, previews) just skips the prefetch.
  const queryClient = useContext(QueryClientContext);
  useEffect(() => {
    if (!enabled || !queryClient) return;
    const timer = setTimeout(() => {
      void queryClient.prefetchQuery({
        queryKey: SETTINGS_KEY,
        queryFn: fetchSettingsBundle,
        staleTime: SETTINGS_STALE_TIME,
        gcTime: SETTINGS_GC_TIME,
      });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [enabled, delayMs, queryClient]);
}
