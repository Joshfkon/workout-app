/**
 * Return path for the Claude connector's consent page.
 *
 * A signed-out visitor to /oauth/consent is sent to /login; this remembers the
 * consent URL (with its authorization_id) so login can bring them back. Only a
 * same-origin /oauth/consent path is ever honoured, so the stored value can
 * never become an open redirect.
 */

export const POST_LOGIN_PATH_KEY = 'ht-post-login-path';

/** The stored value if it is a safe consent path, otherwise null. */
export function safePostLoginPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/oauth/consent?')) return null;
  if (value.includes('://') || value.includes('\\') || value.startsWith('//')) return null;
  return value;
}

/** Read and clear the pending return path (browser only). */
export function takePostLoginPath(): string | null {
  try {
    const value = sessionStorage.getItem(POST_LOGIN_PATH_KEY);
    sessionStorage.removeItem(POST_LOGIN_PATH_KEY);
    return safePostLoginPath(value);
  } catch {
    return null;
  }
}
