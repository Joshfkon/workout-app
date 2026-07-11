/**
 * Local, network-free inspection of the Supabase session cookie, for the
 * middleware fast path.
 *
 * @supabase/ssr stores the session in a cookie named `sb-<ref>-auth-token`,
 * split into `...-auth-token.0`, `.1`, ... chunks for large sessions. The value
 * is `base64-<base64url(JSON.stringify(session))>` — NOT a raw JWT. The old
 * fast-path check assumed a `header.payload.signature` JWT and split on ".", so
 * it NEVER matched a real cookie and always returned false. The result: every
 * protected navigation fell through to a full server-side `getUser()`, and a
 * transient failure / refresh-token race there bounced signed-in users to
 * /login. Parsing the cookie correctly here lets valid sessions skip that
 * round-trip entirely.
 *
 * Everything here fails CLOSED: any decode/parse problem returns a
 * conservative result so the caller does the full server check instead.
 */

export interface SimpleCookie {
  name: string;
  value: string;
}

const BASE64_PREFIX = 'base64-';

function isChunkName(name: string): boolean {
  return /\.\d+$/.test(name);
}

/** True when any cookie looks like a Supabase auth-token cookie — i.e. a
 *  session exists locally, even if it may be expired. Used to tell a genuine
 *  signed-out request (no cookie → /login) apart from a transient failure to
 *  verify an existing session (cookie present → don't log out). */
export function hasAuthTokenCookie(cookies: SimpleCookie[]): boolean {
  return cookies.some((c) => c.name.includes('-auth-token'));
}

/** Reconstruct the raw stored auth-token value, joining chunk cookies in order. */
function readAuthTokenRaw(cookies: SimpleCookie[]): string | null {
  const auth = cookies.filter((c) => c.name.includes('-auth-token'));
  if (auth.length === 0) return null;

  // Match @supabase/ssr's combineChunks precedence: prefer the current
  // (unchunked) base cookie, and only reconstruct from `.0`, `.1`, ... chunks
  // when the base is absent. During a chunked<->unchunked transition, stale
  // chunk cookies can linger alongside a fresh base cookie — reading chunks
  // first would validate that stale value instead of the live session.
  const base = auth.find((c) => !isChunkName(c.name));
  if (base?.value) return base.value;

  const chunks = auth
    .filter((c) => isChunkName(c.name))
    .sort((a, b) => Number(a.name.split('.').pop()) - Number(b.name.split('.').pop()));
  if (chunks.length > 0) return chunks.map((c) => c.value).join('');

  return null;
}

function base64UrlDecode(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  // atob is available in both the Edge runtime and Node (test) environments.
  return atob(padded);
}

/**
 * Best-effort local check that a Supabase session cookie is present AND not
 * expired, without any network call. Returns false (→ caller does the full
 * server check) if the cookie is missing, malformed, or already expired.
 *
 * @param nowMs current time in ms (injectable for tests)
 */
export function isSessionCookieValid(cookies: SimpleCookie[], nowMs: number = Date.now()): boolean {
  try {
    const raw = readAuthTokenRaw(cookies);
    if (!raw) return false;

    let decoded = raw;
    if (raw.startsWith(BASE64_PREFIX)) {
      decoded = base64UrlDecode(raw.slice(BASE64_PREFIX.length));
    }

    // Pull expires_at (unix seconds) straight out of the decoded JSON. Regex
    // rather than JSON.parse so UTF-8 in user metadata can't trip us up — the
    // field and its value are always ASCII.
    const match = decoded.match(/"expires_at":\s*(\d+)/);
    if (!match) return false;

    const expiresAt = Number(match[1]);
    if (!Number.isFinite(expiresAt)) return false;

    // 60s buffer: treat a session about to expire as needing a real refresh.
    return nowMs / 1000 < expiresAt - 60;
  } catch {
    return false;
  }
}
