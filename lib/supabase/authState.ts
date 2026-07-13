/**
 * Auth-state resolution that separates a genuinely signed-out user from a
 * transient failure to *verify* the session.
 *
 * WHY THIS EXISTS
 * `supabase.auth.getUser()` makes a network round-trip to the auth server and
 * returns `{ data: { user: null }, error }` on ANY failure — a dropped
 * connection, a 5xx from the auth server, a client that failed to initialise.
 * Code that treats every falsy user as "logged out" and pushes to `/login`
 * will bounce a still-signed-in user to the login screen on a blip. The user's
 * session token is untouched; they just got kicked out of the app because a
 * *check* failed. A route/data error must NEVER destroy or mask a valid
 * session.
 *
 * This helper only concludes `unauthenticated` when the locally-persisted
 * session is actually absent (an offline read that can't fail transiently).
 * When a session token exists but verification fails for a network/server
 * reason, it returns `error` so the caller can show a retry state instead of a
 * logout.
 */

// Minimal shape we rely on — the app's `createUntypedClient()` returns `any`,
// so we avoid a hard dependency on the full SupabaseClient generic here.
export interface AuthCapableClient {
  auth: {
    getSession: () => Promise<{ data: { session: unknown | null } }>;
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error: { name?: string; status?: number } | null;
    }>;
  };
}

export type AuthState =
  | { status: 'authenticated'; userId: string }
  | { status: 'unauthenticated' }
  | { status: 'error'; error: unknown };

/**
 * A network / server-side failure that must NOT be read as "logged out".
 * supabase-js wraps unreachable-auth-server / 5xx failures in
 * `AuthRetryableFetchError`; anything with no status or a 5xx status is a
 * transport/server problem, not a rejected token. A thrown value (e.g. a raw
 * fetch TypeError, or a failed client init) is transient too.
 */
export function isRetryableAuthError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name;
  const status = (error as { status?: number }).status;
  if (name === 'AuthRetryableFetchError') return true;
  // A thrown error with no HTTP status is a transport/init failure, not a
  // rejected token.
  if (status === undefined || status === 0) return true;
  return status >= 500;
}

/**
 * The signed-in user's id from the LOCALLY persisted session — no network
 * round trip, no auth-server validation. Returns null when no session is
 * stored (genuinely signed out).
 *
 * Use this to decide WHAT to fetch on boot: every Supabase REST call still
 * carries the access token and is enforced by RLS server-side, so trusting
 * the local session for identity here can't leak anything — a stale/revoked
 * token just makes those calls fail. Cold-start perf work: the app used to
 * make several `getUser()` network round trips before its first data fetch,
 * and supabase-js serializes them (and the REST calls' token reads) behind
 * one auth lock, so each extra getUser() pushed first paint back by a full
 * round trip. Keep `resolveAuthState` for sensitive, user-initiated actions
 * that should verify the session before proceeding.
 */
export async function getLocalUserId(supabase: AuthCapableClient): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function resolveAuthState(supabase: AuthCapableClient): Promise<AuthState> {
  try {
    // Local, offline read of the persisted session — the source of truth for
    // "is there a token at all". This does not hit the network, so it cannot
    // fail for transient reasons.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { status: 'unauthenticated' };

    // A session token exists; validate it against the auth server.
    const { data: { user }, error } = await supabase.auth.getUser();
    if (user) return { status: 'authenticated', userId: user.id };

    // No user, but we DID have a stored session. If the server was simply
    // unreachable / errored, keep the session and let the caller retry.
    if (isRetryableAuthError(error)) return { status: 'error', error };

    // The server actively rejected the token (e.g. 401/403) — genuinely
    // signed out.
    return { status: 'unauthenticated' };
  } catch (error) {
    // getSession/getUser threw (e.g. a failed client init) — never a logout.
    return { status: 'error', error };
  }
}
