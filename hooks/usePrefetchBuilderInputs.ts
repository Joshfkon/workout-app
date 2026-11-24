'use client';

/**
 * Warm the block builder's inputs from the screens that lead to it (Home's
 * "Plan a training block", Train's plan entries), so the builder opens with
 * its data instead of a skeleton (UX panel round 22, Dre: "The planner showed
 * a loading state at first, which cost me a wait").
 *
 * The builder reads BUILDER_INPUTS_QUERY_KEY with React Query; filling that
 * same cache entry here makes its first render a cache hit (it still
 * refetches in the background on mount, so Settings changes are never
 * missed). Two triggers:
 *  - idle, a moment after the entry renders (once per PREFETCH_STALE_MS —
 *    prefetchQuery skips a fresh entry, so Home revisits cost nothing);
 *  - intent: pointer-down / focus on the link, for a tap that beats idle.
 */

import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BUILDER_INPUTS_QUERY_KEY, fetchBuilderInputs } from '@/lib/training/fetchBuilderInputs';

/** A prefetched copy younger than this is not fetched again. */
export const PREFETCH_STALE_MS = 5 * 60 * 1000;
/** Idle delay after the entry renders, so the screen's own reads go first. */
const IDLE_DELAY_MS = 1200;

export function usePrefetchBuilderInputs(enabled = true): () => void {
  const queryClient = useQueryClient();
  const prefetch = useCallback(() => {
    void queryClient
      .prefetchQuery({ queryKey: BUILDER_INPUTS_QUERY_KEY, queryFn: fetchBuilderInputs, staleTime: PREFETCH_STALE_MS })
      .catch(() => {
        // An optimisation only: the builder fetches for itself.
      });
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(prefetch, IDLE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, prefetch]);

  return prefetch;
}
