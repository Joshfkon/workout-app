/**
 * Everything the browser keeps about ONE user outside Supabase's own session:
 * the React Query cache (memory + IndexedDB), the service worker's Cache
 * Storage (server-rendered /dashboard HTML and RSC payloads are per-user), the
 * user-scoped localStorage snapshots, and the persisted user store.
 *
 * Purged on every sign-out and whenever the signed-in identity turns out not
 * to be the one these caches were written for — otherwise the next person to
 * sign in on the same browser gets the previous person's data as first paint.
 */

import type { QueryClient } from '@tanstack/react-query';
import { clearPersistedQueryCache } from './idbPersister';
import { useUserStore } from '@/stores/userStore';

/**
 * localStorage key PREFIXES that hold one user's data. Keys are written as
 * `<prefix>:<userId>`; the bare prefix is the legacy unscoped key, removed too.
 */
export const USER_DATA_LOCAL_STORAGE_PREFIXES = [
  'weight_history_cache',
  'dashboard_data_cache',
] as const;

/** Which user the browser-side caches currently belong to. */
export const CACHE_OWNER_KEY = 'ht:cache-owner';

function isUserDataKey(key: string): boolean {
  return USER_DATA_LOCAL_STORAGE_PREFIXES.some(
    (prefix) => key === prefix || key.startsWith(`${prefix}:`)
  );
}

export function clearUserLocalStorage(storage: Storage | undefined = safeLocalStorage()): void {
  if (!storage) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && isUserDataKey(key)) doomed.push(key);
    }
    doomed.forEach((key) => storage.removeItem(key));
    storage.removeItem(CACHE_OWNER_KEY);
  } catch {
    /* storage unavailable (private mode / blocked) — nothing to clear */
  }
}

/** Delete every Cache Storage bucket (the service worker re-fills it lazily). */
export async function clearCacheStorage(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    /* Cache Storage unavailable — nothing to clear */
  }
}

/**
 * Drop every browser-side cache of the current user's data. Safe to call more
 * than once and never throws — a sign-out must not fail because a cache did.
 */
export async function purgeUserCaches(queryClient?: QueryClient): Promise<void> {
  queryClient?.clear();
  clearUserLocalStorage();
  try {
    useUserStore.getState().signOut();
  } catch {
    /* store storage unavailable */
  }
  await Promise.all([clearPersistedQueryCache(), clearCacheStorage()]);
}

/**
 * Boot-time ownership check for the caches the auth listener can't protect:
 * if they were written for a different user than the one now signed in
 * (session expired while the app was closed, then someone else signed in),
 * purge before recording the new owner. Returns true when a purge ran.
 */
export async function ensureCacheOwner(
  userId: string | null,
  queryClient?: QueryClient
): Promise<boolean> {
  if (!userId) return false;
  const storage = safeLocalStorage();
  let owner: string | null = null;
  try {
    owner = storage?.getItem(CACHE_OWNER_KEY) ?? null;
  } catch {}
  const storeOwner = useUserStore.getState().user?.id ?? null;
  const mismatch = (owner !== null && owner !== userId) || (storeOwner !== null && storeOwner !== userId);
  if (mismatch) await purgeUserCaches(queryClient);
  try {
    storage?.setItem(CACHE_OWNER_KEY, userId);
  } catch {}
  return mismatch;
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
