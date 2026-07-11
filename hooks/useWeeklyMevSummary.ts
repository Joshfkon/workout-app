'use client';

import { useEffect, useState } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  computeWeeklyMuscleVolume,
  computeReachableMuscles,
  weeklyVolumeWindowStartISO,
  reachabilityWindowStartISO,
  type MuscleVolumeStats,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type { StandardMuscleGroup } from '@/types/schema';

export interface UseWeeklyMevSummaryResult {
  /** Shared per-muscle credited stats (for the coarse-row presentation model). */
  stats: MuscleVolumeStats[];
  /** Muscles the user's exercises can credit (gates fine-muscle rows/warnings). */
  reachable: Set<StandardMuscleGroup>;
  loaded: boolean;
}

/**
 * Single source of truth for the weekly (rolling 7 local days) per-muscle
 * volume on the client. Every surface — the "This Week vs MEV" card, the
 * insufficient-volume warning and the volume page bars — consumes `stats` +
 * `reachable` through the shared `buildVolumeRows` coarse-row model, so they
 * query the exact same window through the exact same counter and can never
 * report divergent counts or zone-status.
 */
export function useWeeklyMevSummary(): UseWeeklyMevSummaryResult {
  const [result, setResult] = useState<Omit<UseWeeklyMevSummaryResult, 'loaded'>>({
    stats: [],
    reachable: new Set(),
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Rolling 7 local days for volume (same lower bound as the home tile);
        // reachability looks back 12 weeks so occasionally-trained fine muscles
        // stay warnable at 0 sets this week.
        const [volumeRes, reachRes] = await Promise.all([
          supabase
            .from('exercise_blocks')
            .select(`id, exercises (id, name, primary_muscle, secondary_muscles), set_logs (id, is_warmup),
              workout_sessions!inner (user_id, completed_at, state)`)
            .eq('workout_sessions.user_id', user.id)
            .eq('workout_sessions.state', 'completed')
            .gte('workout_sessions.completed_at', weeklyVolumeWindowStartISO()),
          supabase
            .from('exercise_blocks')
            .select(`exercises (primary_muscle, secondary_muscles),
              workout_sessions!inner (user_id, completed_at, state)`)
            .eq('workout_sessions.user_id', user.id)
            .eq('workout_sessions.state', 'completed')
            .gte('workout_sessions.completed_at', reachabilityWindowStartISO()),
        ]);

        if (cancelled) return;
        const blocks = (volumeRes.data as any) || [];
        const stats = computeWeeklyMuscleVolume(blocks);
        const reachable = computeReachableMuscles((reachRes.data as any) || []);
        setResult({ stats, reachable });
      } catch (err) {
        console.error('Failed to load weekly MEV summary:', err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...result, loaded };
}
