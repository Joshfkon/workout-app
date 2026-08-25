'use client';

/**
 * Long-window volume heatmap data (the /dashboard/volume "Volume Heatmap"
 * card): credited weekly volume per coarse group, averaged over a selectable
 * trailing window (2w / 1m / 3m / 6m / 1y) and bucketed against the shared
 * MEV–MRV band by app/(dashboard)/dashboard/_lib/volumeHeatmap.
 *
 * Cached-first via React Query under the persisted `analytics` prefix
 * (completed history is immutable-in-practice), keyed per timeframe AND
 * recovery profile (enhanced scales band MRVs, which moves the green-ramp
 * bucket boundaries). Timeframe switches keep the previous map painted via
 * `placeholderData: keepPreviousData` — never a spinner.
 *
 * The query deliberately does NOT select per-set `feedback`: the heatmap
 * buckets raw credited sets (computeWeeklyMuscleVolume treats rows without a
 * feedback column as raw = effective), and dragging a year of per-set JSONB
 * over the wire for a color map would be waste.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { rollingWindowStartISO } from '@/lib/date/localDay';
import { now as clockNow } from '@/lib/clock';
import { useUserStore } from '@/stores';
import type { RecoveryProfile } from '@/services/volumeBands';
import {
  computeVolumeHeatmap,
  getHeatmapTimeframe,
  type HeatmapBlockRow,
  type HeatmapTimeframeId,
  type VolumeHeatmapResult,
} from '@/app/(dashboard)/dashboard/_lib/volumeHeatmap';

export const volumeHeatmapKey = (
  timeframe: HeatmapTimeframeId,
  recoveryProfile: RecoveryProfile
) => ['analytics', 'volumeHeatmap', timeframe, recoveryProfile] as const;

async function fetchVolumeHeatmap(
  timeframe: HeatmapTimeframeId,
  recoveryProfile: RecoveryProfile
): Promise<VolumeHeatmapResult | null> {
  const supabase = createUntypedClient();
  const userId = await getLocalUserId(supabase);
  if (!userId) return null;

  const { days } = getHeatmapTimeframe(timeframe);
  // Stamp once so the window bound and the averaging span agree exactly.
  const now = clockNow();

  const { data, error } = await supabase
    .from('exercise_blocks')
    .select(
      `id, exercises (id, name, primary_muscle, secondary_muscles), set_logs (id, is_warmup),
       workout_sessions!inner (user_id, completed_at, state)`
    )
    .eq('workout_sessions.user_id', userId)
    .eq('workout_sessions.state', 'completed')
    .gte('workout_sessions.completed_at', rollingWindowStartISO(days, now));
  if (error) throw error;

  return computeVolumeHeatmap((data as unknown as HeatmapBlockRow[]) ?? [], days, now, {
    recoveryProfile,
  });
}

export function useVolumeHeatmap(timeframe: HeatmapTimeframeId) {
  const recoveryProfile: RecoveryProfile = useUserStore((state) =>
    state.user?.enhancedAthleteMode ? 'enhanced' : 'standard'
  );

  const query = useQuery({
    queryKey: volumeHeatmapKey(timeframe, recoveryProfile),
    queryFn: () => fetchVolumeHeatmap(timeframe, recoveryProfile),
    // Completed-history derived; a just-finished session should show up on the
    // next visit without an explicit invalidation hook.
    staleTime: 1000 * 60 * 5,
    // Timeframe switches repaint the previous window's map, skeleton only the
    // caption numbers — the figure never unmounts to a spinner.
    placeholderData: keepPreviousData,
  });

  return {
    heatmap: query.data ?? null,
    isLoading: query.isLoading,
    isPlaceholderData: query.isPlaceholderData,
  };
}
