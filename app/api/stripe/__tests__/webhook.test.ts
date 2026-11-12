/**
 * @jest-environment node
 */
const mockConstructEvent = jest.fn();
const mockRetrieve = jest.fn();
jest.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: (...a: unknown[]) => mockConstructEvent(...a) },
    subscriptions: { retrieve: (...a: unknown[]) => mockRetrieve(...a) },
  },
  getTierFromPriceId: () => 'pro',
}));

let existingRow: Record<string, unknown> | null = null;
let writeError: { message: string } | null = null;
const writes: Array<{ table: string; op: string; payload?: Record<string, unknown> }> = [];
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (table: string) => {
      if (table === 'stripe_processed_events') {
        return {
          insert: async () => { writes.push({ table, op: 'claim' }); return { error: null }; },
          delete: () => ({ eq: async () => { writes.push({ table, op: 'release' }); return { error: null }; } }),
        };
      }
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: existingRow, error: null });
      builder.update = (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'update', payload });
        return { eq: async () => ({ error: writeError }) };
      };
      builder.upsert = async (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'upsert', payload });
        return { error: writeError };
      };
      return builder;
    },
  })),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/stripe/webhook/route';

const subscription = {
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  items: { data: [{ price: { id: 'price_pro_m' } }] },
  metadata: { supabase_user_id: 'user-1' },
  trial_end: null,
  cancel_at_period_end: false,
};

function post() {
  return POST(
    new NextRequest('https://example.test/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'sig' },
      body: '{}',
    })
  );
}

describe('POST /api/stripe/webhook', () => {
  const env = process.env;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    existingRow = null;
    writeError = null;
    writes.length = 0;
    process.env = {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      STRIPE_WEBHOOK_SECRET: 'whsec',
    };
    mockRetrieve.mockResolvedValue(subscription);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = env;
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('writes the subscription and acknowledges', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_1', type: 'customer.subscription.updated', data: { object: subscription },
    });
    const response = await post();
    expect(response.status).toBe(200);
    expect(writes.map((w) => w.op)).toEqual(['claim', 'upsert']);
    expect(writes[1].payload).toMatchObject({ user_id: 'user-1', tier: 'pro', status: 'active' });
  });

  it('returns 500 and releases the idempotency claim when the DB write fails, so Stripe retries', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_1', type: 'customer.subscription.updated', data: { object: subscription },
    });
    writeError = { message: 'violates check constraint' };
    const response = await post();
    expect(response.status).toBe(500);
    expect(writes.map((w) => w.op)).toEqual(['claim', 'upsert', 'release']);
  });

  it.each([
    ['customer.subscription.deleted', subscription],
    ['invoice.payment_failed', { customer: 'cus_1' }],
  ])('also surfaces a failed write for %s', async (type, object) => {
    existingRow = { is_lifetime: false, promo_code_id: null, stripe_subscription_id: 'sub_1' };
    mockConstructEvent.mockReturnValue({ id: 'evt_2', type, data: { object } });
    writeError = { message: 'db down' };
    const response = await post();
    expect(response.status).toBe(500);
    expect(writes[writes.length - 1].op).toBe('release');
  });

  it('does not downgrade when a subscription other than the one on record ends', async () => {
    existingRow = { is_lifetime: false, promo_code_id: null, stripe_subscription_id: 'sub_current' };
    mockConstructEvent.mockReturnValue({
      id: 'evt_3', type: 'customer.subscription.deleted', data: { object: subscription },
    });
    const response = await post();
    expect(response.status).toBe(200);
    expect(writes.map((w) => w.op)).toEqual(['claim']);
  });

  it('rejects a bad signature', async () => {
    mockConstructEvent.mockImplementation(() => { throw new Error('bad sig'); });
    const response = await post();
    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });
});
