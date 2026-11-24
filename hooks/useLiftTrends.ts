'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { now } from '@/lib/clock';
import {
  computeLiftTrends,
  LIFT_TREND_SESSION_SELECT,
  LIFT_TREND_WINDOW_DAYS,
  type LiftTrendSessionRow,
  type LiftTrendsSummary,
} from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import type { PlateauGoal } from '@/services/plateauDetector';
import { listOutbox, type OutboxEntry } from '@/lib/offline/setOutbox';
import {
  mergeLocalPendingWorkouts,
  pendingCompletionsFromOutbox,
  pendingSetsFromOutbox,
  type RawWorkoutSession,
} from '@/services/volumeTrendsData';

/**
 * Server-completed sessions plus workouts finished locally whose completion
 * (and possibly sets) are still queued in the offline outbox — the same
 * merge the analytics page used before the Strength-by-muscle card moved
 * onto this query, so unsynced never means missing. Oldest first (the
 * order computeLiftTrends was always given).
 */
export function mergePendingLiftSessions(input: {
  serverSessions: LiftTrendSessionRow[];
  pendingSessions: LiftTrendSessionRow[];
  outbox: OutboxEntry[];
  since: Date;
}): LiftTrendSessionRow[] {
  const pendingCompletions = pendingCompletionsFromOutbox(input.outbox);
  const pendingSetsByBlock = pendingSetsFromOutbox(input.outbox);
  if (pendingCompletions.size === 0 && pendingSetsByBlock.size === 0) return input.serverSessions;
  // The merge only reads ids, completed_at, blocks' ids and set_logs, and
  // spreads everything else through unchanged.
  const merged = mergeLocalPendingWorkouts({
    serverSessions: input.serverSessions as unknown as RawWorkoutSession[],
    pendingSessions: input.pendingSessions as unknown as RawWorkoutSession[],
    pendingCompletions,
    pendingSetsByBlock,
    rangeStart: input.since,
  }) as unknown as LiftTrendSessionRow[];
  return merged.sort(
    (a, b) => new Date(a.completed_at ?? 0).getTime() - new Date(b.completed_at ?? 0).getTime()
  );
}

/**
 * Persisted ('analytics' prefix) and invalidated on every workout finish
 * (WORKOUT_DERIVED_QUERY_PREFIXES), so the Strength tab and a lift's own
 * screen share one warm copy: opening a lift never waits on a refetch.
 */
export const LIFT_TRENDS_QUERY_KEY = ['analytics', 'lift-trends'] as const;

/**
 * The cache key for a window. The default window (LIFT_TREND_WINDOW_DAYS)
 * keeps the bare key every other reader shares (Home tile parity, the lift
 * screen, Train); other windows — Progress's shared range control — add the
 * day count. All of them sit under the same prefix, so one invalidation of
 * LIFT_TRENDS_QUERY_KEY (or of 'analytics') reaches every window.
 */
export function liftTrendsQueryKey(windowDays: number = LIFT_TREND_WINDOW_DAYS): readonly unknown[] {
  return windowDays === LIFT_TREND_WINDOW_DAYS ? LIFT_TRENDS_QUERY_KEY : [...LIFT_TRENDS_QUERY_KEY, windowDays];
}

/**
 * Same select, window (LIFT_TREND_WINDOW_DAYS) and pure function as the home
 * "Lifts" glance tile (lib/actions/dashboard.ts fetchLiftTrends), so the
 * tile's "N rising of M" and the Progress detail can never disagree.
 * Null when signed out.
 */
export async function fetchLiftTrendsSummary(
  windowDays: number = LIFT_TREND_WINDOW_DAYS
): Promise<LiftTrendsSummary | null> {
  const supabase = createUntypedClient();
  const userId = await getLocalUserId(supabase);
  if (!userId) return null;

  const at = now();
  const since = new Date(at);
  since.setDate(since.getDate() - windowDays);

  const outbox = await listOutbox().catch(() => [] as OutboxEntry[]);
  const pendingIds = Array.from(pendingCompletionsFromOutbox(outbox).keys());

  const [sessionsRes, goalRes, mesoRes, pendingRes] = await Promise.all([
    supabase
      .from('workout_sessions')
      .select(LIFT_TREND_SESSION_SELECT)
      .eq('user_id', userId)
      .eq('state', 'completed')
      .gte('completed_at', since.toISOString())
      .order('completed_at', { ascending: true }),
    supabase.from('users').select('goal').eq('id', userId).single(),
    supabase
      .from('mesocycles')
      .select('start_date')
      .eq('user_id', userId)
      .or('is_active.eq.true,state.eq.active')
      .order('created_at', { ascending: false })
      .limit(1),
    pendingIds.length > 0
      ? supabase.from('workout_sessions').select(LIFT_TREND_SESSION_SELECT).eq('user_id', userId).in('id', pendingIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (sessionsRes.error) throw sessionsRes.error;
  if (pendingRes.error) throw pendingRes.error;

  const sessions = mergePendingLiftSessions({
    serverSessions: (sessionsRes.data ?? []) as unknown as LiftTrendSessionRow[],
    pendingSessions: (pendingRes.data ?? []) as unknown as LiftTrendSessionRow[],
    outbox,
    since,
  });

  return computeLiftTrends(
    sessions,
    (goalRes.data?.goal as PlateauGoal | null) ?? undefined,
    at,
    // includeRollup: the Strength tab's "Strength by muscle" card rolls up
    // these same series, so a lift and its muscle can never disagree.
    { programStartDate: mesoRes.data?.[0]?.start_date ?? null, includeRollup: true, windowDays }
  );
}

/**
 * `windowDays` defaults to the shared 12-week window. A different window
 * (Progress's range control) is its own cached query; switching keeps the
 * previous window's numbers on screen until the new ones land, so the
 * Strength tab never drops to a skeleton on a range tap.
 */
export function useLiftTrends(windowDays: number = LIFT_TREND_WINDOW_DAYS) {
  return useQuery({
    queryKey: liftTrendsQueryKey(windowDays),
    queryFn: () => fetchLiftTrendsSummary(windowDays),
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  });
}
