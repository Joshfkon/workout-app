/**
 * Shared TTL Cache Utility
 *
 * Provides a generic in-memory cache with time-based expiration.
 * Used by services to avoid duplicating caching logic.
 */

interface CacheEntry<V> {
  value: V;
  expires: number;
}

export interface TTLCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  invalidate(key: K): void;
  clear(): void;
  has(key: K): boolean;
}

/**
 * Create a TTL (time-to-live) cache with automatic expiration.
 *
 * @param ttlMs - Time in milliseconds before entries expire
 * @returns Cache instance with get/set/invalidate/clear operations
 *
 * @example
 * const cache = createTTLCache<string, Exercise[]>(5 * 60 * 1000); // 5 min TTL
 * cache.set('all', exercises);
 * const cached = cache.get('all'); // undefined after 5 minutes
 */
export function createTTLCache<K, V>(ttlMs: number): TTLCache<K, V> {
  const store = new Map<K, CacheEntry<V>>();

  return {
    get(key: K): V | undefined {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expires) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },

    set(key: K, value: V): void {
      store.set(key, { value, expires: Date.now() + ttlMs });
    },

    invalidate(key: K): void {
      store.delete(key);
    },

    clear(): void {
      store.clear();
    },

    has(key: K): boolean {
      const entry = store.get(key);
      if (!entry) return false;
      if (Date.now() > entry.expires) {
        store.delete(key);
        return false;
      }
      return true;
    },
  };
}
