import {
  SessionExpiredError,
  SessionVerifyError,
  isSessionExpiredError,
  isSessionVerifyError,
  isAuthRejection,
  assertLiveSession,
  requireAuthUserId,
  gateEmptyRows,
} from '../sessionGate';

/**
 * Fake Supabase auth surface with scripted getSession/getUser results
 * (same shape as authState.test.ts).
 */
function makeClient(opts: {
  session?: unknown | null;
  getSessionThrows?: boolean;
  user?: { id: string } | null;
  userError?: { name?: string; status?: number } | null;
}) {
  return {
    auth: {
      getSession: async () => {
        if (opts.getSessionThrows) throw new Error('boom');
        return { data: { session: opts.session ?? null } };
      },
      getUser: async () => {
        return { data: { user: opts.user ?? null }, error: opts.userError ?? null };
      },
    },
  };
}

const LIVE = { session: { user: { id: 'user-1' } }, user: { id: 'user-1' } };
/** Session token exists locally but the auth server rejects it (expired). */
const EXPIRED = {
  session: { user: { id: 'user-1' } },
  user: null,
  userError: { status: 401 },
};
/** Session token exists but verification failed transiently (offline/5xx). */
const VERIFY_BLIP = {
  session: { user: { id: 'user-1' } },
  user: null,
  userError: { name: 'AuthRetryableFetchError', status: 0 },
};
const SIGNED_OUT = { session: null };

describe('error classes and guards', () => {
  it('detects its own instances and name-based duplicates across bundles', () => {
    expect(isSessionExpiredError(new SessionExpiredError())).toBe(true);
    expect(isSessionExpiredError({ name: 'SessionExpiredError' })).toBe(true);
    expect(isSessionExpiredError(new Error('nope'))).toBe(false);
    expect(isSessionVerifyError(new SessionVerifyError())).toBe(true);
    expect(isSessionVerifyError({ name: 'SessionVerifyError' })).toBe(true);
    expect(isSessionVerifyError(new SessionExpiredError())).toBe(false);
  });

  it('classifies PostgREST auth rejections', () => {
    expect(isAuthRejection({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
    expect(isAuthRejection({ message: 'invalid JWT: token is expired' })).toBe(true);
    expect(isAuthRejection({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isAuthRejection(null)).toBe(false);
  });
});

describe('assertLiveSession', () => {
  it('returns the user id for a live session', async () => {
    await expect(assertLiveSession(makeClient(LIVE))).resolves.toBe('user-1');
  });

  it('throws SessionExpiredError when the server rejects the token', async () => {
    await expect(assertLiveSession(makeClient(EXPIRED))).rejects.toBeInstanceOf(
      SessionExpiredError
    );
  });

  it('throws SessionExpiredError when there is no session at all', async () => {
    await expect(assertLiveSession(makeClient(SIGNED_OUT))).rejects.toBeInstanceOf(
      SessionExpiredError
    );
  });

  it('throws SessionVerifyError (retry, NOT logout) on a transient verify failure', async () => {
    await expect(assertLiveSession(makeClient(VERIFY_BLIP))).rejects.toBeInstanceOf(
      SessionVerifyError
    );
  });
});

describe('requireAuthUserId', () => {
  it('returns the locally persisted user id without requiring verification', async () => {
    // getUser would fail here — the fast path must not call through to it.
    const client = makeClient({ ...VERIFY_BLIP });
    await expect(requireAuthUserId(client)).resolves.toBe('user-1');
  });

  it('throws SessionExpiredError instead of fabricating an empty result when signed out', async () => {
    await expect(requireAuthUserId(makeClient(SIGNED_OUT))).rejects.toBeInstanceOf(
      SessionExpiredError
    );
  });
});

describe('gateEmptyRows', () => {
  it('returns non-empty rows untouched with no extra verification', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    // A client whose verification would fail — must not be consulted.
    const client = makeClient(EXPIRED);
    await expect(gateEmptyRows(client, { data: rows, error: null })).resolves.toBe(rows);
  });

  it('trusts an empty result only after a live session verification', async () => {
    await expect(
      gateEmptyRows(makeClient(LIVE), { data: [], error: null })
    ).resolves.toEqual([]);
  });

  it('turns empty rows + expired session into SessionExpiredError (the core bug)', async () => {
    // The silent-RLS case: request went out without a user token, zero rows,
    // no error. This must NEVER surface as "no data yet".
    await expect(
      gateEmptyRows(makeClient(EXPIRED), { data: [], error: null })
    ).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('turns empty rows + unverifiable session into SessionVerifyError (retry state)', async () => {
    await expect(
      gateEmptyRows(makeClient(VERIFY_BLIP), { data: [], error: null })
    ).rejects.toBeInstanceOf(SessionVerifyError);
  });

  it('treats a JWT-rejected response with a dead session as SessionExpiredError', async () => {
    await expect(
      gateEmptyRows(makeClient(EXPIRED), {
        data: null,
        error: { code: 'PGRST301', message: 'JWT expired' },
      })
    ).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('treats a JWT-rejected response with a now-valid session as retryable', async () => {
    // Token was refreshed underneath the request — a refetch will succeed.
    await expect(
      gateEmptyRows(makeClient(LIVE), {
        data: null,
        error: { code: 'PGRST301', message: 'JWT expired' },
      })
    ).rejects.toBeInstanceOf(SessionVerifyError);
  });

  it('throws a plain error for non-auth failures', async () => {
    const promise = gateEmptyRows(makeClient(LIVE), {
      data: null,
      error: { code: '57014', message: 'canceling statement due to timeout' },
    });
    await expect(promise).rejects.toThrow('canceling statement due to timeout');
    await expect(promise).rejects.not.toBeInstanceOf(SessionExpiredError);
  });
});
