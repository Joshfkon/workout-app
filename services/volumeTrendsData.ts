/**
 * volumeTrendsData — pure data-shaping for the Analytics "Volume & Trends" tab.
 *
 * The tab reads completed sessions from the server, but the finish flow is
 * optimistic (lib/offline/setOutbox): right after "Save & Finish" the
 * completion patch — and possibly some set rows — live only in the local
 * outbox while the server row is still `in_progress`. A server-only
 * `state = 'completed'` query therefore misses the workout the user just
 * finished, even though the finish screen, Home volume card, and history all
 * show it. These helpers merge the locally-pending writes into the server
 * result so unsynced never means invisible, and put all range math on local
 * calendar days (the UTC-window variant of this bug has shipped twice).
 */

import type { OutboxEntry } from '@/lib/offline/setOutbox';

import { now as clockNow } from '@/lib/clock';

// ---------------------------------------------------------------------------
// Raw row shapes (snake_case, as returned by the nested Supabase select)
// ---------------------------------------------------------------------------

export interface RawSetLog {
  id: string;
  weight_kg: number;
  reps: number;
  is_warmup: boolean;
  logged_at?: string | null;
}

export interface RawExerciseBlock {
  id: string;
  exercises: { id: string; name: string; primary_muscle: string } | null;
  set_logs: RawSetLog[] | null;
}

export interface RawWorkoutSession {
  id: string;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  session_rpe: number | null;
  exercise_blocks: RawExerciseBlock[] | null;
}

// ---------------------------------------------------------------------------
// Range math — local calendar days, never UTC windows
// ---------------------------------------------------------------------------

export type AnalyticsTimeRange = '7d' | '30d' | '60d' | '6m' | '1y' | 'all';

const RANGE_DAYS: Record<Exclude<AnalyticsTimeRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '60d': 60,
  '6m': 180,
  '1y': 365,
};

/**
 * Start of the range as an absolute instant: local midnight (N-1) days ago,
 * so "7d" always covers 7 whole *local* days including today. A rolling
 * `now - N*24h` window would drop a workout logged 7 local days ago in the
 * morning when checked in the evening, and its UTC-day variant drops evening
 * workouts logged after UTC midnight.
 */
export function rangeStartLocalDay(range: AnalyticsTimeRange, now: Date = clockNow()): Date | null {
  if (range === 'all') return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (RANGE_DAYS[range] - 1));
  return start;
}

// ---------------------------------------------------------------------------
// Outbox extraction
// ---------------------------------------------------------------------------

/**
 * Session-completion patches still queued locally, keyed by session id.
 * These are the `finish:<sessionId>` row-updates enqueued by
 * submitFinishOptimistic — identified structurally (a workout_sessions
 * update carrying state:'completed') so a renamed entry id can't break this.
 */
export function pendingCompletionsFromOutbox(
  entries: OutboxEntry[]
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    if (
      entry.table === 'workout_sessions' &&
      entry.op === 'update' &&
      entry.matchId &&
      entry.row?.state === 'completed'
    ) {
      map.set(entry.matchId, entry.row);
    }
  }
  return map;
}

/** Set inserts still queued locally, keyed by exercise_block_id. */
export function pendingSetsFromOutbox(entries: OutboxEntry[]): Map<string, RawSetLog[]> {
  const map = new Map<string, RawSetLog[]>();
  for (const entry of entries) {
    if (entry.table !== 'set_logs' || (entry.op ?? 'insert') !== 'insert') continue;
    const row = entry.row;
    const blockId = typeof row.exercise_block_id === 'string' ? row.exercise_block_id : null;
    if (!blockId || typeof row.weight_kg !== 'number' || typeof row.reps !== 'number') continue;
    const set: RawSetLog = {
      id: String(row.id ?? entry.id),
      weight_kg: row.weight_kg,
      reps: row.reps,
      is_warmup: row.is_warmup === true,
      logged_at: typeof row.logged_at === 'string' ? row.logged_at : null,
    };
    const list = map.get(blockId);
    if (list) list.push(set);
    else map.set(blockId, [set]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface MergeLocalPendingInput {
  /** Sessions the server already knows are completed (in range). */
  serverSessions: RawWorkoutSession[];
  /**
   * Sessions fetched by id for pending completions — any state, left joins
   * (so blocks whose sets are all still queued locally come back too).
   */
  pendingSessions: RawWorkoutSession[];
  /** From pendingCompletionsFromOutbox. */
  pendingCompletions: Map<string, Record<string, unknown>>;
  /** From pendingSetsFromOutbox. */
  pendingSetsByBlock: Map<string, RawSetLog[]>;
  /** From rangeStartLocalDay — null means no lower bound ('all'). */
  rangeStart: Date | null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * One list of completed sessions = server truth + locally-finished workouts,
 * with locally-queued sets folded into their blocks. Output is sorted by
 * completed_at descending (what the tab's aggregation expects) and filtered
 * to sessions that are in range and actually contain at least one set — the
 * same shape the previous inner-join query produced.
 */
export function mergeLocalPendingWorkouts(input: MergeLocalPendingInput): RawWorkoutSession[] {
  const { serverSessions, pendingSessions, pendingCompletions, pendingSetsByBlock, rangeStart } = input;

  const byId = new Map<string, RawWorkoutSession>();
  for (const session of serverSessions) byId.set(session.id, session);

  for (const session of pendingSessions) {
    // Finish patch may have flushed between the two reads — server row wins.
    if (byId.has(session.id)) continue;
    const patch = pendingCompletions.get(session.id);
    if (!patch) continue;
    byId.set(session.id, {
      ...session,
      completed_at: asString(patch.completed_at) ?? session.completed_at,
      session_rpe: asNumber(patch.session_rpe) ?? session.session_rpe,
      duration_seconds: asNumber(patch.duration_seconds) ?? session.duration_seconds,
    });
  }

  const merged: RawWorkoutSession[] = [];
  byId.forEach((session) => {
    if (!session.completed_at) return;
    if (rangeStart && new Date(session.completed_at).getTime() < rangeStart.getTime()) return;

    const blocks = (session.exercise_blocks ?? [])
      .map((block) => {
        const queued = pendingSetsByBlock.get(block.id);
        let setLogs = block.set_logs ?? [];
        if (queued && queued.length > 0) {
          // A queued set may have flushed after the outbox snapshot was taken —
          // the server copy wins (client-generated ids make this a strict dupe).
          const existing = new Set(setLogs.map((s) => s.id));
          setLogs = [...setLogs, ...queued.filter((s) => !existing.has(s.id))];
        }
        return { ...block, set_logs: setLogs };
      })
      // Same shape the previous set_logs!inner join produced: no set-less blocks.
      .filter((block) => block.set_logs.length > 0);

    if (blocks.length === 0) return;
    merged.push({ ...session, exercise_blocks: blocks });
  });

  merged.sort(
    (a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime()
  );
  return merged;
}

/** Total working (non-warmup) sets across sessions — parity checks with other volume surfaces. */
export function countWorkingSets(sessions: RawWorkoutSession[]): number {
  let count = 0;
  for (const session of sessions) {
    for (const block of session.exercise_blocks ?? []) {
      for (const set of block.set_logs ?? []) {
        if (!set.is_warmup) count++;
      }
    }
  }
  return count;
}
