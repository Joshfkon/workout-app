import { resolveAuthState } from '../authState';

/**
 * Builds a fake Supabase auth surface with scripted getSession/getUser results.
 */
function makeClient(opts: {
  session?: unknown | null;
  getSessionThrows?: boolean;
  user?: { id: string } | null;
  userError?: { name?: string; status?: number } | null;
  getUserThrows?: boolean;
}) {
  return {
    auth: {
      getSession: async () => {
        if (opts.getSessionThrows) throw new Error('boom');
        return { data: { session: opts.session ?? null } };
      },
      getUser: async () => {
        if (opts.getUserThrows) throw new Error('boom');
        return { data: { user: opts.user ?? null }, error: opts.userError ?? null };
      },
    },
  };
}

describe('resolveAuthState', () => {
  it('returns authenticated with the user id when session + user resolve', async () => {
    const client = makeClient({ session: { access_token: 'x' }, user: { id: 'user-1' } });
    const state = await resolveAuthState(client);
    expect(state).toEqual({ status: 'authenticated', userId: 'user-1' });
  });

  it('returns unauthenticated when there is no local session (genuinely signed out)', async () => {
    const client = makeClient({ session: null });
    const state = await resolveAuthState(client);
    expect(state).toEqual({ status: 'unauthenticated' });
  });

  it('does NOT log out on a network failure while a session exists (retryable → error)', async () => {
    const client = makeClient({
      session: { access_token: 'x' },
      user: null,
      userError: { name: 'AuthRetryableFetchError', status: 0 },
    });
    const state = await resolveAuthState(client);
    expect(state.status).toBe('error');
  });

  it('treats a 5xx from the auth server as a retryable error, not a logout', async () => {
    const client = makeClient({
      session: { access_token: 'x' },
      user: null,
      userError: { status: 503 },
    });
    const state = await resolveAuthState(client);
    expect(state.status).toBe('error');
  });

  it('signs out when the server actively rejects the token (4xx), session present', async () => {
    const client = makeClient({
      session: { access_token: 'stale' },
      user: null,
      userError: { name: 'AuthApiError', status: 401 },
    });
    const state = await resolveAuthState(client);
    expect(state).toEqual({ status: 'unauthenticated' });
  });

  it('surfaces an error (never a logout) when the auth client throws', async () => {
    const client = makeClient({ getSessionThrows: true });
    const state = await resolveAuthState(client);
    expect(state.status).toBe('error');
  });

  it('surfaces an error when getUser throws while a session exists', async () => {
    const client = makeClient({ session: { access_token: 'x' }, getUserThrows: true });
    const state = await resolveAuthState(client);
    expect(state.status).toBe('error');
  });
});
