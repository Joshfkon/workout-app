import { isSessionCookieValid, hasAuthTokenCookie, type SimpleCookie } from '../sessionCookie';

const NOW = 1_000_000_000_000; // fixed "now" in ms
const nowSec = NOW / 1000;

/** Encode a session object the way @supabase/ssr does: `base64-<base64(JSON)>`. */
function encodeSession(session: object): string {
  return 'base64-' + btoa(JSON.stringify(session));
}

function cookie(name: string, value: string): SimpleCookie {
  return { name, value };
}

describe('isSessionCookieValid', () => {
  it('returns true for a present, non-expired session cookie', () => {
    const value = encodeSession({ access_token: 'a', expires_at: nowSec + 3600, user: { id: 'u1' } });
    const cookies = [cookie('sb-abcdef-auth-token', value)];
    expect(isSessionCookieValid(cookies, NOW)).toBe(true);
  });

  it('returns false for an expired session cookie (real logout should be verified)', () => {
    const value = encodeSession({ access_token: 'a', expires_at: nowSec - 10, user: { id: 'u1' } });
    const cookies = [cookie('sb-abcdef-auth-token', value)];
    expect(isSessionCookieValid(cookies, NOW)).toBe(false);
  });

  it('returns false within the 60s expiry buffer (needs a real refresh)', () => {
    const value = encodeSession({ access_token: 'a', expires_at: nowSec + 30, user: { id: 'u1' } });
    const cookies = [cookie('sb-abcdef-auth-token', value)];
    expect(isSessionCookieValid(cookies, NOW)).toBe(false);
  });

  it('reconstructs and validates a chunked cookie', () => {
    const value = encodeSession({ access_token: 'a'.repeat(200), expires_at: nowSec + 3600, user: { id: 'u1' } });
    const mid = Math.floor(value.length / 2);
    const cookies = [
      cookie('sb-abcdef-auth-token.0', value.slice(0, mid)),
      cookie('sb-abcdef-auth-token.1', value.slice(mid)),
    ];
    expect(isSessionCookieValid(cookies, NOW)).toBe(true);
  });

  it('orders chunks numerically (10 after 2), not lexically', () => {
    const value = encodeSession({ expires_at: nowSec + 3600, pad: 'x'.repeat(500) });
    const size = Math.ceil(value.length / 11);
    const cookies: SimpleCookie[] = [];
    for (let i = 0; i < 11; i += 1) {
      cookies.push(cookie(`sb-abcdef-auth-token.${i}`, value.slice(i * size, (i + 1) * size)));
    }
    // Shuffle so lexical ordering (".10" < ".2") would corrupt reconstruction.
    cookies.reverse();
    expect(isSessionCookieValid(cookies, NOW)).toBe(true);
  });

  it('returns false when no auth cookie is present (genuinely signed out)', () => {
    expect(isSessionCookieValid([cookie('other', 'x')], NOW)).toBe(false);
    expect(isSessionCookieValid([], NOW)).toBe(false);
  });

  it('fails closed on a malformed / undecodable cookie', () => {
    expect(isSessionCookieValid([cookie('sb-abcdef-auth-token', 'base64-!!!not-valid')], NOW)).toBe(false);
    expect(isSessionCookieValid([cookie('sb-abcdef-auth-token', 'garbage-no-prefix')], NOW)).toBe(false);
  });

  it('fails closed when expires_at is absent from the session JSON', () => {
    const value = encodeSession({ access_token: 'a', user: { id: 'u1' } });
    expect(isSessionCookieValid([cookie('sb-abcdef-auth-token', value)], NOW)).toBe(false);
  });
});

describe('hasAuthTokenCookie', () => {
  it('detects a present auth-token cookie even when expired/unparseable', () => {
    expect(hasAuthTokenCookie([cookie('sb-abcdef-auth-token', 'anything')])).toBe(true);
    expect(hasAuthTokenCookie([cookie('sb-abcdef-auth-token.0', 'chunk')])).toBe(true);
  });

  it('returns false when there is no auth-token cookie', () => {
    expect(hasAuthTokenCookie([cookie('session-id', 'x')])).toBe(false);
    expect(hasAuthTokenCookie([])).toBe(false);
  });
});
