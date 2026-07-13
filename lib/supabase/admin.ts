import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client for privileged auth-admin operations.
 *
 * SERVER ONLY: uses SUPABASE_SERVICE_ROLE_KEY, which must never reach the
 * client bundle. Import this only from route handlers and server actions —
 * never from a file with 'use client'.
 *
 * Returns null when the service key isn't configured so callers can degrade
 * gracefully (admin operations here are hardening, not critical path).
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return null;
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
