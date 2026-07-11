// ============================================================
// WORKOUT SESSION ORIGIN
//
// Every session-creation path records how the session was started (the
// 20260707000004_workout_session_origin migration). Inserts go through
// insertWorkoutSessions so the app keeps working before that migration is
// applied: when Postgres/PostgREST reports the origin column as missing, the
// insert retries without it (same ship-before-migrate pattern as
// discardStaleSession in the workout _lib).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export type SessionOrigin = 'scheduled' | 'empty' | 'ai_suggested' | 'repeat';

/**
 * Error codes meaning a referenced column doesn't exist yet: 42703 = undefined
 * column (Postgres), PGRST204 = column not found in schema cache (PostgREST).
 */
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);

function isMissingColumn(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code != null && MISSING_COLUMN_CODES.has(code);
}

/**
 * Optional workout_sessions columns each gated behind a migration that may not
 * be applied yet. On a missing-column insert error we retry without them so the
 * app keeps working before the migration lands (ship-before-migrate).
 *   - origin:      20260707000004_workout_session_origin
 *   - location_id: 20260711000002_location_scoped_calibration
 */
const OPTIONAL_SESSION_COLUMNS = ['origin', 'location_id'] as const;

/**
 * Insert one or more workout_sessions rows carrying an origin (and optionally a
 * location_id), retrying without the migration-gated columns while those
 * migrations haven't been applied. Returns the PostgREST result of
 * `.insert(rows).select(select)`.
 */
export async function insertWorkoutSessions<Row extends Record<string, unknown>>(
  supabase: SupabaseClient,
  rows: (Row & { origin: SessionOrigin })[],
  select = 'id'
): Promise<{ data: { id: string }[] | null; error: unknown }> {
  const first = await supabase.from('workout_sessions').insert(rows).select(select);
  if (!first.error || !isMissingColumn(first.error)) {
    return { data: first.data as { id: string }[] | null, error: first.error };
  }

  // Retry without the optional migration-gated columns. Dropping them is safe:
  // origin/location are best-effort metadata, and a null location degrades to
  // legacy (unknown-gym) behavior.
  const stripped = rows.map((row) => {
    const rest = { ...row } as Record<string, unknown>;
    for (const col of OPTIONAL_SESSION_COLUMNS) delete rest[col];
    return rest;
  });
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
  if (error && !isMissingColumn(error)) {
    console.error('Failed to update session origin:', error);
  }
}
