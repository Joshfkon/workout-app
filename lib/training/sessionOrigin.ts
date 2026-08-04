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

export type SessionOrigin = 'scheduled' | 'empty' | 'ai_suggested' | 'repeat' | 'template';

/**
 * Origins accepted by the ORIGINAL check constraint (before
 * 20260803000002_template_session_origin widened it). A newer origin is
 * rewritten to its closest legacy bucket when the database still rejects it,
 * so a launcher never fails just because a migration hasn't been applied.
 */
const LEGACY_ORIGIN_FALLBACK: Partial<Record<SessionOrigin, SessionOrigin>> = {
  template: 'empty',
};

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
 * True when the insert was rejected by the origin check constraint (23514 =
 * check_violation) — i.e. the row carries an origin value this database doesn't
 * know about yet.
 */
function isUnsupportedOrigin(error: unknown): boolean {
  const err = error as { code?: string; message?: string; details?: string } | null;
  if (err?.code !== '23514') return false;
  return `${err.message ?? ''} ${err.details ?? ''}`.includes('origin');
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
  if (!first.error) {
    return { data: first.data as unknown as { id: string }[] | null, error: null };
  }

  // The origin column exists but doesn't accept this value yet: retry with the
  // closest origin the pre-widening constraint allows.
  if (isUnsupportedOrigin(first.error)) {
    const downgraded = rows.map((row) => ({
      ...row,
      origin: LEGACY_ORIGIN_FALLBACK[row.origin] ?? 'empty',
    }));
    const retry = await supabase.from('workout_sessions').insert(downgraded).select(select);
    return { data: retry.data as { id: string }[] | null, error: retry.error };
  }

  if (!isMissingColumn(first.error)) {
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
  if (!error || isMissingColumn(error)) return;

  if (isUnsupportedOrigin(error)) {
    await supabase
      .from('workout_sessions')
      .update({ origin: LEGACY_ORIGIN_FALLBACK[origin] ?? 'empty' })
      .eq('id', sessionId);
    return;
  }

  console.error('Failed to update session origin:', error);
}
