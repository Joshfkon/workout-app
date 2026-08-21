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
 * Two things make that harder than one UPDATE:
 *
 *   1. **There is no transaction across PostgREST calls.** Moving the owning
 *      row and re-stamping its sets are separate requests, and connectivity
 *      can die between them. Each function therefore compensates: if the
 *      re-stamp fails, the owning row is put back, so a failure leaves the
 *      database where it started rather than half-moved. When even the
 *      compensating write fails we say so (`rolledBack: false`) instead of
 *      reporting a clean failure over a split session.
 *   2. **Some sets aren't in the database yet.** A set logged offline sits in
 *      the IndexedDB outbox carrying the location it was logged under; a
 *      database-only re-stamp cannot see it, and it would later insert itself
 *      onto the old track. Queued rows are patched first — they're local and
 *      near-certain to succeed — and rolled back with everything else.
 *
 * Every write is migration-lag safe: a database without the location columns
 * reports a missing column, which we treat as "this database doesn't do
 * location scoping yet" and swallow, rather than failing a user's set log over
 * optional metadata.
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
 * user's marked default, else their oldest.
 *
 * Every scheduled session used to start with no location at all — only the
 * pre-workout builder ever set one — so for anyone training from their
 * mesocycle, machine loads from every gym landed in one undifferentiated
 * history. Defaulting here is what makes location scoping the norm instead of
 * an opt-in that most sessions miss; the user corrects it from the header chip
 * on the rare day they're somewhere else.
 *
 * The tie-breakers are load-bearing, not defensive dressing. `last_used_at` is
 * written from exactly one place (the pre-workout sheet's location chip), so
 * for most users every row is NULL and ordering on it alone leaves the winner
 * to unspecified row order — silently starting a scheduled workout at whatever
 * gym the planner happened to return, and stamping the session's machine sets
 * there. `is_default` breaks that tie the way the user asked it to be broken,
 * and `created_at` makes the remainder deterministic.
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
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
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
  /** False when the move failed and the caller should revert its own state. */
  ok: boolean;
  /** Sets moved onto the new track, database rows and queued writes together. */
  restampedSets: number;
  /** True when the database predates the location migrations (a silent no-op). */
  unsupported: boolean;
  /**
   * Only meaningful when `ok` is false. True means the owning row was put back
   * and the database is where it started. False means the compensating write
   * ALSO failed, so the session may now be split across two location tracks —
   * the caller should say so rather than reporting an ordinary retry.
   */
  rolledBack: boolean;
}

const NOOP: LocationUpdateResult = {
  ok: true,
  restampedSets: 0,
  unsupported: false,
  rolledBack: false,
};

export interface UpdateSessionLocationInput {
  sessionId: string;
  /** The location to move to (null clears it). */
  locationId: string | null;
  /** What the session carried before, for the compensating rollback. */
  previousLocationId: string | null;
  /**
   * Blocks that follow the session location (i.e. every block whose own
   * `location_id` is null). Blocks with their OWN override are deliberately
   * excluded — the user pinned those to a specific machine, and "I was at a
   * different gym than I thought" must not silently un-pin them. Empty moves
   * the session row only.
   */
  blockIdsToRestamp: string[];
}

/** Move a whole session onto a different location. */
export async function updateSessionLocation(
  supabase: SupabaseClient,
  input: UpdateSessionLocationInput
): Promise<LocationUpdateResult> {
  const { sessionId, locationId, previousLocationId, blockIdsToRestamp } = input;

  // Queued (not-yet-inserted) sets first: local, near-certain to succeed, and
  // patching them before the row moves closes the window where a flush could
  // land a set on the old track after the database re-stamp already ran.
  const queuedCount = await restampQueuedSets(blockIdsToRestamp, locationId);

  const { error: sessionError } = await supabase
    .from('workout_sessions')
    .update({ location_id: locationId })
    .eq('id', sessionId);

  if (sessionError) {
    await restampQueuedSets(blockIdsToRestamp, previousLocationId);
    if (isMissingColumn(sessionError)) return { ...NOOP, unsupported: true };
    console.error('[sessionLocation] failed to update session location:', sessionError);
    return { ok: false, restampedSets: 0, unsupported: false, rolledBack: true };
  }

  if (blockIdsToRestamp.length === 0) {
    return { ...NOOP, restampedSets: queuedCount };
  }

  const restamp = await restampSets(supabase, blockIdsToRestamp, locationId);
  if (restamp.unsupported) {
    await restampQueuedSets(blockIdsToRestamp, previousLocationId);
    return { ...NOOP, unsupported: true };
  }
  if (!restamp.ok) {
    // The session row already moved. Put it back, or the sets stay on the old
    // track under a session that claims the new one — a split session produced
    // by the control meant to prevent splits.
    const rolledBack = await revert(supabase, 'workout_sessions', 'id', sessionId, {
      location_id: previousLocationId,
    });
    await restampQueuedSets(blockIdsToRestamp, previousLocationId);
    return { ok: false, restampedSets: 0, unsupported: false, rolledBack };
  }

  return {
    ok: true,
    restampedSets: restamp.count + queuedCount,
    unsupported: false,
    rolledBack: false,
  };
}

