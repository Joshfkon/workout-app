import { appleSubscriptionState, bestAppleTransaction, type AppleTransactionPayload } from '@/lib/apple/subscriptionState';

const NOW = new Date('2026-11-24T12:00:00Z');
const DAY = 86_400_000;
const t = (o: Partial<AppleTransactionPayload>): AppleTransactionPayload => ({
  transactionId: 't', originalTransactionId: 'o', productId: 'app.hypertrack.workout.pro.monthly', bundleId: 'app.hypertrack.workout',
  purchaseDate: NOW.getTime() - 5 * DAY, expiresDate: NOW.getTime() + 25 * DAY, ...o,
});

describe('appleSubscriptionState', () => {
  it('an unexpired Pro transaction is active Pro until its expiry', () => {
    const s = appleSubscriptionState(t({}), null, NOW);
    expect(s).toMatchObject({ tier: 'pro', status: 'active', cancelAtPeriodEnd: false });
    expect(s.currentPeriodEnd).toBe(new Date(NOW.getTime() + 25 * DAY).toISOString());
  });

  it('expired, refunded or unknown products give no access', () => {
    expect(appleSubscriptionState(t({ expiresDate: NOW.getTime() - 1 }), null, NOW)).toMatchObject({ tier: 'free', status: 'canceled' });
    expect(appleSubscriptionState(t({ revocationDate: NOW.getTime() - DAY }), null, NOW)).toMatchObject({ tier: 'free' });
    expect(appleSubscriptionState(t({ productId: 'something.else' }), null, NOW)).toMatchObject({ tier: 'free' });
  });

  it('a billing grace period keeps access after expiry', () => {
    const s = appleSubscriptionState(t({ expiresDate: NOW.getTime() - DAY }), { gracePeriodExpiresDate: NOW.getTime() + 3 * DAY }, NOW);
    expect(s).toMatchObject({ tier: 'pro', status: 'active' });
  });

  it('renewal turned off shows as ending at period end', () => {
    expect(appleSubscriptionState(t({}), { autoRenewStatus: 0 }, NOW).cancelAtPeriodEnd).toBe(true);
  });

  it('picks the entitlement that grants the most', () => {
    const pro = t({ transactionId: 'p' });
    const elite = t({ transactionId: 'e', productId: 'app.hypertrack.workout.elite.yearly' });
    const expired = t({ transactionId: 'x', productId: 'app.hypertrack.workout.elite.monthly', expiresDate: NOW.getTime() - 1 });
    expect(bestAppleTransaction([pro, expired, elite], NOW)?.transactionId).toBe('e');
    expect(bestAppleTransaction([], NOW)).toBeNull();
  });
});
