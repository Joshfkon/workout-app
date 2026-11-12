/**
 * Promo redemption goes through ONE transactional RPC (redeem_promo_code);
 * the action only authenticates, normalizes the code and maps the result.
 */
const mockGetUser = jest.fn();
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: mockGetUser } })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }));

const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ rpc: mockRpc, from: mockFrom })),
}));

import { redeemPromoCode } from '@/lib/actions/promoCodes';

describe('redeemPromoCode', () => {
  const env = process.env;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = env;
    errorSpy.mockRestore();
  });

  it('refuses when signed out, without touching the database', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await redeemPromoCode('ABC');
    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('redeems through the single RPC with the session user and a normalized code', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, tier: 'elite', is_lifetime: true, duration_type: 'lifetime', duration_value: null },
      error: null,
    });
    const result = await redeemPromoCode('  abc-123 ');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('redeem_promo_code', { p_user_id: 'user-1', p_code: 'ABC-123' });
    // No separate table reads/writes: nothing to race, nothing half-applied.
    expect(mockFrom).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, tier: 'elite', isLifetime: true });
    expect(result.message).toContain('Elite access for lifetime');
  });

  it('describes a timed code', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, tier: 'pro', is_lifetime: false, duration_type: 'months', duration_value: 3 },
      error: null,
    });
    const result = await redeemPromoCode('X');
    expect(result).toMatchObject({ success: true, tier: 'pro', isLifetime: false });
    expect(result.message).toContain('Pro access for 3 months');
  });

  it.each([
    ['invalid', /Invalid promo code/],
    ['expired', /expired/],
    ['max_uses', /maximum uses/],
    ['already_redeemed', /already redeemed/],
    ['already_lifetime', /already have a lifetime/],
  ])('maps the %s refusal to a message', async (code, pattern) => {
    mockRpc.mockResolvedValue({ data: { ok: false, error: code }, error: null });
    const result = await redeemPromoCode('X');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(pattern);
  });

  it('rejects empty and oversized codes before calling the database', async () => {
    expect((await redeemPromoCode('   ')).success).toBe(false);
    expect((await redeemPromoCode('A'.repeat(65))).success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('does not leak database error text', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'secret internals' } });
    const result = await redeemPromoCode('X');
    expect(result.success).toBe(false);
    expect(result.message).not.toContain('secret internals');
  });

  it('reports "not configured" when the RPC is missing (migration not applied)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    const result = await redeemPromoCode('X');
    expect(result.message).toMatch(/not yet configured/);
  });
});
