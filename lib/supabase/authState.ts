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
interface AuthCapableClient {
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
 * transport/server problem, not a rejected token.
 */
function isRetryableAuthError(error: { name?: string; status?: number } | null): boolean {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError') return true;
  const status = error.status;
  if (status === undefined || status === 0) return true;
  return status >= 500;
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
