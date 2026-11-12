/** @jest-environment jsdom */
jest.mock('idb-keyval', () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/supabase/client', () => ({ createUntypedClient: jest.fn() }));

import { QueryClient } from '@tanstack/react-query';
import { del } from 'idb-keyval';
import {
  CACHE_OWNER_KEY,
  clearUserLocalStorage,
  ensureCacheOwner,
  purgeUserCaches,
} from '../clientCachePurge';
import { IDB_KEY, IDB_OWNER_KEY } from '../idbPersister';
import { useUserStore, userFromRow } from '@/stores/userStore';

const cacheDelete = jest.fn().mockResolvedValue(true);

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  (globalThis as unknown as { caches: unknown }).caches = {
    keys: jest.fn().mockResolvedValue(['hypertrack-v7']),
    delete: cacheDelete,
  };
  useUserStore.setState({ user: null });
});

afterEach(() => {
  delete (globalThis as unknown as { caches?: unknown }).caches;
});

describe('clearUserLocalStorage', () => {
  it("removes every user's data snapshot (scoped and legacy keys) and nothing else", () => {
    localStorage.setItem('weight_history_cache', 'legacy');
    localStorage.setItem('weight_history_cache:user-a', 'a');
    localStorage.setItem('dashboard_data_cache:user-a', 'a');
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('weight_history_cache_unrelated', 'keep');

    clearUserLocalStorage();

    expect(localStorage.getItem('weight_history_cache')).toBeNull();
    expect(localStorage.getItem('weight_history_cache:user-a')).toBeNull();
    expect(localStorage.getItem('dashboard_data_cache:user-a')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem('weight_history_cache_unrelated')).toBe('keep');
  });
});

describe('purgeUserCaches', () => {
  it('clears the query cache, persisted snapshot, Cache Storage, localStorage and the user store', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['analytics', 'main'], { scans: ['private'] });
    localStorage.setItem('dashboard_data_cache:user-a', 'a');
    useUserStore.setState({ user: userFromRow({ id: 'user-a' }) });

    await purgeUserCaches(queryClient);

    expect(queryClient.getQueryData(['analytics', 'main'])).toBeUndefined();
    expect(del).toHaveBeenCalledWith(IDB_KEY);
    expect(del).toHaveBeenCalledWith(IDB_OWNER_KEY);
    expect(cacheDelete).toHaveBeenCalledWith('hypertrack-v7');
    expect(localStorage.getItem('dashboard_data_cache:user-a')).toBeNull();
    expect(useUserStore.getState().user).toBeNull();
  });

  it('does not throw when Cache Storage is unavailable', async () => {
    delete (globalThis as unknown as { caches?: unknown }).caches;
    await expect(purgeUserCaches()).resolves.toBeUndefined();
  });
});

describe('ensureCacheOwner', () => {
  it('records the owner on first run without purging', async () => {
    localStorage.setItem('dashboard_data_cache:user-a', 'a');
    await expect(ensureCacheOwner('user-a')).resolves.toBe(false);
    expect(localStorage.getItem(CACHE_OWNER_KEY)).toBe('user-a');
    expect(localStorage.getItem('dashboard_data_cache:user-a')).toBe('a');
  });

  it("purges the previous user's caches when a different user is signed in", async () => {
    localStorage.setItem(CACHE_OWNER_KEY, 'user-a');
    localStorage.setItem('weight_history_cache:user-a', 'a');
    useUserStore.setState({ user: userFromRow({ id: 'user-a' }) });

    await expect(ensureCacheOwner('user-b')).resolves.toBe(true);

    expect(localStorage.getItem('weight_history_cache:user-a')).toBeNull();
    expect(cacheDelete).toHaveBeenCalled();
    expect(useUserStore.getState().user).toBeNull();
    expect(localStorage.getItem(CACHE_OWNER_KEY)).toBe('user-b');
  });

  it('purges when only the persisted store belongs to someone else', async () => {
    useUserStore.setState({ user: userFromRow({ id: 'user-a' }) });
    await expect(ensureCacheOwner('user-b')).resolves.toBe(true);
    expect(useUserStore.getState().user).toBeNull();
  });

  it('is a no-op while signed out', async () => {
    localStorage.setItem(CACHE_OWNER_KEY, 'user-a');
    await expect(ensureCacheOwner(null)).resolves.toBe(false);
    expect(localStorage.getItem(CACHE_OWNER_KEY)).toBe('user-a');
  });
});
