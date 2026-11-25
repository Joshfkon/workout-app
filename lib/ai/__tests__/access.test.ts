/**
 * The server-side AI gate: kill switch, plan, then quota by plan.
 * Uses the real hasFeatureAccess, so these cases match what the UI's
 * canAccess() shows.
 */
const mockGetSubscriptionData = jest.fn();
jest.mock('@/lib/subscription', () => ({
  ...jest.requireActual('@/lib/subscription'),
  getSubscriptionData: (...args: unknown[]) => mockGetSubscriptionData(...args),
}));

import { authorizeAiRequest, checkAiAccess, AI_DISABLED_MESSAGE } from '@/lib/ai/access';
import { AI_DAILY_LIMITS, AI_RATE_LIMIT_MESSAGE } from '@/lib/ai/rateLimit';

const sub = (tier: string, status: string, isTrialing = false) => ({
  tier,
  status,
  isTrialing,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
});

const FREE_AFTER_TRIAL = sub('free', 'canceled');
const IN_TRIAL = sub('free', 'trialing', true);
const PRO = sub('pro', 'active');
const ELITE = sub('elite', 'active');
const LAPSED_PRO = sub('pro', 'canceled');

describe('AI access', () => {
  const env = process.env;
  let errorSpy: jest.SpyInstance;
  let rpc: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env };
    delete process.env.AI_FEATURES_DISABLED;
    rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = env;
    errorSpy.mockRestore();
  });

  it('refuses free users after the trial, without spending quota', async () => {
    mockGetSubscriptionData.mockResolvedValue(FREE_AFTER_TRIAL);
    for (const feature of ['meal_parse', 'label_scan', 'photo_bf_estimate', 'plan_review', 'motion_coach', 'coach_chat', 'workout_coach_notes'] as const) {
      const result = await authorizeAiRequest({ rpc }, 'u1', feature);
      expect(result).toMatchObject({ ok: false, reason: 'plan' });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a lapsed subscription', async () => {
    mockGetSubscriptionData.mockResolvedValue(LAPSED_PRO);
    await expect(authorizeAiRequest({ rpc }, 'u1', 'meal_parse')).resolves.toMatchObject({ ok: false, reason: 'plan' });
  });

  it('gives Pro the Pro AI features but not the coach', async () => {
    mockGetSubscriptionData.mockResolvedValue(PRO);
    await expect(authorizeAiRequest({ rpc }, 'u1', 'meal_parse')).resolves.toEqual({ ok: true });
    const coach = await authorizeAiRequest({ rpc }, 'u1', 'coach_chat');
    expect(coach).toMatchObject({ ok: false, reason: 'plan' });
    expect(coach.ok === false && coach.message).toMatch(/Elite/);
    const notes = await authorizeAiRequest({ rpc }, 'u1', 'workout_coach_notes');
    expect(notes).toMatchObject({ ok: false, reason: 'plan' });
  });

  it('gives Elite everything at the paid cap', async () => {
    mockGetSubscriptionData.mockResolvedValue(ELITE);
    await expect(authorizeAiRequest({ rpc }, 'u1', 'coach_chat')).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('consume_ai_quota', {
      p_feature: 'coach_chat',
      p_daily_limit: AI_DAILY_LIMITS.coach_chat.paid,
    });
  });

  it('gives the trial everything, at the lower trial cap, failing closed', async () => {
    mockGetSubscriptionData.mockResolvedValue(IN_TRIAL);
    await expect(checkAiAccess('u1', 'coach_chat')).resolves.toEqual({ allowed: true, quotaTier: 'trial' });
    await expect(authorizeAiRequest({ rpc }, 'u1', 'photo_bf_estimate')).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('consume_ai_quota', {
      p_feature: 'photo_bf_estimate',
      p_daily_limit: AI_DAILY_LIMITS.photo_bf_estimate.trial,
    });

    rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    await expect(authorizeAiRequest({ rpc }, 'u1', 'meal_parse')).resolves.toMatchObject({ ok: false, reason: 'limit' });
  });

  it('reports the daily limit when the quota is used up', async () => {
    mockGetSubscriptionData.mockResolvedValue(PRO);
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(authorizeAiRequest({ rpc }, 'u1', 'label_scan')).resolves.toEqual({
      ok: false,
      reason: 'limit',
      message: AI_RATE_LIMIT_MESSAGE,
    });
  });

  it('fails closed when the subscription cannot be read', async () => {
    mockGetSubscriptionData.mockResolvedValue(null);
    await expect(authorizeAiRequest({ rpc }, 'u1', 'meal_parse')).resolves.toMatchObject({ ok: false, reason: 'plan' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('the kill switch turns every feature off, even for Elite', async () => {
    process.env.AI_FEATURES_DISABLED = 'true';
    mockGetSubscriptionData.mockResolvedValue(ELITE);
    await expect(authorizeAiRequest({ rpc }, 'u1', 'coach_chat')).resolves.toEqual({
      ok: false,
      reason: 'disabled',
      message: AI_DISABLED_MESSAGE,
    });
    expect(mockGetSubscriptionData).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
