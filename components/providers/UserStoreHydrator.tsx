'use client';

/**
 * Populates `useUserStore().user` from the real `users` row.
 *
 * The store had no production caller of `setUser` (lost in a refactor), so
 * every consumer silently ran on defaults: kg units, "intermediate"
 * experience, no custom volume landmarks, Enhanced Athlete Mode off, and a
 * null user id (feed reactions did nothing). This is the one place that
 * loads it — mounted once in the dashboard shell, re-run when the signed-in
 * identity changes, and cleared on sign-out. Anything that edits the row
 * (Settings save) calls `refreshUserStore()` to keep it current.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { useUserStore, userFromRow, USER_STORE_ROW_SELECT } from '@/stores/userStore';
import { ensureCacheOwner } from '@/lib/query/clientCachePurge';

/**
 * Load the signed-in user's row into the store. Resolves false (leaving the
 * store untouched) when the read fails, so a transient error never replaces a
 * good user with defaults.
 */
export async function refreshUserStore(userId?: string | null): Promise<boolean> {
  const supabase = createUntypedClient();
  const id = userId ?? (await getLocalUserId(supabase));
  if (!id) return false;
  try {
    const { data, error } = await supabase
      .from('users')
      .select(USER_STORE_ROW_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return false;
    // The identity may have changed while the request was in flight.
    if ((await getLocalUserId(supabase)) !== id) return false;
    useUserStore.getState().setUser(userFromRow(data));
    return true;
  } catch {
    return false;
  }
}

export function UserStoreHydrator() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = createUntypedClient();
    let cancelled = false;

    const hydrate = async (knownUserId?: string | null) => {
      // Last session's user first (instant, no network) — see skipHydration
      // in stores/userStore. Never throws for missing/blocked storage.
      if (!useUserStore.persist.hasHydrated()) {
        try {
          await useUserStore.persist.rehydrate();
        } catch {}
      }
      const userId = knownUserId ?? (await getLocalUserId(supabase));
      if (cancelled) return;
      if (!userId) {
        if (useUserStore.getState().user) useUserStore.getState().setUser(null);
        return;
      }
      // A persisted user (or cache) left behind by a different account is
      // dropped BEFORE the fetch so its id/preferences are never used.
      await ensureCacheOwner(userId, queryClient);
      if (cancelled) return;
      await refreshUserStore(userId);
    };

    void hydrate();

    const { data: sub } = supabase.auth.onAuthStateChange(
      (event: string, session: { user?: { id?: string } | null } | null) => {
        const nextUserId = session?.user?.id ?? null;
        if (!nextUserId) {
          // Signed out: QueryProvider runs the full cache purge (which also
          // clears this store); nothing to load.
          return;
        }
        if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;
        if (useUserStore.getState().user?.id !== nextUserId || event === 'USER_UPDATED') {
          // Deferred: supabase-js holds its auth lock while it runs this
          // callback, and a query made inside it would deadlock on that lock.
          setTimeout(() => void hydrate(nextUserId), 0);
        }
      }
    );

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  return null;
}
