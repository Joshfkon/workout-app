import { createClient } from '@supabase/supabase-js';

/** Supabase Auth is the sign-in server for the Claude connector (its OAuth 2.1 server). */
export const AUTH_ISSUER = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

/**
 * Checks a bearer token sent by Claude: it must be a valid Supabase access
 * token (signature, expiry, issuer). Returns undefined for anything else, which
 * the handler turns into a 401 that starts the sign-in flow.
 */
export async function verifyToken(_req: Request, token?: string) {
  if (!token) return undefined;
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) return undefined;
  const claims = data.claims as Record<string, unknown>;
  return {
    token,
    clientId: typeof claims.client_id === 'string' ? claims.client_id : 'session',
    scopes: typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
    expiresAt: typeof claims.exp === 'number' ? claims.exp : undefined,
    extra: { userId: claims.sub },
  };
}
