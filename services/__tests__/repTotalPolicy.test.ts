import {
  resolveProgressionModel,
  recommendRepTotalSessionStart,
  recommendRepTotalNextSet,
} from '../suggestionEngine/repTotalPolicy';

describe('resolveProgressionModel', () => {
  it('explicit column value always wins', () => {
    expect(resolveProgressionModel('rep_total', 10, 0)).toBe('rep_total');
    expect(resolveProgressionModel('e1rm', 0, 10)).toBe('e1rm');
  });
  it('NULL auto-classifies: majority-inestimable history routes to rep_total', () => {
    expect(resolveProgressionModel(null, 2, 5)).toBe('rep_total');
    expect(resolveProgressionModel(undefined, 5, 2)).toBe('e1rm');
    expect(resolveProgressionModel(null, 3, 3)).toBe('e1rm'); // tie → e1rm
  });
});

describe('recommendRepTotalSessionStart', () => {
  const LB135_KG = 61.23496995;
  const range: [number, number] = [12, 20];

  it('repeat: holds the load VERBATIM and asks to beat last total by one', () => {
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: LB135_KG, reps: 12, rir: 1 },
        { weightKg: LB135_KG, reps: 10, rir: 1 },
        { weightKg: LB135_KG, reps: 8, rir: 1 },
      ],
      targetRepRange: range,
      targetRir: 2,
      minIncrementKg: 4.54,
      plannedSets: 3,
    })!;
    expect(plan.weightKg).toBe(LB135_KG); // no grid snapping, ever
    expect(plan.bumped).toBe(false); // sets 2-3 below the 12 floor
    expect(plan.prevSessionRepTotal).toBe(30);
    expect(plan.sessionRepTotalTarget).toBe(31);
    // Per-set seeds mirror last session, floored at 12: 12 / 12 / 12.
    expect(plan.perSetRepTargets).toEqual([12, 12, 12]);
  });

  it('bump: every set at/above the floor at target effort adds ONE native increment', () => {
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 61.23, reps: 14, rir: 2 },
        { weightKg: 61.23, reps: 13, rir: 2 },
        { weightKg: 61.23, reps: 12, rir: 3 },
      ],
      targetRepRange: range,
      targetRir: 2,
      minIncrementKg: 4.54,
      plannedSets: 3,
    })!;
    expect(plan.bumped).toBe(true);
    expect(plan.weightKg).toBeCloseTo(61.23 + 4.54, 5); // +10 lb, additive
    expect(plan.perSetRepTargets).toEqual([12, 12, 12]); // reps reset to floor
    expect(plan.sessionRepTotalTarget).toBe(36);
  });

  it('too-easy sets (RIR way above target) do NOT earn the bump — chase reps instead', () => {
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 61.23, reps: 14, rir: 4 }, // 2 over target+tolerance
        { weightKg: 61.23, reps: 13, rir: 2 },
      ],
      targetRepRange: range,
      targetRir: 2,
      minIncrementKg: 4.54,
      plannedSets: 2,
    })!;
    expect(plan.bumped).toBe(false);
    expect(plan.weightKg).toBe(61.23);
  });

  it('returns null with no usable history (caller keeps its cold-start path)', () => {
    expect(
      recommendRepTotalSessionStart({
        prevSessionSets: [],
        targetRepRange: range,
        targetRir: 2,
        plannedSets: 3,
      })
    ).toBeNull();
  });
});

describe('recommendRepTotalNextSet', () => {
  it('holds the fixed load and reports total progress', () => {
    const plan = recommendRepTotalSessionStart({
      prevSessionSets: [
        { weightKg: 61.23, reps: 12, rir: 1 },
        { weightKg: 61.23, reps: 10, rir: 1 },
        { weightKg: 61.23, reps: 8, rir: 1 },
      ],
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 4.54,
      plannedSets: 3,
    })!;
    const next = recommendRepTotalNextSet({ sessionPlan: plan, completedReps: [13, 11] });
    expect(next.weightKg).toBe(61.23);
    expect(next.reps).toBe(12); // slot 3's plan (8 floored to 12)
    expect(next.totalSoFar).toBe(24);
    expect(next.sessionRepTotalTarget).toBe(31);
    expect(next.remainingToTarget).toBe(7);
  });
});
