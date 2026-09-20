/**
 * Assigning pre-location history to a gym, once, from Settings.
 *
 * Sets logged before location stamping existed carry location_id = NULL, and
 * the legacy attribution rule (rule 6, services/progressionScope) shows those
 * sets at EVERY gym when no stamped location dominates. A user whose whole
 * history predates stamping therefore sees full, unsoftened history at a
 * brand-new gym — and worse, once stamped sets accumulate at the new gym, the
 * old history is attributed there permanently (most-used-stamped wins), even
 * though it was all logged somewhere else.
 *
 * The fix is a statement only the user can make: "everything unassigned was
 * at gym X." The write itself is the backfill_legacy_location RPC
 * (supabase/migrations/20260920000001) — a single transaction stamping
 * completed sessions and their null sets server-side, because two client
 * updates over PostgREST could be interrupted into a half-stamped history.
 * This module is the thin client for counting what the backfill would touch
 * and invoking it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LegacyLocationCounts {
  /** Completed sessions with no location. */
  sessionCount: number;
  /** Non-warmup or warmup — ALL null-location sets in completed sessions. */
  setCount: number;
}

export type BackfillResult =
  | { ok: true; sessionsStamped: number; setsStamped: number }
  | { ok: false; message: string };

/**
 * Count the completed sessions and sets the backfill would stamp. Returns
 * null when the database can't answer (pre-migration schema, offline) — the
 * Settings card renders nothing in that case, matching how every other
 * location feature degrades on a database without the columns.
 */
export async function countLegacyLocationRows(
  supabase: SupabaseClient,
  userId: string
): Promise<LegacyLocationCounts | null> {
  try {
    const [sessionsRes, setsRes] = await Promise.all([
      supabase
        .from('workout_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('state', 'completed')
        .is('location_id', null),
      supabase
        .from('set_logs')
        .select('id, exercise_blocks!inner(workout_sessions!inner(id))', {
          count: 'exact',
          head: true,
        })
        .is('location_id', null)
        .eq('exercise_blocks.workout_sessions.user_id', userId)
        .eq('exercise_blocks.workout_sessions.state', 'completed'),
    ]);

    if (sessionsRes.error || setsRes.error) return null;
    return {
      sessionCount: sessionsRes.count ?? 0,
      setCount: setsRes.count ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Stamp all of the user's pre-location completed history to `locationId`.
 * Runs as one transaction server-side; RLS plus the function's own ownership
 * check keep it scoped to the caller. The location must be one of the user's
 * own gym_locations rows or the RPC raises.
 */
export async function runLegacyLocationBackfill(
  supabase: SupabaseClient,
  locationId: string
): Promise<BackfillResult> {
  try {
    const { data, error } = await supabase.rpc('backfill_legacy_location', {
      p_location_id: locationId,
    });
    if (error) {
      return { ok: false, message: error.message ?? 'Backfill failed' };
    }
    const row = (data ?? {}) as { sessions_stamped?: number; sets_stamped?: number };
    return {
      ok: true,
      sessionsStamped: row.sessions_stamped ?? 0,
      setsStamped: row.sets_stamped ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Backfill failed',
    };
  }
}
