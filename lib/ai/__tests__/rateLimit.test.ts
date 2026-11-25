import { AI_DAILY_LIMITS, consumeAiQuota } from '@/lib/ai/rateLimit';

describe('consumeAiQuota', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it('passes the paid limit by default and allows when under it', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    await expect(consumeAiQuota({ rpc }, 'coach_chat')).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('consume_ai_quota', {
      p_feature: 'coach_chat',
      p_daily_limit: AI_DAILY_LIMITS.coach_chat.paid,
    });
  });

  it('passes the lower trial limit for trial users', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    await consumeAiQuota({ rpc }, 'meal_parse', 'trial');
    expect(rpc).toHaveBeenCalledWith('consume_ai_quota', {
      p_feature: 'meal_parse',
      p_daily_limit: AI_DAILY_LIMITS.meal_parse.trial,
    });
  });

  it('refuses when the database says the user is at the limit', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: false, error: null });
    await expect(consumeAiQuota({ rpc }, 'meal_parse')).resolves.toBe(false);
  });

  it('fails open for paid users (and logs) when the counter is unavailable', async () => {
    const rpcError = jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    await expect(consumeAiQuota({ rpc: rpcError }, 'label_scan', 'paid')).resolves.toBe(true);

    const rpcThrows = jest.fn().mockRejectedValue(new Error('network'));
    await expect(consumeAiQuota({ rpc: rpcThrows }, 'label_scan', 'paid')).resolves.toBe(true);

    // A client stub with no rpc at all must not crash.
    await expect(consumeAiQuota({}, 'label_scan')).resolves.toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  it('fails closed for trial and free users when the counter is unavailable', async () => {
    const rpcError = jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    await expect(consumeAiQuota({ rpc: rpcError }, 'label_scan', 'trial')).resolves.toBe(false);
    await expect(consumeAiQuota({ rpc: rpcError }, 'label_scan', 'free')).resolves.toBe(false);

    const rpcThrows = jest.fn().mockRejectedValue(new Error('network'));
    await expect(consumeAiQuota({ rpc: rpcThrows }, 'label_scan', 'trial')).resolves.toBe(false);
  });

  it('has whole-number limits: paid and trial positive, free <= trial <= paid', () => {
    for (const { paid, trial, free } of Object.values(AI_DAILY_LIMITS)) {
      for (const limit of [paid, trial, free]) expect(Number.isInteger(limit)).toBe(true);
      expect(paid).toBeGreaterThan(0);
      expect(trial).toBeGreaterThan(0);
      expect(free).toBeGreaterThanOrEqual(0);
      expect(trial).toBeLessThanOrEqual(paid);
      expect(free).toBeLessThanOrEqual(trial);
    }
  });
});
