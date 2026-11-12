/**
 * @jest-environment node
 */
const mockCheckoutCreate = jest.fn();
const mockPortalCreate = jest.fn();
const mockCustomerCreate = jest.fn();
jest.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: (...a: unknown[]) => mockCheckoutCreate(...a) } },
    billingPortal: { sessions: { create: (...a: unknown[]) => mockPortalCreate(...a) } },
    customers: { create: (...a: unknown[]) => mockCustomerCreate(...a) },
  },
  STRIPE_PRICES: {
    pro: { monthly: 'price_pro_m', yearly: 'price_pro_y' },
    elite: { monthly: 'price_elite_m', yearly: 'price_elite_y' },
  },
  getTierFromPriceId: (id: string) =>
    id.startsWith('price_pro') ? 'pro' : id.startsWith('price_elite') ? 'elite' : 'free',
}));

let subscriptionRow: Record<string, unknown> | null = null;
const writes: Array<{ op: string; payload: Record<string, unknown> }> = [];
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'a@b.test' } }, error: null }) },
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: subscriptionRow, error: null });
      builder.update = (payload: Record<string, unknown>) => {
        writes.push({ op: 'update', payload });
        return { eq: async () => ({ error: null }) };
      };
      builder.upsert = async (payload: Record<string, unknown>) => {
        writes.push({ op: 'upsert', payload });
        return { error: null };
      };
      return builder;
    },
  })),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/stripe/checkout/route';

function post(body: unknown) {
  return POST(
    new NextRequest('https://example.test/api/stripe/checkout', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

describe('POST /api/stripe/checkout', () => {
  const env = process.env;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptionRow = null;
    writes.length = 0;
    process.env = {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      NEXT_PUBLIC_APP_URL: 'https://app.test',
    };
    mockCustomerCreate.mockResolvedValue({ id: 'cus_new' });
    mockCheckoutCreate.mockResolvedValue({ url: 'https://stripe.test/checkout' });
    mockPortalCreate.mockResolvedValue({ url: 'https://stripe.test/portal' });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = env;
    errorSpy.mockRestore();
  });

  it.each([
    ['pro', 'monthly', 'price_pro_m'],
    ['pro', 'yearly', 'price_pro_y'],
    ['elite', 'monthly', 'price_elite_m'],
    ['price_pro_m', 'yearly', 'price_pro_y'],
  ])('charges the %s / %s price (%s)', async (priceId, billingPeriod, expected) => {
    const response = await post({ priceId, billingPeriod });
    expect(response.status).toBe(200);
    expect(mockCheckoutCreate.mock.calls[0][0].line_items).toEqual([{ price: expected, quantity: 1 }]);
  });

  it('rejects an unrecognised price instead of treating it as Elite', async () => {
    const response = await post({ priceId: 'price_someone_elses', billingPeriod: 'monthly' });
    expect(response.status).toBe(400);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  it('returns to the pricing page, which shows the success message', async () => {
    await post({ priceId: 'elite', billingPeriod: 'monthly' });
    expect(mockCheckoutCreate.mock.calls[0][0].success_url).toBe(
      'https://app.test/dashboard/pricing?checkout=success'
    );
  });

  it('sends a user with a live subscription to the billing portal, not a second checkout', async () => {
    subscriptionRow = { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status: 'active' };
    const response = await post({ priceId: 'elite', billingPeriod: 'monthly' });
    expect(await response.json()).toEqual({ url: 'https://stripe.test/portal', portal: true });
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('lets a previously cancelled customer check out again', async () => {
    subscriptionRow = { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status: 'canceled' };
    const response = await post({ priceId: 'pro', billingPeriod: 'monthly' });
    expect((await response.json()).url).toBe('https://stripe.test/checkout');
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  it('does not reset an existing (e.g. promo) row when attaching a new Stripe customer', async () => {
    subscriptionRow = { stripe_customer_id: null, stripe_subscription_id: null, status: 'active' };
    await post({ priceId: 'pro', billingPeriod: 'monthly' });
    expect(writes).toEqual([{ op: 'update', payload: { stripe_customer_id: 'cus_new' } }]);
  });
});
