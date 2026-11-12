/**
 * Account deletion must stop billing, revoke tokens and remove stored photos
 * BEFORE the auth user (and, by cascade, every row that points at those
 * things) is deleted.
 */
const mockGetUser = jest.fn();
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: mockGetUser } })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }));

const mockStripeList = jest.fn();
const mockStripeCancel = jest.fn();
jest.mock('@/lib/stripe', () => ({
  stripe: { subscriptions: { list: (...a: unknown[]) => mockStripeList(...a), cancel: (...a: unknown[]) => mockStripeCancel(...a) } },
}));

const calls: string[] = [];
let subscriptionRow: Record<string, unknown> | null = null;
let fitbitRows: Array<Record<string, unknown>> = [];
let storageObjects: Record<string, Array<{ id: string; name: string }>> = {};
let storageListError: Record<string, { message: string } | null> = {};
const mockDeleteUser = jest.fn();

function serviceClient() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.maybeSingle = async () => ({ data: table === 'subscriptions' ? subscriptionRow : null, error: null });
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: table === 'wearable_connections' ? fitbitRows : [], error: null });
      return builder;
    },
    storage: {
      from(bucket: string) {
        return {
          list: async (prefix: string) => {
            calls.push(`list:${bucket}/${prefix}`);
            if (storageListError[bucket]) return { data: null, error: storageListError[bucket] };
            return { data: storageObjects[bucket] ?? [], error: null };
          },
          remove: async (paths: string[]) => {
            calls.push(`remove:${bucket}:${paths.join(',')}`);
            storageObjects[bucket] = [];
            return { data: [], error: null };
          },
        };
      },
    },
    auth: { admin: { deleteUser: (...a: unknown[]) => { calls.push('deleteUser'); return mockDeleteUser(...a); } } },
  };
}
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => serviceClient()),
}));

import { deleteAccount } from '@/lib/actions/account';

describe('deleteAccount', () => {
  const env = process.env;
  const realFetch = global.fetch;
  let errorSpy: jest.SpyInstance;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    calls.length = 0;
    subscriptionRow = null;
    fitbitRows = [];
    storageObjects = {};
    storageListError = {};
    process.env = {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      FITBIT_CLIENT_ID: 'fid',
      FITBIT_CLIENT_SECRET: 'fsecret',
    };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockDeleteUser.mockResolvedValue({ error: null });
    mockStripeList.mockImplementation(async () => { calls.push('stripe.list'); return { data: [] }; });
    mockStripeCancel.mockImplementation(async (id: string) => { calls.push(`stripe.cancel:${id}`); return {}; });
    fetchMock = jest.fn(async () => { calls.push('fitbit.revoke'); return { ok: true, status: 200 }; });
    global.fetch = fetchMock as unknown as typeof fetch;
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = env;
    global.fetch = realFetch;
    errorSpy.mockRestore();
  });

  it('refuses when signed out', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await deleteAccount();
    expect(result.success).toBe(false);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('deletes a user with no Stripe customer without calling Stripe', async () => {
    const result = await deleteAccount();
    expect(result.success).toBe(true);
    expect(mockStripeList).not.toHaveBeenCalled();
    expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
  });

  it('cancels every live subscription, revokes Fitbit and purges photos before deleting', async () => {
    subscriptionRow = { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_a' };
    mockStripeList.mockImplementation(async () => {
      calls.push('stripe.list');
      return {
        data: [
          { id: 'sub_a', status: 'active' },
          { id: 'sub_b', status: 'past_due' },
          { id: 'sub_old', status: 'canceled' },
        ],
      };
    });
    fitbitRows = [{ access_token: 'at', refresh_token: 'rt' }];
    storageObjects = { 'progress-photos': [{ id: '1', name: 'a.jpg' }, { id: '2', name: 'b.jpg' }] };

    const result = await deleteAccount();

    expect(result.success).toBe(true);
    expect(mockStripeList).toHaveBeenCalledWith({ customer: 'cus_1', status: 'all', limit: 100 });
    expect(mockStripeCancel.mock.calls.map((c) => c[0])).toEqual(['sub_a', 'sub_b']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.fitbit.com/oauth2/revoke');
    expect(String(fetchMock.mock.calls[0][1].body)).toBe('token=rt');
    expect(calls).toContain('remove:progress-photos:user-1/a.jpg,user-1/b.jpg');
    // Everything else happens before the user (and the rows) are gone.
    expect(calls[calls.length - 1]).toBe('deleteUser');
    expect(calls.indexOf('stripe.cancel:sub_b')).toBeLessThan(calls.indexOf('deleteUser'));
  });

  it('aborts, keeping the account, when Stripe cancellation fails', async () => {
    subscriptionRow = { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_a' };
    mockStripeList.mockResolvedValue({ data: [{ id: 'sub_a', status: 'active' }] });
    mockStripeCancel.mockRejectedValue(new Error('stripe down'));

    const result = await deleteAccount();

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/subscription/i);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('treats a subscription or customer already gone at Stripe as cancelled', async () => {
    subscriptionRow = { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_a' };
    mockStripeList.mockRejectedValue({ code: 'resource_missing' });
    expect((await deleteAccount()).success).toBe(true);

    mockStripeList.mockResolvedValue({ data: [{ id: 'sub_a', status: 'active' }] });
    mockStripeCancel.mockRejectedValue({ code: 'resource_missing' });
    expect((await deleteAccount()).success).toBe(true);
  });

  it('still deletes when the Fitbit revoke fails (best effort)', async () => {
    fitbitRows = [{ access_token: 'at', refresh_token: null }];
    fetchMock.mockRejectedValue(new Error('fitbit down'));
    const result = await deleteAccount();
    expect(result.success).toBe(true);
    expect(mockDeleteUser).toHaveBeenCalled();
  });

  it('aborts when progress photos cannot be removed', async () => {
    storageListError = { 'progress-photos': { message: 'storage unavailable' } };
    const result = await deleteAccount();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/photos/i);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('treats a missing bucket as nothing to remove', async () => {
    storageListError = { 'progress-photos': { message: 'Bucket not found' }, avatars: { message: 'Bucket not found' } };
    expect((await deleteAccount()).success).toBe(true);
  });
});
