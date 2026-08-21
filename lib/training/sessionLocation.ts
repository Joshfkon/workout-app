/**
 * Changing where a workout is being logged, mid-session.
 *
 * The location a session was started at (workout_sessions.location_id) is the
 * calibration key for machine-loaded exercises: 320 lb on one gym's hip
 * adduction machine is not 320 lb on another's, so their load histories are
 * separate tracks (see services/progressionScope and
 * docs/LOCATION_SCOPED_CALIBRATION.md).
 *
 * Until now that key could only be chosen BEFORE the first set — from the
 * pre-workout sheet — which is the wrong moment: you find out you're on the
 * annex machine when you sit down at it. These helpers move the key after the
 * fact and, crucially, RE-STAMP the sets already logged under the old one.
 * Without the re-stamp a mid-session correction would leave the session's
 * history split across two tracks, which is the exact conflation the feature
 * exists to prevent.
 *
 * Every write here is best-effort and migration-lag safe: a database without
 * the location columns reports a missing column, which we treat as "this
 * database doesn't do location scoping yet" and swallow, rather than failing a
 * user's set log over optional metadata.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Error codes meaning a referenced column doesn't exist yet: 42703 = undefined
 * column (Postgres), PGRST204 = column not found in schema cache (PostgREST).
 * Mirrors lib/training/sessionOrigin.
 */
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);

function isMissingColumn(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code != null && MISSING_COLUMN_CODES.has(code);
}

/**
 * The location a new session should default to: most recently used, else the
 * user's marked default, else their first. Null when they have no locations.
 *
 * Every scheduled session used to start with no location at all — only the
 * pre-workout builder ever set one — so for anyone training from their
 * mesocycle, machine loads from every gym landed in one undifferentiated
 * history. Defaulting here is what makes location scoping the norm instead of
 * an opt-in that most sessions miss; the user corrects it from the header chip
 * on the rare day they're somewhere else.
 */
export async function resolveDefaultLocationId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  // This runs on the critical path of starting a workout. A location is
  // optional metadata, so nothing it can do — a missing column, a missing
  // table, a client that doesn't support the chain — may be allowed to
  // propagate and stop the session from opening. Every failure degrades to
  // "no location", which is exactly how sessions behaved before.
  try {
    const { data, error } = await supabase
      .from('gym_locations')
      .select('id, is_default, last_used_at')
      .eq('user_id', userId)
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .limit(1);

    if (!error) {
      return (data?.[0] as { id: string } | undefined)?.id ?? null;
    }

    // Pre-migration database: last_used_at doesn't exist. Fall back to the
    // default flag, which gym_locations has carried since it was created.
    const { data: legacy, error: legacyError } = await supabase
      .from('gym_locations')
      .select('id, is_default')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .limit(1);

    if (legacyError) return null;
    return (legacy?.[0] as { id: string } | undefined)?.id ?? null;
  } catch (err) {
    console.warn('[sessionLocation] default location lookup failed:', err);
    return null;
  }
}

export interface LocationUpdateResult {
  /** False when the write failed for a reason other than a missing column. */
  ok: boolean;
  /** Number of already-logged sets moved onto the new track. */
  restampedSets: number;
  /** True when the database predates the location migrations (a silent no-op). */
  unsupported: boolean;
}

const NOOP: LocationUpdateResult = { ok: true, restampedSets: 0, unsupported: false };

/**
 * Move a whole session onto a different location.
 *
 * Sets belonging to a block with its OWN location override are deliberately
 * left alone — the user pinned those to a specific machine, and "I was at a
 * different gym than I thought" must not silently un-pin them.
 *
 * @param blockIdsToRestamp Blocks that follow the session location (i.e. every
 *   block whose own `location_id` is null). Pass an empty array to move the
 *   session row only.
 */
export async function updateSessionLocation(
  supabase: SupabaseClient,
  sessionId: string,
  locationId: string | null,
  blockIdsToRestamp: string[]
): Promise<LocationUpdateResult> {
  const { error: sessionError } = await supabase
    .from('workout_sessions')
    .update({ location_id: locationId })
    .eq('id', sessionId);

  if (sessionError) {
    if (isMissingColumn(sessionError)) return { ...NOOP, unsupported: true };
    console.error('[sessionLocation] failed to update session location:', sessionError);
    return { ok: false, restampedSets: 0, unsupported: false };
  }

  if (blockIdsToRestamp.length === 0) return NOOP;

  return restampSets(supabase, blockIdsToRestamp, locationId);
}

/**
 * Pin ONE exercise to a location, overriding the session's.
 *
 * `locationId: null` clears the override, which hands the block back to the
 * session location — so the re-stamp that follows is what puts its sets back on
 * the session's track. Both directions re-stamp; that symmetry is why the
 * caller passes the resolved effective location separately.
 *
 * @param effectiveLocationId The location this block's sets should now carry:
 *   the override when setting one, the session's location when clearing it.
 *   (services/progressionScope.resolveEffectiveLocation computes it.)
 */
export async function updateBlockLocation(
  supabase: SupabaseClient,
  blockId: string,
  locationId: string | null,
  effectiveLocationId: string | null
): Promise<LocationUpdateResult> {
  const { error: blockError } = await supabase
    .from('exercise_blocks')
    .update({ location_id: locationId })
    .eq('id', blockId);

  if (blockError) {
    if (isMissingColumn(blockError)) return { ...NOOP, unsupported: true };
    console.error('[sessionLocation] failed to update block location:', blockError);
    return { ok: false, restampedSets: 0, unsupported: false };
  }

  return restampSets(supabase, [blockId], effectiveLocationId);
}

/**
 * Re-stamp every set already logged against these blocks onto `locationId`.
 *
 * Returns the row count so the caller can tell the user what moved ("3 logged
 * sets moved to Annex") — a silent re-stamp of already-logged work would be
 * indistinguishable from data loss from the user's side.
 */
async function restampSets(
  supabase: SupabaseClient,
  blockIds: string[],
  locationId: string | null
): Promise<LocationUpdateResult> {
  const { data, error } = await supabase
    .from('set_logs')
    .update({ location_id: locationId })
    .in('exercise_block_id', blockIds)
    .select('id');

  if (error) {
    if (isMissingColumn(error)) return { ...NOOP, unsupported: true };
    // The session/block row already moved; leaving its sets behind would split
    // the session across two tracks, so this is a real (reportable) failure.
    console.error('[sessionLocation] failed to re-stamp set locations:', error);
    return { ok: false, restampedSets: 0, unsupported: false };
  }

  return { ok: true, restampedSets: data?.length ?? 0, unsupported: false };
}
