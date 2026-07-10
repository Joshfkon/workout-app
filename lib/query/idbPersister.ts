/**
 * IndexedDB persister for the React Query cache.
 *
 * Uses idb-keyval (async, non-blocking, survives tab close / PWA restart —
 * same rationale as the set-log outbox in lib/offline/setOutbox.ts). Only
 * queries whose key is allow-listed by `shouldPersistQueryKey` are written to
 * disk, so auth-sensitive / live data never lands in IndexedDB.
 *
 * SSR / environments without IndexedDB (unit tests, some webviews) get an
 * undefined persister and the app runs memory-only — no crash.
 */

import { get, set, del } from 'idb-keyval';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { shouldPersistQueryKey, IMMUTABLE_GC_TIME } from './queryClient';

export const IDB_KEY = 'hypertrack-rq-cache';

/**
 * Wipe the on-disk persisted cache. Called on sign-out / user switch so one
 * user's private data (food logs, workouts, DEXA/profile) can never rehydrate
 * under another user on a shared browser — the persisted keys are not
 * user-scoped by design (they're small and the win is simplicity), so the
 * cache is purged on any auth-identity change instead.
 */
export async function clearPersistedQueryCache(): Promise<void> {
  try {
    await del(IDB_KEY);
  } catch {
    /* IndexedDB unavailable (SSR / some webviews) — nothing to clear. */
  }
}

// Bump when the persisted shape changes in a breaking way — mismatched caches
// are discarded rather than rehydrated.
export const CACHE_BUSTER = 'v1';

function hasIndexedDB(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

export function createIdbPersister() {
  if (!hasIndexedDB()) return undefined;
  return createAsyncStoragePersister({
    key: IDB_KEY,
    storage: {
      getItem: (key) => get(key),
      setItem: (key, value) => set(key, value),
      removeItem: (key) => del(key),
    },
  });
}

/**
 * persistOptions for <PersistQueryClientProvider>. Restricts what lands on
 * disk to the allow-listed, successfully-fetched queries.
 */
export function buildPersistOptions(): Omit<PersistQueryClientOptions, 'queryClient'> | null {
  const persister = createIdbPersister();
  if (!persister) return null;
  return {
    persister,
    maxAge: IMMUTABLE_GC_TIME,
    buster: CACHE_BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) =>
        query.state.status === 'success' &&
        shouldPersistQueryKey(query.queryKey),
    },
  };
}
