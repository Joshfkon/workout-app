/**
 * Auth callback hardening tests.
 *
 * Covers the two incident classes this route now absorbs:
 *  - "recovery implies confirmation": completing an emailed recovery /
 *    magic-link / invite link backfills email_confirmed_at for users whose
 *    original confirmation email was dropped.
 *  - No dead-ends: every failure path routes to /verify-code (the OTP
 *    fallback) instead of a bare "Authentication failed" login banner.
 */

// The route only calls NextResponse.redirect — stub it to capture the target
// instead of pulling next/server's runtime (Response global) into jsdom.
jest.mock('next/server', () => ({
  NextResponse: {
    redirect: (url: string | URL) => ({ redirectedTo: String(url) }),
  },
}));

const mockExchange = jest.fn();
const mockGetUser = jest.fn();
const mockSingle = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      exchangeCodeForSession: mockExchange,
      getUser: mockGetUser,
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: mockSingle }) }),
    }),
  })),
}));

const mockUpdateUserById = jest.fn();
let mockAdminClient: { auth: { admin: { updateUserById: jest.Mock } } } | null;

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(() => mockAdminClient),
}));

import { GET } from '../route';

const ORIGIN = 'https://hypertrack.app';

function request(query: string) {
  return { url: `${ORIGIN}/auth/callback${query}` } as unknown as Request;
}

async function get(query: string) {
  return (await GET(request(query))) as unknown as { redirectedTo: string };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAdminClient = { auth: { admin: { updateUserById: mockUpdateUserById } } };
  mockUpdateUserById.mockResolvedValue({ error: null });
  mockExchange.mockResolvedValue({ error: null });
  mockSingle.mockResolvedValue({ data: { onboarding_completed: true } });
});

describe('recovery implies confirmation', () => {
  it('backfills email_confirmed_at for an unconfirmed user completing recovery', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email_confirmed_at: null } },
    });

    const res = await get('?code=abc&next=%2Freset-password');

    expect(mockUpdateUserById).toHaveBeenCalledWith('u1', { email_confirm: true });
    expect(res.redirectedTo).toBe(`${ORIGIN}/reset-password`);
  });

  it('recognizes recovery via the type param too', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email_confirmed_at: null } },
    });

    const res = await get('?code=abc&type=recovery');

    expect(mockUpdateUserById).toHaveBeenCalledWith('u1', { email_confirm: true });
    expect(res.redirectedTo).toBe(`${ORIGIN}/reset-password`);
  });

  it('backfills confirmation for magiclink logins as well', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u2', email_confirmed_at: null } },
    });

    const res = await get('?code=abc&type=magiclink');

    expect(mockUpdateUserById).toHaveBeenCalledWith('u2', { email_confirm: true });
    // Not a recovery — proceeds to the normal onboarding-aware redirect.
    expect(res.redirectedTo).toBe(`${ORIGIN}/dashboard/log`);
  });

  it('does not touch an already-confirmed user', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email_confirmed_at: '2026-01-01T00:00:00Z' } },
    });

    const res = await get('?code=abc&next=%2Freset-password');

    expect(mockUpdateUserById).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe(`${ORIGIN}/reset-password`);
  });

  it('does not confirm on a plain signup-style exchange (no mailbox-proof type)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email_confirmed_at: null } },
    });
    mockSingle.mockResolvedValue({ data: { onboarding_completed: false } });

    const res = await get('?code=abc&next=%2Fonboarding');

    expect(mockUpdateUserById).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe(`${ORIGIN}/onboarding`);
  });

  it('still completes the reset flow when the service role key is missing', async () => {
    mockAdminClient = null;
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email_confirmed_at: null } },
    });

    const res = await get('?code=abc&next=%2Freset-password');

    expect(res.redirectedTo).toBe(`${ORIGIN}/reset-password`);
  });

  it('still completes the reset flow when the admin update fails', async () => {
    mockUpdateUserById.mockRejectedValue(new Error('boom'));
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email_confirmed_at: null } },
    });

    const res = await get('?code=abc&next=%2Freset-password');

    expect(res.redirectedTo).toBe(`${ORIGIN}/reset-password`);
  });
});

describe('failure paths route to the OTP fallback, never a dead end', () => {
  it('failed recovery code exchange → /verify-code with cross-device copy', async () => {
    mockExchange.mockResolvedValue({ error: { message: 'invalid flow state' } });

    const res = await get('?code=abc&next=%2Freset-password');

    expect(res.redirectedTo).toBe(`${ORIGIN}/verify-code?type=recovery&reason=cross_device`);
  });

  it('failed signup code exchange → /verify-code with cross-device copy', async () => {
    mockExchange.mockResolvedValue({ error: { message: 'invalid flow state' } });

    const res = await get('?code=abc&next=%2Fonboarding');

    expect(res.redirectedTo).toBe(`${ORIGIN}/verify-code?type=signup&reason=cross_device`);
  });

  it('expired-link error params → /verify-code marked expired', async () => {
    const res = await get('?error=access_denied&error_code=otp_expired&next=%2Freset-password');

    expect(mockExchange).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe(`${ORIGIN}/verify-code?type=recovery&reason=link_expired`);
  });

  it('other error params → /verify-code marked failed', async () => {
    const res = await get('?error=server_error');

    expect(res.redirectedTo).toBe(`${ORIGIN}/verify-code?type=signup&reason=link_failed`);
  });

  it('no code and no error → /verify-code fallback', async () => {
    const res = await get('');

    expect(res.redirectedTo).toBe(`${ORIGIN}/verify-code?type=signup&reason=cross_device`);
  });
});
