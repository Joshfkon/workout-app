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
import { shouldPersistQueryKey, PERSIST_MAX_AGE } from './queryClient';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';

export const IDB_KEY = 'hypertrack-rq-cache';
/** Id of the user whose data the persisted snapshot holds. */
export const IDB_OWNER_KEY = 'hypertrack-rq-cache-owner';

/**
 * Wipe the on-disk persisted cache. Called on sign-out / user switch so one
 * user's private data (food logs, workouts, DEXA/profile) can never rehydrate
 * under another user on a shared browser. The query keys themselves are not
 * user-scoped, so the snapshot is additionally OWNED (see
 * createOwnerScopedStorage): the purge handles a sign-out the app witnessed,
 * the owner check handles one it didn't (session expired while closed).
 */
export async function clearPersistedQueryCache(): Promise<void> {
  try {
    await del(IDB_KEY);
    await del(IDB_OWNER_KEY);
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

interface KeyValueStore {
  get: (key: string) => Promise<string | null | undefined>;
  set: (key: string, value: string) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
}

/**
 * Storage for the persister that only ever hands a snapshot back to the user
 * who wrote it.
 *
 * The purge in QueryProvider only fires for an auth change it is mounted to
 * see. If user A's session expires while the app is closed and user B then
 * signs in, nothing purged — and B would restore A's food log / history /
 * analytics for up to PERSIST_MAX_AGE. So every write stamps the owner, and a
 * restore whose owner isn't the locally signed-in user is deleted, not
 * returned. `getUserId` is the local session read (no network).
 */
export function createOwnerScopedStorage(deps: {
  getUserId: () => Promise<string | null>;
  store: KeyValueStore;
}) {
  const { getUserId, store } = deps;
  return {
    getItem: async (key: string): Promise<string | null> => {
      const [userId, owner] = await Promise.all([getUserId(), store.get(IDB_OWNER_KEY)]);
      if (!userId || owner !== userId) {
        // Someone else's snapshot (or an un-owned legacy one): drop it.
        await store.del(key);
        await store.del(IDB_OWNER_KEY);
        return null;
      }
      return (await store.get(key)) ?? null;
    },
    setItem: async (key: string, value: string): Promise<void> => {
      const userId = await getUserId();
      // Signed out: there is nobody to own the snapshot, so don't write one.
      if (!userId) return;
      await store.set(IDB_OWNER_KEY, userId);
      await store.set(key, value);
    },
    removeItem: async (key: string): Promise<void> => {
      await store.del(key);
      await store.del(IDB_OWNER_KEY);
    },
  };
}

export function createIdbPersister() {
  if (!hasIndexedDB()) return undefined;
  return createAsyncStoragePersister({
    key: IDB_KEY,
    storage: createOwnerScopedStorage({
      getUserId: () => getLocalUserId(createUntypedClient()),
      store: { get, set, del },
    }),
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
    // Longer than the in-memory gcTime on purpose: a boot after a skipped day
    // (or weekend) must still restore last-seen content and revalidate in the
    // background instead of cold-starting to spinners.
    maxAge: PERSIST_MAX_AGE,
    buster: CACHE_BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) =>
        query.state.status === 'success' &&
        shouldPersistQueryKey(query.queryKey),
    },
  };
}
