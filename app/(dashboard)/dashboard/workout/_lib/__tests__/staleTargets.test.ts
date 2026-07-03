import { isTargetStale, findStaleTargetBlocks, computeRecalcChanges, type PlannedTargetBlock } from '../staleTargets';

const T0 = '2026-07-01T10:00:00.000Z'; // block created
const BEFORE = '2026-06-30T10:00:00.000Z';
const AFTER = '2026-07-02T10:00:00.000Z';

describe('isTargetStale', () => {
  it('stale when an edit postdates the block target', () => {
    expect(isTargetStale(T0, AFTER)).toBe(true);
  });
  it('not stale when the latest edit predates the block target', () => {
    expect(isTargetStale(T0, BEFORE)).toBe(false);
  });
  it('not stale when there are no edits (null/undefined)', () => {
    expect(isTargetStale(T0, null)).toBe(false);
    expect(isTargetStale(T0, undefined)).toBe(false);
  });
  it('not stale on exact equality (strictly greater-than)', () => {
    expect(isTargetStale(T0, T0)).toBe(false);
  });
  it('handles unparseable dates as not stale', () => {
    expect(isTargetStale('nope', AFTER)).toBe(false);
    expect(isTargetStale(T0, 'nope')).toBe(false);
  });
});

describe('findStaleTargetBlocks', () => {
  const blocks: PlannedTargetBlock[] = [
    { id: 'b1', exerciseId: 'bench', exerciseName: 'Bench', createdAt: T0, targetWeightKg: 100 },
    { id: 'b2', exerciseId: 'row', exerciseName: 'Row', createdAt: T0, targetWeightKg: 80 },
    { id: 'b3', exerciseId: 'squat', exerciseName: 'Squat', createdAt: T0, targetWeightKg: 140 },
  ];

  it('returns only blocks whose exercise has a later edit', () => {
    const stale = findStaleTargetBlocks(blocks, { bench: AFTER, row: BEFORE });
    expect(stale.map((b) => b.id)).toEqual(['b1']);
  });

  it('returns empty when no exercise has edits', () => {
    expect(findStaleTargetBlocks(blocks, {})).toEqual([]);
  });

  it('can flag multiple stale blocks', () => {
    const stale = findStaleTargetBlocks(blocks, { bench: AFTER, squat: AFTER });
    expect(stale.map((b) => b.id).sort()).toEqual(['b1', 'b3']);
  });
});

describe('computeRecalcChanges', () => {
  const blocks: PlannedTargetBlock[] = [
    { id: 'b1', exerciseId: 'bench', exerciseName: 'Bench', createdAt: T0, targetWeightKg: 100 },
    { id: 'b2', exerciseId: 'row', exerciseName: 'Row', createdAt: T0, targetWeightKg: 80 },
  ];

  it('returns old -> new for meaningful changes', () => {
    const changes = computeRecalcChanges(blocks, (b) => (b.id === 'b1' ? 105 : 82.5));
    expect(changes).toEqual([
      { blockId: 'b1', exerciseName: 'Bench', oldKg: 100, newKg: 105 },
      { blockId: 'b2', exerciseName: 'Row', oldKg: 80, newKg: 82.5 },
    ]);
  });

  it('drops sub-0.5kg no-op changes', () => {
    const changes = computeRecalcChanges(blocks, (b) => b.targetWeightKg + 0.2);
    expect(changes).toEqual([]);
  });

  it('drops blocks with no confident estimate (0)', () => {
    const changes = computeRecalcChanges(blocks, (b) => (b.id === 'b1' ? 0 : 90));
    expect(changes.map((c) => c.blockId)).toEqual(['b2']);
  });
});
