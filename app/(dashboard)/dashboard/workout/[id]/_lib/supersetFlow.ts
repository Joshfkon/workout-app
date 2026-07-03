/**
 * Superset set-flow (pairs, manual, rest-after-last) — pure decision logic so
 * the round-robin is unit-testable without driving the workout UI.
 *
 * Product decisions (signed off): v1 supports PAIRS only, groups are created
 * MANUALLY by the user, and rest after a full round uses the group's LAST
 * block's own targetRestSeconds. Round-robin for a pair (L = lower
 * supersetOrder, H = higher): completing L advances to H with NO rest;
 * completing H rests, then returns to L for the next round.
 */

export interface SupersetBlockInfo {
  id: string;
  supersetGroupId: string | null;
  supersetOrder: number | null;
  targetSets: number;
}

export interface SupersetAdvance {
  /** Start the rest timer (true only after the group's last block per round). */
  startRest: boolean;
  /** Block index to make current next (may equal currentIndex = stay). */
  nextIndex: number;
  /** 1-based set number for the next block. */
  nextSetNumber: number;
}

/**
 * Decide the next step after logging a working set on `currentIndex`.
 * Returns null when the current block is NOT in a (valid pair) superset — the
 * caller then uses the normal single-exercise rest flow.
 *
 * `completedByBlock` is the count of working sets already completed per block,
 * INCLUDING the set that was just logged for the current block.
 */
export function computeSupersetAdvance(
  blocks: SupersetBlockInfo[],
  currentIndex: number,
  completedByBlock: Record<string, number>
): SupersetAdvance | null {
  const cur = blocks[currentIndex];
  if (!cur || !cur.supersetGroupId) return null;

  const groupIdxs = blocks
    .map((b, i) => (b.supersetGroupId === cur.supersetGroupId ? i : -1))
    .filter((i) => i >= 0);

  // v1 is pairs-only: a well-formed group has exactly the current block + one
  // partner. Anything else (orphaned group id, >2 members) falls back to
  // normal flow rather than guessing.
  const partnerIdx = groupIdxs.find((i) => i !== currentIndex);
  if (groupIdxs.length !== 2 || partnerIdx == null) return null;

  const partner = blocks[partnerIdx];
  const partnerCompleted = completedByBlock[partner.id] ?? 0;
  const partnerRemaining = partnerCompleted < partner.targetSets;
  const isFirstOfPair = (cur.supersetOrder ?? 0) < (partner.supersetOrder ?? 0);

  if (isFirstOfPair && partnerRemaining) {
    // Did L -> straight to H, no rest.
    return { startRest: false, nextIndex: partnerIdx, nextSetNumber: partnerCompleted + 1 };
  }

  // Did H (last of round), or the partner is already finished: rest now.
  if (partnerRemaining) {
    // Return to the partner for the next round.
    return { startRest: true, nextIndex: partnerIdx, nextSetNumber: partnerCompleted + 1 };
  }

  // Group is effectively done for this partner — stay put and rest normally.
  return { startRest: true, nextIndex: currentIndex, nextSetNumber: (completedByBlock[cur.id] ?? 0) + 1 };
}
