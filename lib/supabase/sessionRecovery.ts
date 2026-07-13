/**
 * Foreground session recovery (Capacitor + web).
 *
 * WHY THIS EXISTS
 * supabase-js refreshes the access token on a JS timer. In the Capacitor
 * build the OS suspends timers while the app is backgrounded, so a
 * background/foreground cycle (or a long-lived session left overnight) can
 * come back with a lapsed token and no refresh in flight. Requests then go
 * out without a valid user token, RLS silently returns zero rows, and every
 * server-backed screen renders "no data" (see lib/supabase/sessionGate.ts
 * for the render-side gate).
 *
 * This module is the proactive half of the fix: on every app foreground we
 * check the persisted session and refresh it if it has lapsed (or is about
 * to). Outcomes:
 *   - fresh / refreshed        → nothing to do, data fetches carry on
 *   - retryable refresh failure → keep the session, try again next time
 *     (screens show retry states via the gate, never a logout)
 *   - refresh REJECTED          → the session is genuinely dead: surface
 *     re-auth explicitly — one login redirect, once — never silent emptiness
 */

import { isRetryableAuthError } from './authState';

/** Refresh when the access token has less than this long left to live. */
const REFRESH_MARGIN_SECONDS = 60;

export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please sign in again.';

/** Login URL that shows the explicit "session expired" banner. */
export const SESSION_EXPIRED_LOGIN_URL = `/login?message=${encodeURIComponent(
  SESSION_EXPIRED_MESSAGE
)}`;

export type ForegroundRecoveryOutcome =
  /** Token valid with margin to spare — nothing to do. */
  | 'fresh'
  /** Token had lapsed (or nearly), refresh succeeded. */
  | 'refreshed'
  /** No persisted session at all — signed out; route guards own this. */
  | 'no-session'
  /** Refresh failed transiently (offline/5xx) — keep session, retry later. */
  | 'retry-later'
  /** The auth server rejected the refresh — user must sign in again. */
  | 'reauth-required';

interface RecoveryCapableClient {
  auth: {
    getSession: () => Promise<{
      data: { session: { expires_at?: number } | null };
      error?: unknown;
    }>;
    refreshSession: () => Promise<{
      data: { session: unknown | null };
      error: { name?: string; status?: number } | null;
    }>;
  };
}

/**
 * Check the persisted session and refresh it if it has lapsed. Safe to call
 * on every foreground — the common case is a local read with no network.
 *
 * Note: `getSession()` itself attempts a refresh when the token is already
 * expired. If that internal refresh fails on a dead refresh token,
 * supabase-js removes the session and emits SIGNED_OUT — the provider's
 * auth-state listener catches that path; this function reports 'no-session'.
 */
export async function recoverSessionOnForeground(
  supabase: RecoveryCapableClient
): Promise<ForegroundRecoveryOutcome> {
  let session: { expires_at?: number } | null = null;
  try {
    ({ data: { session } } = await supabase.auth.getSession());
  } catch {
    // Reading local storage failed — transient, never a logout.
    return 'retry-later';
  }
  if (!session) return 'no-session';

  const expiresAt = session.expires_at ?? 0; // unix seconds
  const secondsLeft = expiresAt - Math.floor(Date.now() / 1000);
  if (secondsLeft > REFRESH_MARGIN_SECONDS) return 'fresh';

  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data?.session) return 'refreshed';
    if (isRetryableAuthError(error)) return 'retry-later';
    return 'reauth-required';
  } catch {
    return 'retry-later';
  }
}

// ---------------------------------------------------------------------------
// One-screen-once bookkeeping for the explicit re-auth redirect, plus the
// explicit-sign-out marker so a voluntary logout is never labelled "expired".
// Module-level: shared across every mount for the lifetime of the JS context.
// ---------------------------------------------------------------------------

let reauthSurfaced = false;
let explicitSignOut = false;

/**
 * Call immediately before `supabase.auth.signOut()` at user-initiated
 * sign-out sites, so the resulting SIGNED_OUT event isn't misread as an
 * expired session.
 */
export function markExplicitSignOut(): void {
  explicitSignOut = true;
}

export function wasExplicitSignOut(): boolean {
  return explicitSignOut;
}

/**
 * Claim the single re-auth surface. Returns true exactly once per signed-in
 * stretch — callers redirect to SESSION_EXPIRED_LOGIN_URL only on true.
 */
export function claimReauthSurface(): boolean {
  if (reauthSurfaced) return false;
  reauthSurfaced = true;
  return true;
}

/** Reset the once-flags after a successful sign-in (a new session begins). */
export function resetReauthSurface(): void {
  reauthSurfaced = false;
  explicitSignOut = false;
}
