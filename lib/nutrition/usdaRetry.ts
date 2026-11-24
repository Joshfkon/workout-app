/**
 * Quiet automatic retry for the Add food sheet's USDA search.
 *
 * Panel finding (r21): a USDA "busy right now" line interrupted logging. USDA
 * rate limits and network blips usually clear within a few seconds, so the
 * sheet retries on its own (still showing "Searching USDA…") with a growing
 * pause, and only says anything if every attempt failed.
 *
 * Answers that won't change on a retry (no results, query too long, signed
 * out) come back at once.
 */

/** Pauses before each automatic retry: 3 retries over ~6 s in total. */
export const USDA_RETRY_DELAYS_MS: readonly number[] = [700, 1600, 3500];

export interface UsdaSearchResult<T = unknown> {
  foods: T[];
  error?: string;
}

/** True for a failure that may clear on its own (rate limit, network, server). */
export function isTransientUsdaError(raw: string | undefined): boolean {
  if (!raw) return false;
  const msg = raw.toLowerCase();
  if (msg.includes('no foods found')) return false;
  if (msg.includes('too long')) return false;
  if (msg.includes('sign in')) return false;
  if (msg.includes('enter a search')) return false;
  return true;
}

export interface RetryOptions {
  delays?: readonly number[];
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Stop retrying once the search is no longer wanted (new query, sheet closed). */
  isCancelled?: () => boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `search`, retrying transient failures (an error result with no foods,
 * or a thrown error) after each pause in `delays`. Returns the first good
 * result, or the last failure once the retries are used up. A thrown error on
 * the final attempt is returned as `{ foods: [], error }`, never thrown.
 */
export async function searchUsdaWithRetry<T>(
  search: () => Promise<UsdaSearchResult<T>>,
  { delays = USDA_RETRY_DELAYS_MS, sleep = defaultSleep, isCancelled = () => false }: RetryOptions = {}
): Promise<UsdaSearchResult<T>> {
  let last: UsdaSearchResult<T> = { foods: [], error: 'Search failed. Please try again.' };
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) {
      await sleep(delays[attempt - 1]);
      if (isCancelled()) return last;
    }
    try {
      const result = await search();
      if (!(result.error && result.foods.length === 0 && isTransientUsdaError(result.error))) {
        return result;
      }
      last = result;
    } catch {
      last = { foods: [], error: 'Search failed. Please try again.' };
    }
    if (isCancelled()) return last;
  }
  return last;
}
