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

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { makeQueryClient } from '@/lib/query/queryClient';
import { buildPersistOptions } from '@/lib/query/idbPersister';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // One client per browser tab, created lazily so it isn't shared across
  // requests on the server.
  const [queryClient] = useState(() => makeQueryClient());
  const [persistOptions] = useState(() => buildPersistOptions());

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
