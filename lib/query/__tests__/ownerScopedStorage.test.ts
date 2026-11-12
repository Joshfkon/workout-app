jest.mock('idb-keyval', () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }));
jest.mock('@/lib/supabase/client', () => ({ createUntypedClient: jest.fn() }));

import { createOwnerScopedStorage, IDB_KEY, IDB_OWNER_KEY } from '../idbPersister';

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async (key: string) => data.get(key),
    set: async (key: string, value: string) => void data.set(key, value),
    del: async (key: string) => void data.delete(key),
  };
}

describe('createOwnerScopedStorage', () => {
  it("restores a snapshot only for the user who wrote it", async () => {
    const store = memoryStore();
    let userId: string | null = 'user-a';
    const storage = createOwnerScopedStorage({ getUserId: async () => userId, store });

    await storage.setItem(IDB_KEY, 'A-private-data');
    expect(store.data.get(IDB_OWNER_KEY)).toBe('user-a');
    await expect(storage.getItem(IDB_KEY)).resolves.toBe('A-private-data');

    // A's session expired while the app was closed; B signs in.
    userId = 'user-b';
    await expect(storage.getItem(IDB_KEY)).resolves.toBeNull();
    // …and the foreign snapshot is deleted, not just hidden.
    expect(store.data.has(IDB_KEY)).toBe(false);
    expect(store.data.has(IDB_OWNER_KEY)).toBe(false);
  });

  it('discards an un-owned legacy snapshot', async () => {
    const store = memoryStore({ [IDB_KEY]: 'legacy' });
    const storage = createOwnerScopedStorage({ getUserId: async () => 'user-a', store });
    await expect(storage.getItem(IDB_KEY)).resolves.toBeNull();
    expect(store.data.has(IDB_KEY)).toBe(false);
  });

  it('never restores or writes while signed out', async () => {
    const store = memoryStore({ [IDB_KEY]: 'A-private-data', [IDB_OWNER_KEY]: 'user-a' });
    const storage = createOwnerScopedStorage({ getUserId: async () => null, store });
    await expect(storage.getItem(IDB_KEY)).resolves.toBeNull();
    await storage.setItem(IDB_KEY, 'written-while-signed-out');
    expect(store.data.has(IDB_KEY)).toBe(false);
  });

  it('removeItem clears the snapshot and its owner', async () => {
    const store = memoryStore({ [IDB_KEY]: 'x', [IDB_OWNER_KEY]: 'user-a' });
    const storage = createOwnerScopedStorage({ getUserId: async () => 'user-a', store });
    await storage.removeItem(IDB_KEY);
    expect(store.data.size).toBe(0);
  });
});
