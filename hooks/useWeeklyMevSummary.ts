'use client';

import { useEffect, useState } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  summarizeWeeklyVolume,
  weeklyVolumeWindowStartISO,
  type WeeklyMevSummary,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

/**
 * Single source of truth for the weekly (rolling 7 local days) per-muscle MEV
 * rollup on the client. Both the "This Week vs MEV" card and the "Insufficient
 * Volume" atrophy-risk warning consume this hook, so they query the exact same
 * window through the exact same pipeline and can never report divergent
 * below-MEV counts. Pair with `selectMusclesBelowMev` /
 * `mevSummaryToVolumeData` to derive each card's view of the shared summary.
 */
export function useWeeklyMevSummary(): { summary: WeeklyMevSummary | null; loaded: boolean } {
  const [summary, setSummary] = useState<WeeklyMevSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Rolling 7 local days, anchored to the start of the local day — the
        // same lower bound the home glance tile uses (weeklyVolumeWindowStartISO).
        const { data } = await supabase
          .from('exercise_blocks')
          .select(`id, exercises (id, name, primary_muscle, secondary_muscles), set_logs (id, is_warmup),
            workout_sessions!inner (user_id, completed_at, state)`)
          .eq('workout_sessions.user_id', user.id)
          .eq('workout_sessions.state', 'completed')
          .gte('workout_sessions.completed_at', weeklyVolumeWindowStartISO());

        if (cancelled) return;
        setSummary(summarizeWeeklyVolume((data as any) || []));
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

  return { summary, loaded };
}
