'use client';

/**
 * Boot data for /dashboard/train, cached-first (CLAUDE.md "Loading States").
 *
 * Before: fetch-in-useEffect on every visit — a getUser() network round
 * trip, then a five-query batch, then a SERIAL query for the mesocycle's
 * completed sessions after the whole batch — with "Loading..." in the plan
 * card and the recent list each time. Now:
 *  - identity from the locally persisted session (no auth round trip; RLS
 *    still checks the token on every request);
 *  - the mesocycle's completed-sessions read chains off the mesocycle read
 *    INSIDE the batch, so it overlaps the other reads instead of following
 *    the slowest of them;
 *  - one persisted query (['log', 'train']): a revisit or a cold start with
 *    a cache paints at once and revalidates in the background, and every
 *    workout finish invalidates it (WORKOUT_DERIVED_QUERY_PREFIXES).
 */

import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { getLocalDateString } from '@/lib/utils';
import { now as clockNow } from '@/lib/clock';
import { fetchActiveMesocycle } from '@/lib/training/fetchActiveMesocycle';
import { fetchTrainingStyle } from '@/lib/training/trainingStyle';
import { RECENT_SESSION_SELECT, type RecentSessionRow } from '@/lib/training/repeatWorkout';
import type {
  TrainMesoCompletedRow,
  TrainPageData,
  TrainWeekSessionRow,
} from '@/app/(dashboard)/dashboard/train/trainPageData';

export const TRAIN_PAGE_QUERY_KEY = ['log', 'train'] as const;

interface InProgressBlockRow {
  id: string;
  set_logs: { id: string; is_warmup: boolean | null }[] | null;
}

/** Start of the rolling week the stats card counts (same as useWeeklyVolume). */
export function trainWeekStartDay(at: Date = clockNow()): string {
  const d = new Date(at);
  d.setDate(d.getDate() - 6);
  return getLocalDateString(d);
}

export async function fetchTrainPageData(): Promise<TrainPageData | null> {
  const supabase = createUntypedClient();
  const userId = await getLocalUserId(supabase);
  // No stored session: middleware owns the redirect.
  if (!userId) return null;

  const today = getLocalDateString();
  const weekStart = trainWeekStartDay();

  const [inProgressRes, mesoBundle, recentRes, weekSessionsRes, styleRes, profileRes] = await Promise.all([
    supabase
      .from('workout_sessions')
      .select('id, mesocycle_id, started_at, exercise_blocks(id, set_logs(id, is_warmup))')
      .eq('user_id', userId)
      .eq('planned_date', today)
      .eq('state', 'in_progress')
      .limit(1),
    // Shared helper (same mesocycle as Home), then its completed sessions —
    // chained here so the tail overlaps the rest of the batch.
    fetchActiveMesocycle(supabase, userId).then(async (meso) => {
      if (!meso) return { meso: null, completed: null as TrainMesoCompletedRow[] | null };
      const { data, error } = await supabase
        .from('workout_sessions')
        .select('started_at, planned_date')
        .eq('mesocycle_id', meso.id)
        .eq('state', 'completed')
        .order('started_at', { ascending: true });
      if (error) throw error;
      return { meso, completed: (data ?? []) as TrainMesoCompletedRow[] };
    }),
    supabase
      .from('workout_sessions')
      .select(RECENT_SESSION_SELECT)
      .eq('user_id', userId)
      .eq('state', 'completed')
      .order('completed_at', { ascending: false })
      .limit(5),
    supabase
      .from('workout_sessions')
      .select('started_at, completed_at, duration_seconds')
      .eq('user_id', userId)
      .eq('state', 'completed')
      .gte('completed_at', weekStart),
    // Training style (lib/training/trainingStyle): freestyle hides the plan card.
    fetchTrainingStyle(supabase, userId).catch(() => null),
    supabase.from('users').select('experience').eq('id', userId).maybeSingle(),
  ]);

  // A failed read must fail the query (React Query keeps the last good
  // payload and retries) — never be cached, and persisted, as "no data".
  for (const res of [inProgressRes, recentRes, weekSessionsRes]) {
    if (res.error) throw res.error;
  }

  const freestyle = styleRes?.style === 'freestyle';
  const ipRow = inProgressRes.data?.[0];
  const blocks = (ipRow?.exercise_blocks ?? []) as InProgressBlockRow[];

  return {
    date: today,
    userId,
    inProgress: ipRow
      ? {
          id: ipRow.id,
          mesocycleId: ipRow.mesocycle_id ?? null,
          startedAt: ipRow.started_at ?? null,
          setsDone: blocks.reduce(
            (sum, b) => sum + (b.set_logs ?? []).filter((l) => !l.is_warmup).length,
            0
          ),
          blockIds: blocks.map((b) => b.id),
        }
      : null,
    // Freestyle treats the plan as absent, so every plan-dependent piece
    // (week label, session count, preview) falls back to its no-plan form.
    activeMeso: freestyle ? null : mesoBundle.meso,
    isFreestyle: freestyle,
    recentRows: (recentRes.data ?? []) as RecentSessionRow[],
    weekRows: (weekSessionsRes.data ?? []) as TrainWeekSessionRow[],
    mesoCompleted: freestyle ? null : mesoBundle.completed,
    experience: (profileRes.data as { experience?: string | null } | null)?.experience ?? null,
  };
}

/**
 * staleTime 0: every visit paints the cached payload immediately and
 * revalidates in the background — the unfinished-workout banner must catch
 * up with a workout started elsewhere, which no invalidation covers.
 */
export function useTrainPageData() {
  return useQuery({
    queryKey: TRAIN_PAGE_QUERY_KEY,
    queryFn: fetchTrainPageData,
    staleTime: 0,
  });
}
