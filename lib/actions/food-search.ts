'use server';

/**
 * Server-action proxy for USDA food search.
 *
 * Client components must call these instead of the usdaService functions
 * directly: USDA_API_KEY is a server-only env var, so in the browser the
 * service silently falls back to DEMO_KEY (~30 requests/hour). Routing
 * through the server uses the real key and lets repeat searches share an
 * in-memory cache.
 */

import { searchFoods, getFoodDetails, type FoodSearchResult } from '@/services/usdaService';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const SEARCH_TTL_MS = 10 * 60 * 1000;
const DETAILS_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;

const searchCache = new Map<string, CacheEntry<{ foods: FoodSearchResult[]; error?: string }>>();
const detailsCache = new Map<string, CacheEntry<{ food?: FoodSearchResult; error?: string }>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  if (cache.size >= MAX_ENTRIES) {
    // Drop the oldest entry (Map preserves insertion order)
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function searchFoodsAction(query: string): Promise<{
  foods: FoodSearchResult[];
  error?: string;
}> {
  const key = query.trim().toLowerCase();
  if (!key) return { foods: [], error: 'Please enter a search query' };

  const cached = getCached(searchCache, key);
  if (cached) return cached;

  const result = await searchFoods(query);

  // Cache real responses (including legitimate empty results), but not
  // transient failures like rate limits or network errors.
  const isTransientError = result.error && result.foods.length === 0 && result.error !== 'No foods found matching your search';
  if (!isTransientError) {
    setCached(searchCache, key, result, SEARCH_TTL_MS);
  }
  return result;
}

export async function getFoodDetailsAction(foodId: string): Promise<{
  food?: FoodSearchResult;
  error?: string;
}> {
  const cached = getCached(detailsCache, foodId);
  if (cached) return cached;

  const result = await getFoodDetails(foodId);
  if (result.food) {
    setCached(detailsCache, foodId, result, DETAILS_TTL_MS);
  }
  return result;
}
