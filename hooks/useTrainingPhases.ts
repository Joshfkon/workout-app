'use client';

/**
 * useTrainingPhases — the user's date-spanned training phases (bulk / cut /
 * recomp / maintenance) for the Body tab verdict card, phase banner, trend
 * chart bands, and the phase editor.
 *
 * One React Query key per user (['phases', userId]); every surface reads the
 * same cache and the write callbacks update it in place, then invalidate so a
 * background refetch reconciles with the server (last-write-wins — phases are
 * low-frequency single-user writes). Prefix 'phases' is registered in
 * lib/query/queryClient.ts so the cache survives a cold start.
 *
 * Span invariants are validated with services/phasePlanning.validatePhaseSpan
 * BEFORE calling addPhase/updatePhase — the hook does not re-validate.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import {
  deleteTrainingPhase,
  fetchTrainingPhases,
  insertTrainingPhase,
  updateTrainingPhaseSpan,
  type TrainingPhaseInput,
} from '@/lib/body/trainingPhases';
import { activePhase, goalSyncAfterEdit, sortPhases } from '@/services/phasePlanning';
import { localDay } from '@/lib/date/localDay';
import type { TrainingPhase } from '@/types/schema';

export const PHASES_QUERY_KEY_PREFIX = 'phases';

export interface UseTrainingPhasesResult {
  /** All phases, sorted by startDay ascending. */
  phases: TrainingPhase[];
  /** The phase covering today, or null (gaps are legal). */
  current: TrainingPhase | null;
  isLoading: boolean;
  addPhase: (input: TrainingPhaseInput) => Promise<TrainingPhase>;
  updatePhase: (id: string, patch: Partial<TrainingPhaseInput>) => Promise<TrainingPhase>;
  removePhase: (id: string) => Promise<void>;
}

const EMPTY_PHASES: TrainingPhase[] = [];

export function useTrainingPhases(): UseTrainingPhasesResult {
  const storeUserId = useUserStore((state) => state.user?.id ?? null);
  const { user: authUser } = useAuthUser();
  const userId = storeUserId || authUser?.id || null;
  const queryClient = useQueryClient();

  const query = useQuery<TrainingPhase[]>({
    queryKey: [PHASES_QUERY_KEY_PREFIX, userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = createUntypedClient();
      return fetchTrainingPhases(supabase, userId!);
    },
  });

  const phases = query.data ?? EMPTY_PHASES;
  const current = useMemo(() => activePhase(phases, localDay()), [phases]);

  const syncCache = useCallback(
    (updater: (prev: TrainingPhase[]) => TrainingPhase[]) => {
      const before =
        queryClient.getQueryData<TrainingPhase[]>([PHASES_QUERY_KEY_PREFIX, userId]) ?? [];
      const after = sortPhases(updater(before));
      queryClient.setQueryData<TrainingPhase[]>([PHASES_QUERY_KEY_PREFIX, userId], after);
      // Background reconcile; in-place update above keeps the UI instant.
      queryClient.invalidateQueries({ queryKey: [PHASES_QUERY_KEY_PREFIX, userId] });

      // Retroactive edits leave users.goal / phase_history alone (they record
      // what the user believed at the time; the spans are the corrected
      // truth). But when an edit changes which span covers TODAY, users.goal
      // must mirror it so legacy readers can't disagree about the present.
      // Best-effort: a failed mirror never blocks the phase write.
      const mirroredGoal = goalSyncAfterEdit(before, after, localDay());
      if (mirroredGoal && userId) {
        const supabase = createUntypedClient();
        void (async () => {
          const { error } = await supabase
            .from('users')
            .update({ goal: mirroredGoal })
            .eq('id', userId);
          if (error) {
            console.error('[useTrainingPhases] users.goal mirror failed (non-fatal):', error);
          }
        })();
      }
    },
    [queryClient, userId]
  );

  const addPhase = useCallback(
    async (input: TrainingPhaseInput) => {
      if (!userId) throw new Error('You need to be signed in to manage phases.');
      const supabase = createUntypedClient();
      const saved = await insertTrainingPhase(supabase, userId, input);
      syncCache((prev) => [...prev, saved]);
      return saved;
    },
    [userId, syncCache]
  );

  const updatePhase = useCallback(
    async (id: string, patch: Partial<TrainingPhaseInput>) => {
      if (!userId) throw new Error('You need to be signed in to manage phases.');
      const supabase = createUntypedClient();
      const saved = await updateTrainingPhaseSpan(supabase, id, patch);
      syncCache((prev) => prev.map((p) => (p.id === id ? saved : p)));
      return saved;
    },
    [userId, syncCache]
  );

  const removePhase = useCallback(
    async (id: string) => {
      if (!userId) return;
      const supabase = createUntypedClient();
      await deleteTrainingPhase(supabase, id);
      syncCache((prev) => prev.filter((p) => p.id !== id));
    },
    [userId, syncCache]
  );

  return {
    phases,
    current,
    isLoading: query.isLoading,
    addPhase,
    updatePhase,
    removePhase,
  };
}
