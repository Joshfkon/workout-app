'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import {
  adjustRecoveryMultiplier,
  clampRecoveryMultiplier,
  type RecoveryStatus,
  type SorenessReport,
} from '@/services/muscleRecovery';
import type { StandardMuscleGroup } from '@/types/schema';

/**
 * useRecoveryMultipliers — per-user, per-muscle learned recovery-window
 * multipliers (user_muscle_recovery_multipliers).
 *
 * Read side: a small React Query map consumed by the recovery hooks via
 * `recoveryConfigFor(enhanced, multipliers)`. Write side:
 * `applySorenessAdjustment` runs the pure `adjustRecoveryMultiplier` learning
 * step (disagreement between the user's soreness report and the model's
 * status at ask time moves the multiplier ±0.05, bounded 0.7–1.5), updates the
 * cache optimistically and upserts the row.
 */

export type RecoveryMultipliers = Partial<Record<StandardMuscleGroup, number>>;

const QUERY_KEY_PREFIX = 'recovery-multipliers';

export function useRecoveryMultipliers(): {
  multipliers: RecoveryMultipliers;
  isLoading: boolean;
  /**
   * Apply the soreness learning step for one muscle. No-ops (returns the
   * current value) when the report/status combination is non-corrective.
   */
  applySorenessAdjustment: (
    muscle: StandardMuscleGroup,
    report: SorenessReport,
    statusAtAsk: RecoveryStatus
  ) => Promise<number>;
} {
  const { user: storeUser } = useUserStore();
  const { user: authUser } = useAuthUser();
  const userId = storeUser?.id || authUser?.id || null;
  const queryClient = useQueryClient();

  const query = useQuery<RecoveryMultipliers>({
    queryKey: [QUERY_KEY_PREFIX, userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('user_muscle_recovery_multipliers')
        .select('muscle_group, recovery_multiplier')
        .eq('user_id', userId);
      if (error) throw error;
      const map: RecoveryMultipliers = {};
      for (const row of (data ?? []) as { muscle_group: string; recovery_multiplier: number }[]) {
        map[row.muscle_group as StandardMuscleGroup] = clampRecoveryMultiplier(
          Number(row.recovery_multiplier)
        );
      }
      return map;
    },
  });

  const multipliers = query.data ?? EMPTY_MULTIPLIERS;

  const applySorenessAdjustment = useCallback(
    async (
      muscle: StandardMuscleGroup,
      report: SorenessReport,
      statusAtAsk: RecoveryStatus
    ): Promise<number> => {
      const current = clampRecoveryMultiplier(multipliers[muscle] ?? 1);
      const next = adjustRecoveryMultiplier(current, report, statusAtAsk);
      if (next === current || !userId) return current;

      // Optimistic cache update so the readiness sheet reflects it immediately.
      queryClient.setQueryData<RecoveryMultipliers>(
        [QUERY_KEY_PREFIX, userId],
        (prev) => ({ ...(prev ?? {}), [muscle]: next })
      );

      const supabase = createUntypedClient();
      const { error } = await supabase
        .from('user_muscle_recovery_multipliers')
        .upsert(
          {
            user_id: userId,
            muscle_group: muscle,
            recovery_multiplier: next,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,muscle_group' }
        );
      if (error) {
        // Roll back the optimistic value; the learning step is best-effort.
        queryClient.setQueryData<RecoveryMultipliers>(
          [QUERY_KEY_PREFIX, userId],
          (prev) => ({ ...(prev ?? {}), [muscle]: current })
        );
        console.error('Failed to persist recovery multiplier:', error.message);
        return current;
      }
      return next;
    },
    [multipliers, userId, queryClient]
  );

  return { multipliers, isLoading: query.isLoading, applySorenessAdjustment };
}

const EMPTY_MULTIPLIERS: RecoveryMultipliers = {};
