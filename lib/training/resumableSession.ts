/**
 * Is a workout session something "Resume / Continue workout" may point at?
 *
 * The workout screen archives an abandoned empty ad-hoc shell (in progress,
 * no exercises, over 4 hours old) and sends the lifter to Train instead of
 * opening it (isStaleEmptyAdhocSession). Every resume control has to agree
 * with that, or it keeps offering a workout that only bounces you to Train
 * (user report: a "Resume workout" that was always there and only led to
 * Train). One predicate, used by Home's button, the floating resume pill and
 * the hero's "Continue workout".
 */
import { createUntypedClient } from '@/lib/supabase/client';
import {
  discardStaleSession,
  isStaleEmptyAdhocSession,
} from '@/app/(dashboard)/dashboard/workout/_lib/adhocSession';

export interface SessionResumeRow {
  id: string;
  state: string;
  started_at: string | null;
  mesocycle_id: string | null;
  /** PostgREST embedded count: [{ count: n }]. */
  exercise_blocks?: { count: number }[] | null;
}

export const SESSION_RESUME_SELECT = 'id, state, started_at, mesocycle_id, exercise_blocks(count)';

export function blockCountOf(row: SessionResumeRow): number {
  return row.exercise_blocks?.[0]?.count ?? 0;
}

/** Pure. In progress, and not the empty leftover the workout screen would archive. */
export function isResumableSession(row: SessionResumeRow | null | undefined, now: number): boolean {
  if (!row || row.state !== 'in_progress') return false;
  return !isStaleEmptyAdhocSession(
    { state: row.state, mesocycleId: row.mesocycle_id, startedAt: row.started_at },
    blockCountOf(row),
    0,
    now
  );
}

/** Pure. The stale empty leftover (for archiving it on sight). */
export function isStaleLeftover(row: SessionResumeRow, now: number): boolean {
  return (
    row.state === 'in_progress' &&
    isStaleEmptyAdhocSession(
      { state: row.state, mesocycleId: row.mesocycle_id, startedAt: row.started_at },
      blockCountOf(row),
      0,
      now
    )
  );
}

/**
 * The user's newest resumable workout id, or null. Stale empty leftovers met
 * on the way are archived (the same soft discard the workout screen does), so
 * they stop coming back.
 */
export async function fetchResumableWorkoutId(userId: string, now: number): Promise<string | null> {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(SESSION_RESUME_SELECT)
    .eq('user_id', userId)
    .eq('state', 'in_progress')
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(10);
  if (error) throw error;
  let found: string | null = null;
  for (const row of (data ?? []) as SessionResumeRow[]) {
    if (isStaleLeftover(row, now)) {
      void discardStaleSession(supabase, row.id).catch(() => {});
      continue;
    }
    if (!found && isResumableSession(row, now)) found = row.id;
  }
  return found;
}

/** One session's resume row by id (null when it no longer exists). */
export async function fetchSessionResumeRow(sessionId: string): Promise<SessionResumeRow | null> {
  const { data, error } = await createUntypedClient()
    .from('workout_sessions')
    .select(SESSION_RESUME_SELECT)
    .eq('id', sessionId)
    .limit(1);
  if (error) throw error;
  return ((data ?? [])[0] as SessionResumeRow | undefined) ?? null;
}
