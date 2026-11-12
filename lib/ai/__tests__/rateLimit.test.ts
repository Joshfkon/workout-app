import { AI_DAILY_LIMITS, consumeAiQuota } from '@/lib/ai/rateLimit';

describe('consumeAiQuota', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it('passes the server-side limit for the feature and allows when under it', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    await expect(consumeAiQuota({ rpc }, 'coach_chat')).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('consume_ai_quota', {
      p_feature: 'coach_chat',
      p_daily_limit: AI_DAILY_LIMITS.coach_chat,
    });
  });

  it('refuses only when the database says the user is at the limit', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: false, error: null });
    await expect(consumeAiQuota({ rpc }, 'meal_parse')).resolves.toBe(false);
  });

  it('fails open (and logs) when the counter is unavailable', async () => {
    const rpcError = jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    await expect(consumeAiQuota({ rpc: rpcError }, 'label_scan')).resolves.toBe(true);

    const rpcThrows = jest.fn().mockRejectedValue(new Error('network'));
    await expect(consumeAiQuota({ rpc: rpcThrows }, 'label_scan')).resolves.toBe(true);

    // A client stub with no rpc at all (older test doubles) must not crash.
    await expect(consumeAiQuota({}, 'label_scan')).resolves.toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  it('has a positive whole-number limit for every feature', () => {
    for (const limit of Object.values(AI_DAILY_LIMITS)) {
      expect(Number.isInteger(limit)).toBe(true);
      expect(limit).toBeGreaterThan(0);
    }
  });
});
