'use client';

import { useCallback, useEffect, useState } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { requireAuthUserId, assertLiveSession } from '@/lib/supabase/sessionGate';
import {
  computeWeeklyMuscleVolume,
  computeReachableMuscles,
  weeklyVolumeWindowStartISO,
  type MuscleVolumeStats,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type { StandardMuscleGroup } from '@/types/schema';

export interface UseWeeklyMevSummaryResult {
  /** Shared per-muscle credited stats (for the coarse-row presentation model). */
  stats: MuscleVolumeStats[];
  /** Muscles the user's exercises can credit (gates fine-muscle rows/warnings). */
  reachable: Set<StandardMuscleGroup>;
  loaded: boolean;
  /**
   * The load failed (expired session, dead token, network) — `stats: []` is
   * NOT "the user trained nothing this week" in this case. Consumers must
   * render an error/re-auth state instead of all-below-MEV bars.
   */
  error: unknown;
  refetch: () => void;
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
  const [result, setResult] = useState<Pick<UseWeeklyMevSummaryResult, 'stats' | 'reachable'>>({
    stats: [],
    reachable: new Set(),
  });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fetchNonce, setFetchNonce] = useState(0);

  const refetch = useCallback(() => {
    setLoaded(false);
    setError(null);
    setFetchNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createUntypedClient();
        // Empty-state auth gate (lib/supabase/sessionGate.ts): a missing or
        // expired session throws instead of committing empty stats that read
        // as "every muscle below MEV".
        const userId = await requireAuthUserId(supabase);

        // Rolling 7 local days, anchored to the start of the local day — the
        // same lower bound the home glance tile uses (weeklyVolumeWindowStartISO).
        const { data, error: blocksError } = await supabase
          .from('exercise_blocks')
          .select(`id, exercises (id, name, primary_muscle, secondary_muscles), set_logs (id, is_warmup),
            workout_sessions!inner (user_id, completed_at, state)`)
          .eq('workout_sessions.user_id', userId)
          .eq('workout_sessions.state', 'completed')
          .gte('workout_sessions.completed_at', weeklyVolumeWindowStartISO());

        if (blocksError) throw blocksError;

        const blocks = (data as any) || [];
        // Zero blocks is only the truth from a verified-live session — a
        // dead token gets RLS-filtered to zero rows without an error.
        if (blocks.length === 0) {
          await assertLiveSession(supabase);
        }
        if (cancelled) return;
        const stats = computeWeeklyMuscleVolume(blocks);
        const reachable = computeReachableMuscles(blocks);
        setResult({ stats, reachable });
      } catch (err) {
        console.error('Failed to load weekly MEV summary:', err);
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchNonce]);

  return { ...result, loaded, error, refetch };
}
