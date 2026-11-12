/**
 * The server gate must agree with the UI gate (useSubscription().canAccess),
 * which is hasFeatureAccess(tier, status, feature, isTrialing).
 */
jest.mock('@/lib/subscription', () => {
  const actual = jest.requireActual('@/lib/subscription');
  return { ...actual, getSubscriptionData: jest.fn() };
});

import { getSubscriptionData, type SubscriptionData } from '@/lib/subscription';
import { requireFeatureAccess, userHasFeatureAccess } from '@/lib/subscription/requireTier';

const mockGet = getSubscriptionData as jest.MockedFunction<typeof getSubscriptionData>;

function sub(overrides: Partial<SubscriptionData>): SubscriptionData {
  return {
    tier: 'free',
    status: 'canceled',
    isTrialing: false,
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe('userHasFeatureAccess', () => {
  it('denies AI coaching to a free user whose trial is over', async () => {
    mockGet.mockResolvedValue(sub({}));
    await expect(userHasFeatureAccess('u1', 'ai-coaching')).resolves.toBe(false);
  });

  it('allows AI coaching during the trial (Elite-level access)', async () => {
    mockGet.mockResolvedValue(sub({ status: 'trialing', isTrialing: true }));
    await expect(userHasFeatureAccess('u1', 'ai-coaching')).resolves.toBe(true);
  });

  it('allows active Elite (paid, lifetime or promo are all just active rows)', async () => {
    mockGet.mockResolvedValue(sub({ tier: 'elite', status: 'active' }));
    await expect(userHasFeatureAccess('u1', 'ai-coaching')).resolves.toBe(true);
  });

  it('denies AI coaching to active Pro but allows the mesocycle builder', async () => {
    mockGet.mockResolvedValue(sub({ tier: 'pro', status: 'active' }));
    await expect(userHasFeatureAccess('u1', 'ai-coaching')).resolves.toBe(false);
    await expect(userHasFeatureAccess('u1', 'mesocycleBuilder')).resolves.toBe(true);
  });

  it.each(['past_due', 'canceled', 'unpaid', 'incomplete_expired', 'paused'] as const)(
    'denies Elite features when the subscription is %s',
    async (status) => {
      mockGet.mockResolvedValue(sub({ tier: 'elite', status }));
      await expect(userHasFeatureAccess('u1', 'ai-coaching')).resolves.toBe(false);
    }
  );

  it('fails closed when the subscription cannot be read', async () => {
    mockGet.mockResolvedValue(null);
    await expect(userHasFeatureAccess('u1', 'ai-coaching')).resolves.toBe(false);
  });
});

describe('requireFeatureAccess', () => {
  it('throws a plain, user-readable Error when access is denied', async () => {
    mockGet.mockResolvedValue(sub({}));
    await expect(requireFeatureAccess('u1', 'ai-coaching')).rejects.toThrow(/Elite/);
  });

  it('resolves when access is allowed', async () => {
    mockGet.mockResolvedValue(sub({ tier: 'elite', status: 'active' }));
    await expect(requireFeatureAccess('u1', 'ai-coaching')).resolves.toBeUndefined();
  });
});
