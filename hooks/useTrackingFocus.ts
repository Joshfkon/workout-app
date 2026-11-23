'use client';

import { useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { savePreferencesPatch } from '@/lib/settings/savePreferencesPatch';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';
import { now as clockNow } from '@/lib/clock';
import { useUserStore } from '@/stores/userStore';
import { resolveFoodOnly, statedTrackingFocus } from '@/lib/onboarding/trackingFocus';

/**
 * THE read point for food-only mode (lib/onboarding/trackingFocus
 * resolveFoodOnly). The nav, Home, Progress and Settings all ask this hook;
 * nothing else reads `tracking_focus` / `alsoLifts` to decide what lifting UI
 * to show.
 *
 * Inputs:
 *  - the sign-up answer (auth user_metadata.tracking_focus, local session);
 *  - users.preferences.alsoLifts / liftingOffAt (user store, so a switch in
 *    Settings applies on every mounted screen at once);
 *  - whether a completed workout exists (after liftingOffAt). Keyed under
 *    'history', so it is persisted for an instant cold start AND invalidated
 *    by every workout finish (lib/query/workoutInvalidation) — which is how
 *    logging a first workout turns lifting back on by itself.
 *
 * Lifters are never affected: anyone who didn't answer "food" is not
 * food-only, and an unknown history counts as lifting.
 */

export interface TrackingFocusFacts {
  statedFood: boolean;
  /** null when not checked (not food, or lifting already on). */
  hasCompletedWorkout: boolean | null;
}

async function fetchTrackingFocusFacts(
  userId: string,
  checkWorkouts: boolean,
  liftingOffAt: string | null
): Promise<TrackingFocusFacts> {
  const supabase = createUntypedClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const statedFood = statedTrackingFocus(session?.user?.user_metadata) === 'food';
  if (!statedFood || !checkWorkouts) return { statedFood, hasCompletedWorkout: null };

  let query = supabase
    .from('workout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('state', 'completed');
  if (liftingOffAt) query = query.gt('completed_at', liftingOffAt);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return { statedFood, hasCompletedWorkout: (data?.length ?? 0) > 0 };
}

let autoOnFor: string | null = null;

/** Test-only: reset the auto-on guard between test cases. */
export function __resetTrackingFocusForTests() {
  autoOnFor = null;
}

export interface TrackingFocus {
  /** Hide the lifting UI (Train tab, workout starts, strength prompts). */
  foodOnly: boolean;
  /** Said "No, food tracking" at sign-up; undefined while unknown. */
  statedFood: boolean | undefined;
  /** Turn the lifting UI on/off ("I also lift weights"). Throws on a failed save. */
  setLiftingOn: (on: boolean) => Promise<void>;
}

/** After a failed automatic "lifting on" save, wait this long before trying again. */
export const AUTO_ON_RETRY_MS = 60_000;

export function useTrackingFocus(): TrackingFocus {
  const userId = useUserStore((s) => s.user?.id ?? null);
  const alsoLifts = useUserStore((s) => s.user?.preferences.alsoLifts);
  const liftingOffAt = useUserStore((s) => s.user?.preferences.liftingOffAt ?? null);
  const checkWorkouts = alsoLifts !== true;

  const { data } = useQuery({
    queryKey: ['history', 'tracking-focus', userId, checkWorkouts ? liftingOffAt ?? 'ever' : 'lifts'],
    queryFn: () => fetchTrackingFocusFacts(userId as string, checkWorkouts, liftingOffAt),
    enabled: !!userId,
    staleTime: IMMUTABLE_GC_TIME,
    gcTime: IMMUTABLE_GC_TIME,
  });

  const foodOnly = resolveFoodOnly({
    statedFocus: data?.statedFood ? 'food' : null,
    alsoLifts,
    hasCompletedWorkout: data?.hasCompletedWorkout ?? undefined,
  });

  const setLiftingOn = useCallback(
    async (on: boolean) => {
      const store = useUserStore.getState();
      const id = store.user?.id;
      if (!id) return;
      const before = {
        alsoLifts: store.user?.preferences.alsoLifts,
        liftingOffAt: store.user?.preferences.liftingOffAt ?? null,
      };
      const patch = on
        ? { alsoLifts: true }
        : { alsoLifts: false, liftingOffAt: clockNow().toISOString() };
      store.updatePreferences(patch);
      try {
        await savePreferencesPatch(createUntypedClient(), id, patch);
      } catch (err) {
        useUserStore.getState().updatePreferences(before);
        throw err;
      }
    },
    []
  );

  // A workout completed while lifting was off (or never on): switch it on
  // for good, so Settings shows it on and the check stops running.
  // (Module-level guard: the nav, Home and Progress all mount this hook.)
  useEffect(() => {
    if (!userId || alsoLifts === true) return;
    if (!data?.statedFood || data.hasCompletedWorkout !== true) return;
    if (autoOnFor === userId) return;
    autoOnFor = userId;
    setLiftingOn(true).catch(() => {
      // Keep the guard: the rollback re-renders with alsoLifts back to false,
      // and clearing it here retried at once — an unbounded save loop on a
      // persistent failure. Allow one more attempt a minute later instead.
      setTimeout(() => {
        if (autoOnFor === userId) autoOnFor = null;
      }, AUTO_ON_RETRY_MS);
    });
  }, [userId, alsoLifts, data, setLiftingOn]);

  return { foodOnly, statedFood: data?.statedFood, setLiftingOn };
}
