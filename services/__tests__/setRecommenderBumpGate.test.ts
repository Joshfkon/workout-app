import {
  earnedSessionBump,
  recommendSeedForSlot,
  recommendSessionStart,
  type PrevSessionSet,
} from '../setRecommender';

/**
 * Fix 2 (audit failure mode #5): session-to-session load increases are gated
 * on ALL prescribed working sets reaching the top of the rep range — a single
 * strong set no longer buys a bump. The existing effort condition
 * (>= 2 RIR spare, or a +2 rep overshoot) still applies, per qualifying set.
 * Ramp / back-off sets (below 75% of the session top set) are excluded per the
 * set-role model.
 */

const REP_RANGE: [number, number] = [8, 12];
const TARGET_RIR = 1;
const INC = 2.5;

// One strong top set (12 @ 3 RIR = 2 spare over target) then mid-range sets.
const oneStrongSet: PrevSessionSet[] = [
  { weightKg: 100, reps: 12, rir: 3 },
  { weightKg: 100, reps: 10, rir: 1 },
  { weightKg: 100, reps: 9, rir: 1 },
];

// Every working set cleared the top with >= 2 RIR spare.
const allSetsStrong: PrevSessionSet[] = [
  { weightKg: 100, reps: 12, rir: 3 },
  { weightKg: 100, reps: 12, rir: 3 },
  { weightKg: 100, reps: 12, rir: 3 },
];

describe('earnedSessionBump', () => {
  it('one qualifying set among mid-range sets does NOT earn a bump', () => {
    expect(earnedSessionBump(oneStrongSet, REP_RANGE, TARGET_RIR)).toBe(false);
  });

  it('all working sets at the top of the range with spare RIR earns a bump', () => {
    expect(earnedSessionBump(allSetsStrong, REP_RANGE, TARGET_RIR)).toBe(true);
  });

  it('a rep overshoot (+2 over top) qualifies a set regardless of reported RIR', () => {
    const sets: PrevSessionSet[] = [
      { weightKg: 100, reps: 15, rir: 0 },
      { weightKg: 100, reps: 15, rir: 0 },
    ];
    expect(earnedSessionBump(sets, REP_RANGE, TARGET_RIR)).toBe(true);
  });

  it('top-of-range WITHOUT the RIR spare does not qualify', () => {
    const sets: PrevSessionSet[] = [
      { weightKg: 100, reps: 12, rir: 1 }, // on-target effort, not clearly too light
      { weightKg: 100, reps: 12, rir: 1 },
    ];
    expect(earnedSessionBump(sets, REP_RANGE, TARGET_RIR)).toBe(false);
  });

  it('a designated back-off / ramp set (below 75% of top) is not graded', () => {
    // Working sets both earned; the light last set (57.5% of top) is a ramp
    // set per role inference and must not block the bump.
    const withBackOff: PrevSessionSet[] = [
      { weightKg: 100, reps: 12, rir: 3 },
      { weightKg: 100, reps: 12, rir: 3 },
      { weightKg: 57.5, reps: 10, rir: 2 },
    ];
    expect(earnedSessionBump(withBackOff, REP_RANGE, TARGET_RIR)).toBe(true);
  });

  it('an empty or zero-load session earns nothing', () => {
    expect(earnedSessionBump([], REP_RANGE, TARGET_RIR)).toBe(false);
    expect(earnedSessionBump([{ weightKg: 0, reps: 0 }], REP_RANGE, TARGET_RIR)).toBe(false);
  });
});

describe('recommendSeedForSlot — anchor path honors the all-sets gate', () => {
  // Anchor from the one strong set: Epley(100, 12, 3) = 100 * (1 + 15/30) = 150.
  // Curve weight at mid-range (10) @ 1 RIR = 150 / (1 + 11/30) ≈ 109.8, which
  // the ±10% clamp alone would allow (110) — the gate must hold it at 100.
  const baseInput = {
    role: 'working' as const,
    targetRepRange: REP_RANGE,
    targetRir: TARGET_RIR,
    minIncrementKg: INC,
    anchorE1RMKg: 150,
    recentWorkingWeightKg: 100,
    prevWeightKg: 100,
    prevReps: 12,
    prevRir: 3,
  };

  it('HOLDs at the recent working weight when only one set qualified', () => {
    const seed = recommendSeedForSlot({ ...baseInput, prevSessionSets: oneStrongSet });
    expect(seed.weightKg).toBe(100);
    expect(seed.clamped).toBe(true); // the gate bound the prescription — say so
  });

  it('bumps when ALL working sets hit the top of the range', () => {
    const seed = recommendSeedForSlot({ ...baseInput, prevSessionSets: allSetsStrong });
    expect(seed.weightKg).toBeGreaterThan(100);
    expect(seed.weightKg).toBeLessThanOrEqual(110); // still ±10% capped
  });

  it('without the set list (legacy callers) behavior is unchanged', () => {
    const seed = recommendSeedForSlot(baseInput);
    expect(seed.weightKg).toBe(110);
  });

  it('the gate never blocks a reduction (curve below recent weight)', () => {
    // Weak anchor: curve says ~91.8 kg — below the recent 100. The gate only
    // ceilings increases; the recenter-down is untouched.
    const seed = recommendSeedForSlot({
      ...baseInput,
      anchorE1RMKg: 130,
      prevSessionSets: oneStrongSet,
    });
    expect(seed.weightKg).toBeLessThan(100);
  });
});

describe('recommendSessionStart — fallback path honors the all-sets gate', () => {
  it('HOLDs when the reference set alone would bump but the session did not earn it', () => {
    const rec = recommendSessionStart({
      prevWeightKg: 100,
      prevReps: 12,
      prevRir: 3,
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: INC,
      prevSessionSets: oneStrongSet,
    });
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(100);
    expect(rec.reps).toBe(12);
  });

  it('bumps when every working set earned it', () => {
    const rec = recommendSessionStart({
      prevWeightKg: 100,
      prevReps: 12,
      prevRir: 3,
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: INC,
      prevSessionSets: allSetsStrong,
    });
    expect(rec.rationale).toBe('increase_load');
    expect(rec.weightKg).toBeGreaterThan(100);
  });

  it('without the set list, single-set grading is unchanged (legacy)', () => {
    const rec = recommendSessionStart({
      prevWeightKg: 100,
      prevReps: 12,
      prevRir: 3,
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: INC,
    });
    expect(rec.rationale).toBe('increase_load');
  });
});
