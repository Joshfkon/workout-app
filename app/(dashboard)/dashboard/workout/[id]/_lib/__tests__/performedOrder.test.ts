import { moveJustStartedBlock } from '../performedOrder';

interface TestBlock {
  id: string;
  order: number;
  supersetGroupId: string | null;
}

const makeBlocks = (ids: string[], groups: Record<string, string> = {}): TestBlock[] =>
  ids.map((id, i) => ({ id, order: i + 1, supersetGroupId: groups[id] ?? null }));

const ids = (blocks: readonly TestBlock[] | null) => blocks?.map((b) => b.id) ?? null;

describe('moveJustStartedBlock', () => {
  it('returns null when nothing has been started yet (block stays in plan slot)', () => {
    const blocks = makeBlocks(['a', 'b', 'c', 'd']);
    expect(moveJustStartedBlock(blocks, new Set(), 'c')).toBeNull();
  });

  it('returns null when the block is already after every started block', () => {
    const blocks = makeBlocks(['a', 'b', 'c', 'd']);
    expect(moveJustStartedBlock(blocks, new Set(['a', 'b']), 'c')).toBeNull();
  });

  it('returns null for an unknown block id', () => {
    const blocks = makeBlocks(['a', 'b']);
    expect(moveJustStartedBlock(blocks, new Set(['a']), 'zzz')).toBeNull();
  });

  it('moves a backtracked block to directly after the last started block', () => {
    // User jumped ahead and did d first, then came back to a.
    const blocks = makeBlocks(['a', 'b', 'c', 'd', 'e']);
    const next = moveJustStartedBlock(blocks, new Set(['d']), 'a');
    expect(ids(next)).toEqual(['b', 'c', 'd', 'a', 'e']);
  });

  it('keeps started blocks in performed order across several jumps', () => {
    // Performed order: d, b, a — each first set moves the block into place.
    let blocks = makeBlocks(['a', 'b', 'c', 'd', 'e']);
    expect(moveJustStartedBlock(blocks, new Set(), 'd')).toBeNull(); // d stays

    let next = moveJustStartedBlock(blocks, new Set(['d']), 'b');
    expect(ids(next)).toEqual(['a', 'c', 'd', 'b', 'e']);
    blocks = next!;

    next = moveJustStartedBlock(blocks, new Set(['d', 'b']), 'a');
    expect(ids(next)).toEqual(['c', 'd', 'b', 'a', 'e']);
  });

  it('renumbers order 1..n on the returned array', () => {
    const blocks = makeBlocks(['a', 'b', 'c']);
    const next = moveJustStartedBlock(blocks, new Set(['c']), 'a');
    expect(next!.map((b) => b.order)).toEqual([1, 2, 3]);
    expect(ids(next)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const blocks = makeBlocks(['a', 'b', 'c']);
    const snapshot = blocks.map((b) => ({ ...b }));
    moveJustStartedBlock(blocks, new Set(['c']), 'a');
    expect(blocks).toEqual(snapshot);
  });

  it('brings an unstarted superset partner along, keeping the pair adjacent', () => {
    // Pair (b,c); user completed e first, then jumped back to the superset.
    const blocks = makeBlocks(['a', 'b', 'c', 'd', 'e'], { b: 'g1', c: 'g1' });
    const next = moveJustStartedBlock(blocks, new Set(['e']), 'b');
    expect(ids(next)).toEqual(['a', 'd', 'e', 'b', 'c']);
  });

  it('places the partner after the moved block even when the partner sat earlier in the plan', () => {
    // User started the pair from its second slot (c before b).
    const blocks = makeBlocks(['a', 'b', 'c', 'd', 'e'], { b: 'g1', c: 'g1' });
    const next = moveJustStartedBlock(blocks, new Set(['e']), 'c');
    expect(ids(next)).toEqual(['a', 'd', 'e', 'c', 'b']);
  });

  it('leaves a started superset partner where it is', () => {
    // b already has sets; something was interleaved before c's first set.
    const blocks = makeBlocks(['a', 'b', 'c', 'd'], { a: 'g1', c: 'g1' });
    const next = moveJustStartedBlock(blocks, new Set(['a', 'd']), 'c');
    // c moves after d (the last started block); a stays in place.
    expect(ids(next)).toEqual(['a', 'b', 'd', 'c']);
  });
});