export interface UpdateBlockLocationInput {
  blockId: string;
  /** The override to store: a location id, or null to follow the session. */
  locationId: string | null;
  /** The override stored before, for the compensating rollback. */
  previousLocationId: string | null;
  /**
   * The location this block's sets should now carry: the override when setting
   * one, the session's location when clearing it.
   * (services/progressionScope.resolveEffectiveLocation computes it.)
   */
  effectiveLocationId: string | null;
  /** What those sets carried before, for the rollback. */
  previousEffectiveLocationId: string | null;
}

/**
 * Pin ONE exercise to a location, overriding the session's.
 *
 * `locationId: null` clears the pin and hands the block back to the session
 * location — so the re-stamp is what puts its sets back on the session's
 * track. Both directions re-stamp; that symmetry is why the effective location
 * is passed separately from the stored override.
 */
export async function updateBlockLocation(
  supabase: SupabaseClient,
  input: UpdateBlockLocationInput
): Promise<LocationUpdateResult> {
  const {
    blockId,
    locationId,
    previousLocationId,
    effectiveLocationId,
    previousEffectiveLocationId,
  } = input;

  const queuedCount = await restampQueuedSets([blockId], effectiveLocationId);

  const { error: blockError } = await supabase
    .from('exercise_blocks')
    .update({ location_id: locationId })
    .eq('id', blockId);

  if (blockError) {
    await restampQueuedSets([blockId], previousEffectiveLocationId);
    if (isMissingColumn(blockError)) return { ...NOOP, unsupported: true };
    console.error('[sessionLocation] failed to update block location:', blockError);
    return { ok: false, restampedSets: 0, unsupported: false, rolledBack: true };
  }

  const restamp = await restampSets(supabase, [blockId], effectiveLocationId);
  if (restamp.unsupported) {
    await restampQueuedSets([blockId], previousEffectiveLocationId);
    return { ...NOOP, unsupported: true };
  }
  if (!restamp.ok) {
    const rolledBack = await revert(supabase, 'exercise_blocks', 'id', blockId, {
      location_id: previousLocationId,
    });
    await restampQueuedSets([blockId], previousEffectiveLocationId);
    return { ok: false, restampedSets: 0, unsupported: false, rolledBack };
  }

  return {
    ok: true,
    restampedSets: restamp.count + queuedCount,
    unsupported: false,
    rolledBack: false,
  };
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
): Promise<{ ok: boolean; count: number; unsupported: boolean }> {
  const { data, error } = await supabase
    .from('set_logs')
    .update({ location_id: locationId })
    .in('exercise_block_id', blockIds)
    .select('id');

  if (error) {
    if (isMissingColumn(error)) return { ok: true, count: 0, unsupported: true };
    console.error('[sessionLocation] failed to re-stamp set locations:', error);
    return { ok: false, count: 0, unsupported: false };
  }

  return { ok: true, count: data?.length ?? 0, unsupported: false };
}

/**
 * Patch the location on sets that are queued but not yet written.
 *
 * A set logged offline lives in the IndexedDB outbox with the location it was
 * logged under. The database re-stamp cannot reach it — the row doesn't exist
 * yet — so without this it would flush later onto the old track, splitting the
 * session precisely when connectivity was flaky enough to make the split hard
 * to notice. Best-effort by design: the outbox is a local convenience, and a
 * failure to read it must not fail the location change.
 */
async function restampQueuedSets(
  blockIds: string[],
  locationId: string | null
): Promise<number> {
  if (blockIds.length === 0) return 0;
  try {
    // Imported lazily so the server-side session-start path (which only wants
    // resolveDefaultLocationId) never pulls the offline/IndexedDB module in.
    const { listOutbox, updateQueuedSet } = await import('@/lib/offline/setOutbox');
    const targets = new Set(blockIds);
    const entries = await listOutbox();
    let patched = 0;
    for (const entry of entries) {
      if (entry.table !== 'set_logs') continue;
      // Only pending INSERTs carry a location; an update entry is a patch of
      // other columns and must not gain one.
      if ((entry.op ?? 'insert') !== 'insert') continue;
      if (!targets.has(String(entry.row.exercise_block_id))) continue;
      if (await updateQueuedSet(entry.id, { location_id: locationId })) patched++;
    }
    return patched;
  } catch (err) {
    console.warn('[sessionLocation] could not re-stamp queued sets:', err);
    return 0;
  }
}

/**
 * Put a row back after a failed re-stamp. Returns whether the database ended
 * up consistent — false means the move stands with its sets left behind, which
 * the caller must report rather than paper over.
 */
async function revert(
  supabase: SupabaseClient,
  table: string,
  keyColumn: string,
  keyValue: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const { error } = await supabase.from(table).update(patch).eq(keyColumn, keyValue);
  if (error) {
    console.error(`[sessionLocation] could not roll back ${table}.${keyColumn}=${keyValue}:`, error);
    return false;
  }
  return true;
}
