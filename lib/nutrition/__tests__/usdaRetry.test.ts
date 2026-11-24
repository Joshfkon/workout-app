import { isTransientUsdaError, searchUsdaWithRetry, USDA_RETRY_DELAYS_MS } from '../usdaRetry';

const RATE = 'Rate limit exceeded. Please wait a moment and try again.';
const ok = { foods: [{ id: 1 }] };

describe('isTransientUsdaError', () => {
  it('retries rate limits and network failures, not answers', () => {
    expect(isTransientUsdaError(RATE)).toBe(true);
    expect(isTransientUsdaError('Unable to search foods. Please try again.')).toBe(true);
    expect(isTransientUsdaError('No foods found matching your search')).toBe(false);
    expect(isTransientUsdaError('Search query is too long')).toBe(false);
    expect(isTransientUsdaError('Sign in to search foods')).toBe(false);
    expect(isTransientUsdaError(undefined)).toBe(false);
  });
});

describe('searchUsdaWithRetry', () => {
  it('waits with a growing pause and returns the first good result', async () => {
    const sleeps: number[] = [];
    const search = jest
      .fn()
      .mockResolvedValueOnce({ foods: [], error: RATE })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(ok);
    const result = await searchUsdaWithRetry(search, { sleep: async (ms) => void sleeps.push(ms) });
    expect(result).toBe(ok);
    expect(search).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([USDA_RETRY_DELAYS_MS[0], USDA_RETRY_DELAYS_MS[1]]);
    expect(USDA_RETRY_DELAYS_MS[1]).toBeGreaterThan(USDA_RETRY_DELAYS_MS[0]);
    expect(USDA_RETRY_DELAYS_MS[2]).toBeGreaterThan(USDA_RETRY_DELAYS_MS[1]);
  });

  it('returns the last failure after every retry is used, never throws', async () => {
    const search = jest.fn().mockRejectedValue(new Error('down'));
    const result = await searchUsdaWithRetry(search, { delays: [0, 0], sleep: async () => {} });
    expect(search).toHaveBeenCalledTimes(3);
    expect(result.foods).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('does not retry an answer that will not change', async () => {
    const none = { foods: [], error: 'No foods found matching your search' };
    const search = jest.fn().mockResolvedValue(none);
    expect(await searchUsdaWithRetry(search, { sleep: async () => {} })).toBe(none);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('stops once the search is no longer wanted', async () => {
    let cancelled = false;
    const search = jest.fn().mockImplementation(async () => {
      cancelled = true;
      return { foods: [], error: RATE };
    });
    await searchUsdaWithRetry(search, { sleep: async () => {}, isCancelled: () => cancelled });
    expect(search).toHaveBeenCalledTimes(1);
  });
});
