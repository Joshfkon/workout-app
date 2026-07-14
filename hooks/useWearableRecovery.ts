'use client';

/**
 * useWearableRecovery — the HRV/RHR global recovery modifier, computed from
 * daily_wellness_metrics (fed by the HealthKit foreground sync).
 *
 * Platform-agnostic by design: on web/Android the table is simply empty and
 * the state stays NEUTRAL (scale 1, no UI mention), so consumers never need a
 * platform branch. Shared React Query cache means the readiness sheet, the
 * recovery card, and the Train page all see one consistent modifier.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWellnessHistory } from '@/lib/actions/healthkit';
import {
  computeWearableRecoveryState,
  NEUTRAL_WEARABLE_RECOVERY,
  type WearableRecoveryState,
} from '@/services/wearableRecovery';
import { getLocalDateString } from '@/lib/utils';

const WELLNESS_STALE_MS = 10 * 60 * 1000;

export function useWearableRecovery(): {
  state: WearableRecoveryState;
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: ['wearable-recovery-history'],
    queryFn: () => getWellnessHistory(21),
    staleTime: WELLNESS_STALE_MS,
  });

  const state = useMemo(() => {
    const history = query.data;
    if (!history || history.length === 0) return NEUTRAL_WEARABLE_RECOVERY;
    return computeWearableRecoveryState(history, getLocalDateString());
  }, [query.data]);

  return { state, isLoading: query.isLoading };
}
