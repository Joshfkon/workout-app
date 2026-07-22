/**
 * Dry-run retag report for credit-smearing coarse tags (audit Phase 3).
 * REPORT-ONLY guarantees: proposals match the confirmed mappings for the
 * audit's reference custom exercises; nothing here mutates anything.
 */

import {
  buildCoarsePrimaryRetagReport,
  perSetCredit,
  isSplittingCoarseToken,
  type RetagExerciseRow,
} from '../coarsePrimaryRetag';

const row = (
  id: string,
  name: string,
  primary: string,
  secondaries: string[] = []
): RetagExerciseRow => ({ id, name, primary_muscle: primary, secondary_muscles: secondaries });

describe('isSplittingCoarseToken', () => {
  it('flags the multi-target coarse groups and nothing precise', () => {
    expect(isSplittingCoarseToken('shoulders')).toBe(true);
    expect(isSplittingCoarseToken('chest')).toBe(true);
    expect(isSplittingCoarseToken('back')).toBe(true);
    expect(isSplittingCoarseToken('lateral_delts')).toBe(false);
    expect(isSplittingCoarseToken('biceps')).toBe(false);
    expect(isSplittingCoarseToken('glutes')).toBe(false); // 1:1 coarse
  });
});

describe('reference custom exercises (confirmed mappings — 3b)', () => {
  const report = buildCoarsePrimaryRetagReport([
    row('arnold', 'Arnold Press', 'shoulders'),
    row('lrm', 'Lateral Raise (Machine)', 'shoulders'),
    row('lrc', 'Lateral Raise (Cable)', 'shoulders'),
    // Already-precise exercises must NOT appear in the report.
    row('cur', 'Cable Upright Row', 'lateral_delts', ['traps', 'biceps']),
    row('pd', 'Lat Pulldown', 'lats', ['biceps', 'upper_back', 'rear_delts']),
  ]);
  const byId = new Map(report.map((p) => [p.id, p]));

  it('reports exactly the three smearing customs', () => {
    expect(report.map((p) => p.id).sort()).toEqual(['arnold', 'lrc', 'lrm']);
  });

  it('lateral raises → lateral_delts, no secondaries', () => {
    for (const id of ['lrm', 'lrc']) {
      const p = byId.get(id)!;
      expect(p.proposedPrimary).toBe('lateral_delts');
      expect(p.proposedSecondaries).toEqual([]);
      expect(p.rule).toBe('name_pattern');
    }
  });

  it('Arnold Press → front_delts + lateral_delts secondary (NOT front-only)', () => {
    const p = byId.get('arnold')!;
    expect(p.proposedPrimary).toBe('front_delts');
    expect(p.proposedSecondaries).toEqual(['lateral_delts']);
    // Credit delta: ⅓/⅓/⅓ per set → front 1.0 + side 0.5; rear leakage gone,
    // side-delt stimulus retained instead of cratering by ~2.7 sets/wk.
    expect(p.creditPerSetBefore).toEqual({
      front_delts: 0.33,
      lateral_delts: 0.33,
      rear_delts: 0.33,
    });
    expect(p.creditPerSetAfter).toEqual({ front_delts: 1, lateral_delts: 0.5 });
  });
});

describe('stock-policy and fallback rules', () => {
  it("flat pressing stays coarse 'chest' (intentionally coarse, no retag proposed)", () => {
    const [p] = buildCoarsePrimaryRetagReport([row('fb', 'Flat DB Bench Press', 'chest')]);
    expect(p.rule).toBe('intentionally_coarse');
    expect(p.proposedPrimary).toBeNull();
  });

  it("rows stay coarse 'back'; vertical pulls propose lats", () => {
    const report = buildCoarsePrimaryRetagReport([
      row('r', 'Chest Supported Row', 'back'),
      row('p', 'Wide Grip Pulldown', 'back'),
    ]);
    expect(report.find((p) => p.id === 'r')!.rule).toBe('intentionally_coarse');
    expect(report.find((p) => p.id === 'p')!.proposedPrimary).toBe('lats');
  });

  it('an undisambiguated shoulders name falls back to the AI-completion default, marked for review', () => {
    const [p] = buildCoarsePrimaryRetagReport([row('x', 'Delt Blaster 3000', 'shoulders')]);
    expect(p.rule).toBe('ai_completion_default');
    expect(p.proposedPrimary).toBe('lateral_delts');
  });

  it('a precise primary with a coarse secondary is flagged needs_review (partial smear)', () => {
    const [p] = buildCoarsePrimaryRetagReport([
      row('cg', 'Close Grip Press', 'triceps', ['shoulders']),
    ]);
    expect(p.rule).toBe('needs_review');
    expect(p.coarseSecondaries).toEqual(['shoulders']);
    expect(p.proposedPrimary).toBeNull();
  });
});

describe('perSetCredit mirrors the live counter', () => {
  it('coarse shoulders splits ⅓ per head; secondary tokens carry 0.5 each', () => {
    expect(perSetCredit('shoulders', [])).toEqual({
      front_delts: 0.33,
      lateral_delts: 0.33,
      rear_delts: 0.33,
    });
    expect(perSetCredit('lats', ['rear_delts'])).toEqual({ lats: 1, rear_delts: 0.5 });
  });
});
