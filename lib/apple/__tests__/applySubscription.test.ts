import { applyAppleSubscription } from '@/lib/apple/applySubscription';
import type { AppleTransactionPayload } from '@/lib/apple/subscriptionState';

const NOW = new Date('2026-11-24T12:00:00Z');
type Row = Record<string, unknown> & { user_id: string };

/** Tiny in-memory stand-in for the two queries the function makes. */
function fakeAdmin(rows: Row[]) {
  return {
    rows,
    from() {
      return {
        select() {
          return {
            eq(col: string, val: unknown) {
              return {
                maybeSingle: async () => ({ data: rows.find((r) => r[col] === val) ?? null, error: null }),
              };
            },
          };
        },
        upsert: async (row: Row) => {
          const i = rows.findIndex((r) => r.user_id === row.user_id);
          if (i >= 0) rows[i] = { ...rows[i], ...row };
          else rows.push(row);
          return { error: null };
        },
      };
    },
  };
}

const tx = (o: Partial<AppleTransactionPayload> = {}): AppleTransactionPayload => ({
  transactionId: 't1', originalTransactionId: 'orig-1', productId: 'app.hypertrack.workout.pro.monthly',
  bundleId: 'app.hypertrack.workout', environment: 'Sandbox',
  purchaseDate: NOW.getTime() - 86_400_000, expiresDate: NOW.getTime() + 29 * 86_400_000, ...o,
});

const run = (admin: ReturnType<typeof fakeAdmin>, user: string, t = tx()) => applyAppleSubscription(admin as never, user, t, null, NOW);

describe('applyAppleSubscription', () => {
  it('creates an active Apple row for a free user', async () => {
    const admin = fakeAdmin([]);
    const r = await run(admin, 'u1');
    expect(r).toMatchObject({ ok: true, changedTier: true });
    expect(admin.rows[0]).toMatchObject({ user_id: 'u1', tier: 'pro', status: 'active', billing_source: 'apple', apple_original_transaction_id: 'orig-1' });
  });

  it('refuses a subscription already recorded on another account', async () => {
    const admin = fakeAdmin([{ user_id: 'u2', apple_original_transaction_id: 'orig-1' }]);
    expect(await run(admin, 'u1')).toMatchObject({ ok: false, reason: 'other_account' });
  });

  it('never touches a lifetime promo', async () => {
    const admin = fakeAdmin([{ user_id: 'u1', is_lifetime: true, promo_code_id: 'p', tier: 'elite', status: 'active' }]);
    expect(await run(admin, 'u1')).toMatchObject({ ok: false, reason: 'lifetime_promo' });
    expect(admin.rows[0].tier).toBe('elite');
  });

  it('an expired Apple sub does not end an active web (Stripe) subscription', async () => {
    const admin = fakeAdmin([{ user_id: 'u1', stripe_subscription_id: 'sub_1', billing_source: null, tier: 'pro', status: 'active' }]);
    await run(admin, 'u1', tx({ expiresDate: NOW.getTime() - 1 }));
    expect(admin.rows[0]).toMatchObject({ tier: 'pro', status: 'active', apple_original_transaction_id: 'orig-1' });
  });

  it('an active Apple Elite raises a web Pro subscriber, never lowers', async () => {
    const admin = fakeAdmin([{ user_id: 'u1', stripe_subscription_id: 'sub_1', tier: 'pro', status: 'active' }]);
    await run(admin, 'u1', tx({ productId: 'app.hypertrack.workout.elite.monthly' }));
    expect(admin.rows[0]).toMatchObject({ tier: 'elite', status: 'active' });
  });

  it('expiry downgrades an Apple-billed row', async () => {
    const admin = fakeAdmin([{ user_id: 'u1', billing_source: 'apple', apple_original_transaction_id: 'orig-1', tier: 'pro', status: 'active' }]);
    await run(admin, 'u1', tx({ expiresDate: NOW.getTime() - 1 }));
    expect(admin.rows[0]).toMatchObject({ tier: 'free', status: 'canceled' });
  });
});
