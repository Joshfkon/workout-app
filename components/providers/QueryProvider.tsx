'use client';

/**
 * App-shell React Query provider (UX loading-states work).
 *
 * Mounted once at the dashboard layout so every dashboard route shares one
 * cache. When IndexedDB is available the cache is restored from / persisted to
 * disk (see lib/query/idbPersister.ts); otherwise it falls back to a plain
 * in-memory provider so SSR and IDB-less webviews still work.
 *
 * NOTE: this is the single caching layer for the app — do not add SWR or a
 * second QueryClient. New data views should use `useQuery` with an
 * appropriate `staleTime` rather than fetch-in-useEffect + full-page spinner.
 */

import { useState, useEffect, useRef } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { makeQueryClient } from '@/lib/query/queryClient';
import { buildPersistOptions, clearPersistedQueryCache } from '@/lib/query/idbPersister';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // One client per browser tab, created lazily so it isn't shared across
  // requests on the server.
  const [queryClient] = useState(() => makeQueryClient());
  const [persistOptions] = useState(() => buildPersistOptions());

  // Purge the cache (memory + persisted IndexedDB) whenever the signed-in
  // identity changes — sign-out, or user B signing in after user A on a shared
  // browser. The persisted query keys aren't user-scoped, so without this a new
  // user could rehydrate the previous user's private data (food logs, workouts,
  // DEXA/profile) — worse with the long staleTime on immutable-in-practice
  // queries, which wouldn't refetch it away.
  const lastUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const supabase = createUntypedClient();
    // Seed from the locally persisted session (no network). This only needs
    // IDENTITY for the user-switch cache purge; verification isn't required,
    // and a boot-time getUser() round trip here serializes with every other
    // auth read behind supabase-js's auth lock, delaying first data fetch.
    void getLocalUserId(supabase).then((userId) => {
      lastUserIdRef.current = userId;
    });
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: { user?: { id?: string } | null } | null) => {
      const nextUserId = session?.user?.id ?? null;
      if (lastUserIdRef.current !== undefined && lastUserIdRef.current !== nextUserId) {
        queryClient.clear();
        void clearPersistedQueryCache();
      }
      lastUserIdRef.current = nextUserId;
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  if (persistOptions) {
    return (
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={persistOptions}
      >
        {children}
      </PersistQueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
