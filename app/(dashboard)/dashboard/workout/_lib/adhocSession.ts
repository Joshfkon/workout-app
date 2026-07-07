import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import {
  insertWorkoutSessions,
  updateSessionOrigin,
  type SessionOrigin,
} from '@/lib/training/sessionOrigin';

type UntypedSupabase = ReturnType<typeof createUntypedClient>;

/**
 * Reuse today's ad-hoc (non-mesocycle) session or create a fresh one.
 *
 * A reused session with exercise blocks but NO logged sets is a discarded/
 * abandoned workout — its blocks are wiped so "blank workout" is actually
 * blank. Sessions with logged sets are reused as-is (that's a real workout in
 * progress; the Continue card points at it too). Mesocycle sessions are never
 * touched here.
 *
 * `origin` records which launcher created the session ('empty' blank workout,
 * 'ai_suggested', 'repeat'). A wiped-and-reused session is effectively fresh,
 * so its origin is overwritten too; a session with logged sets keeps the
 * origin it was started with.
 *
 * Session creation must only ever happen behind an explicit user tap — never
 * as a page-load side effect (P0-1 in the UX audit: a GET that inserts rows).
 */
export async function getOrCreateTodaySession(
  supabase: UntypedSupabase,
  userId: string,
  origin: SessionOrigin = 'empty'
): Promise<{ sessionId: string; isNewSession: boolean }> {
  const today = getLocalDateString();

  const { data: existingSessions } = await supabase
    .from('workout_sessions')
    .select('id, state')
    .eq('user_id', userId)
    .eq('planned_date', today)
    .is('mesocycle_id', null)
    .in('state', ['planned', 'in_progress'])
    .limit(1);

  const existing: { id: string; state: string } | undefined = existingSessions?.[0];
  if (existing) {
    const { data: blockRows } = await supabase
      .from('exercise_blocks')
      .select('id, set_logs(id)')
      .eq('workout_session_id', existing.id);
    const blocks = (blockRows ?? []) as { id: string; set_logs: { id: string }[] | null }[];
    const hasLoggedSets = blocks.some((b) => (b.set_logs?.length ?? 0) > 0);

    if (!hasLoggedSets && blocks.length > 0) {
      await supabase
        .from('exercise_blocks')
        .delete()
        .in('id', blocks.map((b) => b.id));
    }
    if (existing.state === 'planned') {
      await supabase
        .from('workout_sessions')
        .update({ state: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    if (!hasLoggedSets) {
      // After a wipe the session is effectively fresh (warmups, order
      // restart) — it now belongs to whichever launcher reused it.
      await updateSessionOrigin(supabase, existing.id, origin);
    }
    return { sessionId: existing.id, isNewSession: !hasLoggedSets };
  }

  const { data: newSessions, error: createError } = await insertWorkoutSessions(supabase, [
    {
      user_id: userId,
      planned_date: today,
      state: 'in_progress',
      started_at: new Date().toISOString(),
      completion_percent: 0,
      origin,
    },
  ]);

  const newSession = newSessions?.[0];
  if (createError || !newSession) {
    throw (createError as Error | null) ?? new Error('Failed to create session');
  }
  return { sessionId: newSession.id, isNewSession: true };
}

/** How old an empty ad-hoc session must be before auto-discard (ms). */
export const STALE_ADHOC_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * True iff a loaded session is an abandoned empty ad-hoc shell that should be
 * auto-discarded on open (P0-1). ALL of:
 *   - state is in_progress (not planned/completed/skipped),
 *   - not part of a mesocycle (ad-hoc only — programmed sessions are kept),
 *   - 0 exercise blocks AND 0 logged sets,
 *   - started more than STALE_ADHOC_AGE_MS ago.
 * Pure + exported so the guard is unit-testable in isolation.
 */
export function isStaleEmptyAdhocSession(
  input: { state: string; mesocycleId: string | null; startedAt: string | null },
  blockCount: number,
  setCount: number,
  now: number = Date.now()
): boolean {
  if (input.state !== 'in_progress') return false;
  if (input.mesocycleId) return false;
  if (blockCount !== 0 || setCount !== 0) return false;
  if (!input.startedAt) return false;
  return now - new Date(input.startedAt).getTime() > STALE_ADHOC_AGE_MS;
}

/**
 * Postgres error codes meaning the 20260703000002_session_auto_discard
 * migration hasn't been applied yet: 22P02 = invalid enum value
 * ('auto_discarded' not in session_state), 42703 = undefined column
 * (auto_discarded_at).
 */
const PRE_MIGRATION_ERROR_CODES = new Set(['22P02', '42703']);

/**
 * Discard a stale empty ad-hoc session (P0-1). Archives it as
 * 'auto_discarded' (soft delete — recoverable by support, invisible to every
 * session list because they all filter by positive state allowlists). Falls
 * back to the previous hard DELETE only while the enum value / column doesn't
 * exist yet, so the app works unchanged before the migration is applied.
 */
export async function discardStaleSession(
  supabase: UntypedSupabase,
  sessionId: string
): Promise<'archived' | 'deleted' | 'failed'> {
  const { error } = await supabase
    .from('workout_sessions')
    .update({ state: 'auto_discarded', auto_discarded_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (!error) return 'archived';

  if (PRE_MIGRATION_ERROR_CODES.has((error as { code?: string }).code ?? '')) {
    const { error: deleteError } = await supabase
      .from('workout_sessions')
      .delete()
      .eq('id', sessionId);
    return deleteError ? 'failed' : 'deleted';
  }
  return 'failed';
}

/**
 * Look up today's ad-hoc session WITHOUT creating or mutating anything.
 * Used by the quick-workout confirm screen to label its CTA.
 */
export async function findTodayAdhocSession(
  supabase: UntypedSupabase,
  userId: string
): Promise<{ sessionId: string; hasLoggedSets: boolean } | null> {
  const today = getLocalDateString();

  const { data: existingSessions } = await supabase
    .from('workout_sessions')
    .select('id, state')
    .eq('user_id', userId)
    .eq('planned_date', today)
    .is('mesocycle_id', null)
    .in('state', ['planned', 'in_progress'])
    .limit(1);

  const existing: { id: string } | undefined = existingSessions?.[0];
  if (!existing) return null;

  const { data: blockRows } = await supabase
    .from('exercise_blocks')
    .select('id, set_logs(id)')
    .eq('workout_session_id', existing.id);
  const blocks = (blockRows ?? []) as { id: string; set_logs: { id: string }[] | null }[];
  const hasLoggedSets = blocks.some((b) => (b.set_logs?.length ?? 0) > 0);

  return { sessionId: existing.id, hasLoggedSets };
}
