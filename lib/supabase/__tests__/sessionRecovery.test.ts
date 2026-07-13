import {
  recoverSessionOnForeground,
  claimReauthSurface,
  resetReauthSurface,
  markExplicitSignOut,
  wasExplicitSignOut,
  SESSION_EXPIRED_LOGIN_URL,
} from '../sessionRecovery';

function makeClient(opts: {
  session?: { expires_at?: number } | null;
  getSessionThrows?: boolean;
  refreshedSession?: unknown | null;
  refreshError?: { name?: string; status?: number } | null;
  refreshThrows?: boolean;
}) {
  const refreshSession = jest.fn(async () => {
    if (opts.refreshThrows) throw new Error('boom');
    return {
      data: { session: opts.refreshedSession ?? null },
      error: opts.refreshError ?? null,
    };
  });
  return {
    client: {
      auth: {
        getSession: async () => {
          if (opts.getSessionThrows) throw new Error('boom');
          return { data: { session: opts.session ?? null } };
        },
        refreshSession,
      },
    },
    refreshSession,
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('recoverSessionOnForeground', () => {
  it('does nothing when the token is fresh (no refresh call)', async () => {
    const { client, refreshSession } = makeClient({
      session: { expires_at: nowSeconds() + 3600 },
    });
    await expect(recoverSessionOnForeground(client)).resolves.toBe('fresh');
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes a lapsed token on foreground (24h idle case)', async () => {
    const { client, refreshSession } = makeClient({
      session: { expires_at: nowSeconds() - 24 * 3600 },
      refreshedSession: { expires_at: nowSeconds() + 3600 },
    });
    await expect(recoverSessionOnForeground(client)).resolves.toBe('refreshed');
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('refreshes a token inside the expiry margin, not just an expired one', async () => {
    const { client } = makeClient({
      session: { expires_at: nowSeconds() + 30 },
      refreshedSession: { expires_at: nowSeconds() + 3600 },
    });
    await expect(recoverSessionOnForeground(client)).resolves.toBe('refreshed');
  });

  it('reports no-session when signed out (route guards own the redirect)', async () => {
    const { client } = makeClient({ session: null });
    await expect(recoverSessionOnForeground(client)).resolves.toBe('no-session');
  });

  it('keeps the session on a transient refresh failure (never a logout)', async () => {
    const { client } = makeClient({
      session: { expires_at: nowSeconds() - 10 },
      refreshError: { name: 'AuthRetryableFetchError', status: 0 },
    });
    await expect(recoverSessionOnForeground(client)).resolves.toBe('retry-later');
  });

  it('requires re-auth when the auth server rejects the refresh token', async () => {
    const { client } = makeClient({
      session: { expires_at: nowSeconds() - 10 },
      refreshError: { status: 400 },
    });
    await expect(recoverSessionOnForeground(client)).resolves.toBe('reauth-required');
  });

  it('treats a thrown refresh as transient', async () => {
    const { client } = makeClient({
      session: { expires_at: nowSeconds() - 10 },
      refreshThrows: true,
    });
    await expect(recoverSessionOnForeground(client)).resolves.toBe('retry-later');
  });

  it('treats a failed session read as transient', async () => {
    const { client } = makeClient({ getSessionThrows: true });
    await expect(recoverSessionOnForeground(client)).resolves.toBe('retry-later');
  });
});

describe('re-auth surface bookkeeping (one screen, once)', () => {
  beforeEach(() => resetReauthSurface());

  it('grants the surface exactly once until reset', () => {
    expect(claimReauthSurface()).toBe(true);
    expect(claimReauthSurface()).toBe(false);
    resetReauthSurface();
    expect(claimReauthSurface()).toBe(true);
  });

  it('remembers an explicit sign-out until reset (never labelled "expired")', () => {
    expect(wasExplicitSignOut()).toBe(false);
    markExplicitSignOut();
    expect(wasExplicitSignOut()).toBe(true);
    resetReauthSurface();
    expect(wasExplicitSignOut()).toBe(false);
  });

  it('points the re-auth redirect at login with the explicit expired banner', () => {
    expect(SESSION_EXPIRED_LOGIN_URL).toContain('/login?message=');
    expect(decodeURIComponent(SESSION_EXPIRED_LOGIN_URL)).toContain('session expired');
  });
});
