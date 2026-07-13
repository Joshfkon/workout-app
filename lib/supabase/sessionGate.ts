/**
 * Empty-state auth gate (systemic fix for "expired session renders as no
 * data").
 *
 * THE BUG THIS PREVENTS
 * When the Supabase session lapses, user-scoped queries don't fail loudly:
 * either `getUser()` returns null and the fetch code early-returns `[]`, or
 * the request goes out without a user token and RLS silently filters every
 * row. Screens that treat `[]` as truth then render "No workout history yet"
 * / "no data" to a user whose data is fine — which reads as data loss.
 *
 * THE RULE
 * No screen may render its "no data yet" empty state without a verified-live
 * session:
 *   - session invalid            → throw SessionExpiredError (re-auth state)
 *   - session unverifiable (net) → throw SessionVerifyError  (retry state)
 *   - session verified + []      → genuine empty state
 *
 * Cost model: the live verification (`getUser()` round trip) only runs when a
 * result comes back EMPTY or auth-rejected. Non-empty results prove the token
 * was accepted, so the common path adds zero network overhead.
 */

import {
  resolveAuthState,
  getLocalUserId,
  type AuthCapableClient,
} from './authState';

/**
 * The auth server rejected the session (or there is none) — the user must
 * sign in again. Pages render a re-auth state for this, NEVER an empty state,
 * and React Query must not retry it (see makeQueryClient).
 */
export class SessionExpiredError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/**
 * The session could not be VERIFIED for a transient reason (offline, 5xx).
 * There may be a perfectly valid session — pages render a retry state for
 * this, never a logout and never an empty state.
 */
export class SessionVerifyError extends Error {
  readonly causeError: unknown;
  constructor(cause?: unknown) {
    super("Couldn't verify your session. Check your connection and try again.");
    this.name = 'SessionVerifyError';
    this.causeError = cause;
  }
}

// instanceof can fail across duplicated module instances (e.g. a persisted
// error object or two bundles), so fall back to the name.
export function isSessionExpiredError(error: unknown): error is SessionExpiredError {
  return (
    error instanceof SessionExpiredError ||
    (typeof error === 'object' && error !== null && (error as Error).name === 'SessionExpiredError')
  );
}

export function isSessionVerifyError(error: unknown): error is SessionVerifyError {
  return (
    error instanceof SessionVerifyError ||
    (typeof error === 'object' && error !== null && (error as Error).name === 'SessionVerifyError')
  );
}

/** Minimal PostgREST error shape as returned by `{ data, error }` responses. */
export interface PostgrestErrorLike {
  code?: string;
  message?: string;
}

/**
 * Did PostgREST reject the request for AUTH reasons (expired/invalid JWT)?
 * PGRST301 = JWT expired, PGRST303 = JWT invalid; older stacks only surface
 * a message mentioning the JWT.
 */
export function isAuthRejection(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST301' || error.code === 'PGRST302' || error.code === 'PGRST303') return true;
  return /\bjwt\b/i.test(error.message ?? '');
}

/**
 * Verify the session live (network round trip) and return the user id.
 * Throws SessionExpiredError / SessionVerifyError — never returns a value the
 * caller could mistake for "no user, show empty".
 */
export async function assertLiveSession(supabase: AuthCapableClient): Promise<string> {
  const auth = await resolveAuthState(supabase);
  if (auth.status === 'authenticated') return auth.userId;
  if (auth.status === 'error') throw new SessionVerifyError(auth.error);
  throw new SessionExpiredError();
}

/**
 * User id for data fetching, without the "no user → return []" trap.
 *
 * Fast path: the locally persisted session's id (no network — same identity
 * source the cached-first boot queries use; RLS still validates the actual
 * token on every data request, and `gateEmptyRows` catches a dead token).
 * When no local session exists this throws instead of letting the caller
 * fabricate an empty result.
 */
export async function requireAuthUserId(supabase: AuthCapableClient): Promise<string> {
  const localUserId = await getLocalUserId(supabase);
  if (localUserId) return localUserId;
  // No locally stored session: resolveAuthState settles offline (no network)
  // to unauthenticated → SessionExpiredError, or error → SessionVerifyError.
  return assertLiveSession(supabase);
}

/**
 * THE gate: pass every user-scoped list result through this before treating
 * it as truth.
 *
 * - auth-rejected error → verify live; still-valid session means the token
 *   was refreshed underneath the request, so it's a transient retry — an
 *   invalid one is a re-auth. Either way: throw, never "empty".
 * - other error         → throw (query error state, not empty state)
 * - empty result        → only trusted after live session verification
 * - non-empty result    → returned as-is (token provably accepted)
 */
export async function gateEmptyRows<T>(
  supabase: AuthCapableClient,
  result: { data: T[] | null; error: PostgrestErrorLike | null }
): Promise<T[]> {
  if (result.error) {
    if (isAuthRejection(result.error)) {
      await assertLiveSession(supabase);
      // Session verifies fine NOW (e.g. auto-refresh landed after the
      // request went out) — surface as retryable, a refetch will succeed.
      throw new SessionVerifyError(result.error);
    }
    throw new Error(result.error.message || 'Request failed');
  }
  const rows = result.data ?? [];
  if (rows.length === 0) {
    await assertLiveSession(supabase);
  }
  return rows;
}
