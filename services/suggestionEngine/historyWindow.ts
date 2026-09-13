/**
 * Per-exercise history-window selection for the suggestion engine.
 *
 * The last-N direct-history window must be counted in sessions that CARRY
 * SIGNAL, not in raw exercise_blocks rows. A completed session keeps a block
 * for every planned exercise — including ones the user skipped — and deload
 * sessions are excluded from suggestions downstream. When those no-signal
 * blocks consume window slots, an exercise the user has been skipping (or
 * only touched during a deload week) reads as totalSessions === 0 and flips
 * the card into cold-start mode despite real history sitting just past the
 * window (docs/WEIGHT_REP_ENGINE_AUDIT.md failure mode #2, per-exercise
 * variant).
 *
 * The queries already drop fully set-less blocks server-side
 * (`set_logs!inner`); this trim is the client-side half, shared by the
 * workout page's batched read, the single-exercise fallback fetch, and the
 * mesocycle session build so their windows cannot disagree.
 */

/** The block fields the window selection reads — structural, so each caller's
 *  own row type (workout page, session build) satisfies it as-is. */
export interface HistoryWindowBlock {
  workout_sessions: {
    completed_at?: string | null;
    /** Deload sessions never anchor suggestions — they don't spend a slot. */
    is_deload?: boolean | null;
  } | null;
  set_logs: { is_warmup: boolean | null }[] | null;
}

/** A block counts toward the window iff its session is not a deload and it
 *  holds at least one non-warmup set — the same "carries signal" rule
 *  computeHistoryFromBlocks applies when counting totalSessions. */
function carriesSignal(block: HistoryWindowBlock): boolean {
  if (block.workout_sessions?.is_deload === true) return false;
  return (block.set_logs ?? []).some((s) => !s.is_warmup);
}

/**
 * The newest `limit` signal-carrying blocks, most-recent-first.
 *
 * Sorts by the session's completed_at DESC itself rather than trusting the
 * embedded query order (nulls sink to the end, ties keep their incoming
 * relative order), so a consumer of this window can rely on
 * most-recent-first regardless of how the rows arrived.
 */
export function selectRecentSignalBlocks<T extends HistoryWindowBlock>(
  blocks: T[] | null | undefined,
  limit: number
): T[] {
  const timeOf = (b: T): number => {
    const t = Date.parse(b.workout_sessions?.completed_at ?? '');
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  return (blocks ?? [])
    .filter(carriesSignal)
    .sort((a, b) => timeOf(b) - timeOf(a))
    .slice(0, limit);
}
