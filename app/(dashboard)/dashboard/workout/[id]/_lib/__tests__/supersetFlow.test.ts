import { computeSupersetAdvance, type SupersetBlockInfo } from '../supersetFlow';

// A pair: L (index 0, order 0) supersetted with H (index 1, order 1), 3 sets each.
const pair = (targetSets = 3): SupersetBlockInfo[] => [
  { id: 'L', supersetGroupId: 'g1', supersetOrder: 0, targetSets },
  { id: 'H', supersetGroupId: 'g1', supersetOrder: 1, targetSets },
];

describe('computeSupersetAdvance — pairs, rest-after-last round-robin', () => {
  it('returns null for a block not in a superset (normal flow)', () => {
    const blocks: SupersetBlockInfo[] = [
      { id: 'A', supersetGroupId: null, supersetOrder: null, targetSets: 3 },
    ];
    expect(computeSupersetAdvance(blocks, 0, { A: 1 })).toBeNull();
  });

  it('L set -> advance to H, NO rest', () => {
    // Just logged L set 1: completed L=1, H=0
    const step = computeSupersetAdvance(pair(), 0, { L: 1, H: 0 });
    expect(step).toEqual({ startRest: false, nextIndex: 1, nextSetNumber: 1 });
  });

  it('H set -> rest, return to L for next round', () => {
    // Just logged H set 1: completed L=1, H=1; L has rounds left
    const step = computeSupersetAdvance(pair(), 1, { L: 1, H: 1 });
    expect(step).toEqual({ startRest: true, nextIndex: 0, nextSetNumber: 2 });
  });

  it('full round-robin sequence for 2x2 lands rest only after each H', () => {
    const blocks = pair(2);
    // L set1 -> H (no rest)
    expect(computeSupersetAdvance(blocks, 0, { L: 1, H: 0 })).toMatchObject({ startRest: false, nextIndex: 1 });
    // H set1 -> rest, back to L
    expect(computeSupersetAdvance(blocks, 1, { L: 1, H: 1 })).toMatchObject({ startRest: true, nextIndex: 0, nextSetNumber: 2 });
    // L set2 -> H (no rest)
    expect(computeSupersetAdvance(blocks, 0, { L: 2, H: 1 })).toMatchObject({ startRest: false, nextIndex: 1, nextSetNumber: 2 });
    // H set2 -> partner (L) now done -> rest, stay on H (group complete)
    expect(computeSupersetAdvance(blocks, 1, { L: 2, H: 2 })).toEqual({ startRest: true, nextIndex: 1, nextSetNumber: 3 });
  });

  it('L set when H already done -> rest, stay (no partner rounds left)', () => {
    // Uneven: L has more target sets; H finished. Completing L rests, stays.
    const blocks: SupersetBlockInfo[] = [
      { id: 'L', supersetGroupId: 'g1', supersetOrder: 0, targetSets: 4 },
      { id: 'H', supersetGroupId: 'g1', supersetOrder: 1, targetSets: 2 },
    ];
    const step = computeSupersetAdvance(blocks, 0, { L: 3, H: 2 });
    expect(step).toEqual({ startRest: true, nextIndex: 0, nextSetNumber: 4 });
  });

  it('falls back to normal flow (null) for a degenerate group of >2 members', () => {
    const blocks: SupersetBlockInfo[] = [
      { id: 'A', supersetGroupId: 'g', supersetOrder: 0, targetSets: 3 },
      { id: 'B', supersetGroupId: 'g', supersetOrder: 1, targetSets: 3 },
      { id: 'C', supersetGroupId: 'g', supersetOrder: 2, targetSets: 3 },
    ];
    expect(computeSupersetAdvance(blocks, 0, { A: 1, B: 0, C: 0 })).toBeNull();
  });

  it('falls back to normal flow for an orphaned group id (single member)', () => {
    const blocks: SupersetBlockInfo[] = [
      { id: 'A', supersetGroupId: 'g', supersetOrder: 0, targetSets: 3 },
      { id: 'B', supersetGroupId: null, supersetOrder: null, targetSets: 3 },
    ];
    expect(computeSupersetAdvance(blocks, 0, { A: 1 })).toBeNull();
  });

  it('respects supersetOrder regardless of array position (H before L)', () => {
    // H at index 0 (order 1), L at index 1 (order 0). Logging H (index 0) is
    // the "second" of the pair -> rest + go to L.
    const blocks: SupersetBlockInfo[] = [
      { id: 'H', supersetGroupId: 'g', supersetOrder: 1, targetSets: 3 },
      { id: 'L', supersetGroupId: 'g', supersetOrder: 0, targetSets: 3 },
    ];
    const step = computeSupersetAdvance(blocks, 0, { H: 1, L: 0 });
    expect(step).toEqual({ startRest: true, nextIndex: 1, nextSetNumber: 1 });
  });
});
