/**
 * Performed-order list maintenance.
 *
 * The workout page renders `blocks` in stored `order` and merely FILTERS the
 * rows into sections: blocks that are current or have working sets render as
 * main-list cards, the rest as compact "Up next" rows. So when the user jumps
 * around (taps an Up-next exercise out of plan order, then later starts an
 * earlier block), the started/completed rows re-interleave by plan position
 * instead of stacking in the order they were actually done.
 *
 * The fix: the moment a block receives its FIRST working set, move it to sit
 * directly after the last block that already has working sets. Started blocks
 * then accumulate chronologically, a block's row never moves again after that
 * (no mid-workout reshuffling), and because the caller persists the returned
 * order through the same write path as a drag reorder, the sequence survives
 * reloads and is what history shows.
 */

interface OrderableBlock {
  id: string;
  order: number;
  supersetGroupId: string | null;
}

/**
 * Compute the new block order after `justStartedId` logs its first working
 * set. Returns the reordered array (with `order` renumbered 1..n), or null
 * when no move is needed — the block already sits after every started block,
 * so the visual order is correct and the stored order should not be touched.
 *
 * `startedBlockIds` = blocks with at least one working set BEFORE this one
 * (the just-logged set excluded; whether it includes justStartedId is
 * irrelevant — the block itself is never counted as its own anchor).
 *
 * An unstarted superset partner is brought along to sit directly after the
 * moved block, so jumping ahead to a superset pair doesn't split the pair's
 * cluster chrome. A partner that already has sets stays where it is — the
 * user genuinely interleaved something between the two, and the degraded
 * per-row border is the honest rendering.
 */
export function moveJustStartedBlock<T extends OrderableBlock>(
  blocks: readonly T[],
  startedBlockIds: ReadonlySet<string>,
  justStartedId: string
): T[] | null {
  const fromIndex = blocks.findIndex((b) => b.id === justStartedId);
  if (fromIndex === -1) return null;

  let lastStartedIndex = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.id !== justStartedId && startedBlockIds.has(b.id)) {
      lastStartedIndex = i;
      break;
    }
  }
  // Nothing started yet, or already after every started block: in place.
  if (fromIndex > lastStartedIndex) return null;

  const next = [...blocks];
  const [moved] = next.splice(fromIndex, 1);
  // fromIndex < lastStartedIndex, so the removal shifted the anchor down to
  // lastStartedIndex - 1 — inserting AT lastStartedIndex lands directly
  // after it.
  next.splice(lastStartedIndex, 0, moved);

  if (moved.supersetGroupId !== null) {
    const partnerIndex = next.findIndex(
      (b) => b.id !== moved.id && b.supersetGroupId === moved.supersetGroupId
    );
    if (partnerIndex !== -1 && !startedBlockIds.has(next[partnerIndex].id)) {
      const [partner] = next.splice(partnerIndex, 1);
      next.splice(next.findIndex((b) => b.id === moved.id) + 1, 0, partner);
    }
  }

  return next.map((b, i) => (b.order === i + 1 ? b : { ...b, order: i + 1 }));
}
