/**
 * Session load — reading a workout session, its blocks and its logged sets
 * back out of the database.
 *
 * The row→domain mapping was already extracted (./sessionMapping); the QUERIES
 * were not, so reading a session back was only possible from inside the page's
 * load effect. A headless driver needs exactly this to check state between
 * operations, and it must read the same rows, in the same order, through the
 * same mapping the UI uses — otherwise the harness would be verifying its own
 * reimplementation of a read rather than production's.
 *
 * Ordering is load-bearing and explicit here: blocks by `order`, sets by
 * `set_number`. Several downstream consumers index positionally
 * (`previousSets[i]` is that workout's i-th working set), so an unordered read
 * would silently produce a different — and irreproducible — answer.
 */
import type { SetLog, WorkoutSession } from '@/types/schema';
import {
  mapWorkoutSessionRow,
  mapLoadedBlockRow,
  mapSetLogRow,
  type LoadedBlockRow,
  type LoadedExerciseRow,
  type WorkoutSessionRow,
  type SetLogRow,
} from './sessionMapping';
import type { ExerciseBlockWithExercise } from './types';

type UntypedSupabase = ReturnType<typeof import('@/lib/supabase/client').createUntypedClient>;

export interface LoadedWorkoutSession {
  session: WorkoutSession;
  /** Ordered by `exercise_blocks.order`. Blocks with no exercise row are dropped. */
  blocks: ExerciseBlockWithExercise[];
  /** Ordered by `set_number`, across every block of the session. */
  sets: SetLog[];
  /** Blocks the user skipped (`exercise_blocks.skipped_at` is set). */
  skippedBlockIds: Set<string>;
  /**
   * Gym location the session was started at, stamped onto new sets so
   * local-scope exercises calibrate per location. `null` for legacy sessions
   * and for databases without the column.
   */
  locationId: string | null;
  /** Raw session row, for the handful of columns the domain type doesn't carry. */
  raw: WorkoutSessionRow;
  /**
   * Raw block rows as returned, INCLUDING ones whose exercise didn't resolve.
   * The domain `ExerciseBlockWithExercise` deliberately drops columns the
   * workout view doesn't need (equipment, bodyweight flag, scope override),
   * but progression-scope resolution reads them straight off the row.
   */
  rawBlocks: LoadedBlockRow[];
  /** Number of blocks as returned, BEFORE dropping exercise-less ones — the
   *  stale-empty-session predicate counts rows, not usable blocks. */
  blockRowCount: number;
}

/**
 * Load a session with its blocks and sets. Returns null when the session row
 * doesn't exist; throws when the blocks query itself fails (a session with no
 * blocks is legitimate — a shell — and comes back with an empty array).
 */
export async function loadWorkoutSession(
  supabase: UntypedSupabase,
  sessionId: string
): Promise<LoadedWorkoutSession | null> {
  // Session and blocks are independent (both keyed only on sessionId), so they
  // go out together; sets depend on the block ids and follow.
  const [sessionResult, blocksResult] = await Promise.all([
    supabase.from('workout_sessions').select('*').eq('id', sessionId).single(),
    supabase
      .from('exercise_blocks')
      .select(`
        *,
        exercises (*)
      `)
      .eq('workout_session_id', sessionId)
      .order('order'),
  ]);

  const { data: sessionData, error: sessionError } = sessionResult;
  const { data: blocksData, error: blocksError } = blocksResult;

  if (sessionError || !sessionData) return null;
  if (blocksError) throw blocksError;

  const blockRows = (blocksData || []) as LoadedBlockRow[];
  const blocks: ExerciseBlockWithExercise[] = blockRows
    // A block whose exercise row didn't come back (deleted/inaccessible) has
    // nothing to prescribe against, so it is dropped rather than half-mapped.
    .filter((block): block is LoadedBlockRow & { exercises: LoadedExerciseRow } =>
      Boolean(block.exercises)
    )
    .map(mapLoadedBlockRow);

  const skippedBlockIds = new Set<string>(
    (blockRows as Array<{ id: string; skipped_at?: string | null }>)
      .filter((block) => Boolean(block.skipped_at))
      .map((block) => block.id)
  );

  let sets: SetLog[] = [];
  const blockIds = blocks.map((b) => b.id);
  if (blockIds.length > 0) {
    const { data: existingSets } = await supabase
      .from('set_logs')
      .select('*')
      .in('exercise_block_id', blockIds)
      .order('set_number');
    sets = ((existingSets || []) as SetLogRow[]).map(mapSetLogRow);
  }

  return {
    session: mapWorkoutSessionRow(sessionData),
    blocks,
    sets,
    skippedBlockIds,
    locationId: (sessionData.location_id as string | null) ?? null,
    raw: sessionData,
    rawBlocks: blockRows,
    blockRowCount: blockRows.length,
  };
}

/** Working (non-warmup) sets logged against one block. */
export function workingSetsForBlock(sets: SetLog[], blockId: string): SetLog[] {
  return sets.filter((s) => s.exerciseBlockId === blockId && !s.isWarmup && s.setType !== 'warmup');
}

export interface ResumePosition {
  /** Index into `blocks` the session should resume on. */
  blockIndex: number;
  /** 1-based set number the next logged set should take. */
  setNumber: number;
}

/**
 * Where a resumed session picks up: the first block that still owes working
 * sets, and the next set number within it.
 *
 * Skipped blocks are never the resume target. With no sets logged at all the
 * position is the first non-skipped block at set 1 — which is not necessarily
 * block 0, since the user may have skipped the opener before logging anything.
 */
export function resolveResumePosition(
  blocks: Pick<ExerciseBlockWithExercise, 'id' | 'targetSets'>[],
  sets: SetLog[],
  skippedBlockIds: Set<string> = new Set()
): ResumePosition {
  const firstIncompleteIndex = blocks.findIndex(
    (block) =>
      !skippedBlockIds.has(block.id) &&
      workingSetsForBlock(sets, block.id).length < block.targetSets
  );

  if (firstIncompleteIndex === -1) {
    // Every block is complete or skipped — hold at the first non-skipped block
    // rather than pointing past the end of the list.
    const firstActive = blocks.findIndex((b) => !skippedBlockIds.has(b.id));
    const index = firstActive === -1 ? 0 : firstActive;
    const done = blocks[index] ? workingSetsForBlock(sets, blocks[index].id).length : 0;
    return { blockIndex: index, setNumber: done + 1 };
  }

  return {
    blockIndex: firstIncompleteIndex,
    setNumber: workingSetsForBlock(sets, blocks[firstIncompleteIndex].id).length + 1,
  };
}
