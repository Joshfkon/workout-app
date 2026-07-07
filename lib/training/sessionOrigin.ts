// ============================================================
// WORKOUT SESSION ORIGIN
//
// Every session-creation path records how the session was started (the
// 20260707000001_workout_session_origin migration). Inserts go through
// insertWorkoutSessions so the app keeps working before that migration is
// applied: when Postgres/PostgREST reports the origin column as missing, the
// insert retries without it (same ship-before-migrate pattern as
// discardStaleSession in the workout _lib).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export type SessionOrigin = 'scheduled' | 'empty' | 'ai_suggested' | 'repeat';

/**
 * Error codes meaning the origin column doesn't exist yet: 42703 = undefined
 * column (Postgres), PGRST204 = column not found in schema cache (PostgREST).
 */
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);

function isMissingOriginColumn(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code != null && MISSING_COLUMN_CODES.has(code);
}

/**
 * Insert one or more workout_sessions rows carrying an origin, retrying
 * without the column while the migration hasn't been applied. Returns the
 * PostgREST result of `.insert(rows).select(select)`.
 */
export async function insertWorkoutSessions<Row extends Record<string, unknown>>(
  supabase: SupabaseClient,
  rows: (Row & { origin: SessionOrigin })[],
  select = 'id'
): Promise<{ data: { id: string }[] | null; error: unknown }> {
  const first = await supabase.from('workout_sessions').insert(rows).select(select);
  if (!first.error || !isMissingOriginColumn(first.error)) {
    return { data: first.data as { id: string }[] | null, error: first.error };
  }

  const stripped = rows.map(({ origin: _origin, ...rest }) => rest);
  const retry = await supabase.from('workout_sessions').insert(stripped).select(select);
  return { data: retry.data as { id: string }[] | null, error: retry.error };
}

/**
 * Best-effort origin update (used when a reused blank session is repurposed,
 * e.g. an abandoned empty session becomes the AI-suggested one). Silently a
 * no-op before the migration.
 */
export async function updateSessionOrigin(
  supabase: SupabaseClient,
  sessionId: string,
  origin: SessionOrigin
): Promise<void> {
  const { error } = await supabase
    .from('workout_sessions')
    .update({ origin })
    .eq('id', sessionId);
  if (error && !isMissingOriginColumn(error)) {
    console.error('Failed to update session origin:', error);
  }
}
