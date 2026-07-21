import {
  earnedSessionBump,
  recommendSeedForSlot,
  recommendSessionStart,
  type PrevSessionSet,
} from '../setRecommender';

/**
 * Session-to-session load increases are gated on the shared success predicate
 * (sessionMetPrescription, design doc §10): the TOP working set(s) reaching
 * the top of the rep range earns the bump — at any logged effort (on-target
 * meets the prescription; easier is effort overshoot, still success). The old
 * all-sets + RIR-spare gate made progression unreachable when following
 * prescriptions exactly (top-of-range at target RIR never qualified).
 * Ramp / back-off sets (below 75% of the session top set) and out-of-scheme
 * sets (reps outside the grading window) are excluded.
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
  it('a top set at the top of the range earns the bump even with mid-range back-half sets', () => {
    // 12 @ 3 RIR on the top set IS double-progression success; the 10/9-rep
    // back-half no longer vetoes it (the old all-sets gate was the bug).
    expect(earnedSessionBump(oneStrongSet, REP_RANGE, TARGET_RIR)).toBe(true);
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

  it('top-of-range at target effort (no RIR spare) DOES qualify — §10 double progression', () => {
    const sets: PrevSessionSet[] = [
      { weightKg: 100, reps: 12, rir: 1 }, // repMax at target RIR = prescription met
      { weightKg: 100, reps: 12, rir: 1 },
    ];
    expect(earnedSessionBump(sets, REP_RANGE, TARGET_RIR)).toBe(true);
  });

  it('a top set short of repMax does NOT earn a bump', () => {
    const sets: PrevSessionSet[] = [
      { weightKg: 100, reps: 11, rir: 3 },
      { weightKg: 100, reps: 10, rir: 1 },
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

describe('recommendSeedForSlot — anchor path honors the success-predicate gate', () => {
  // Anchor from the one strong set: Epley(100, 12, 3) = 100 * (1 + 15/30) = 150.
  // Curve weight at mid-range (10) @ 1 RIR = 150 / (1 + 11/30) ≈ 109.8 (110 at
  // the increment) — allowed only when the previous session MET its prescription.
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

  // Session where no top set reached repMax — the gate must ceiling the seed.
  const notMetSets: PrevSessionSet[] = [
    { weightKg: 100, reps: 11, rir: 3 },
    { weightKg: 100, reps: 10, rir: 1 },
  ];

  it('bumps off a met session (top set at repMax) even with mid-range back-half sets', () => {
    const seed = recommendSeedForSlot({ ...baseInput, prevSessionSets: oneStrongSet });
    expect(seed.weightKg).toBe(110);
  });

  it('HOLDs at the recent working weight when the session did not meet its prescription', () => {
    const seed = recommendSeedForSlot({ ...baseInput, prevSessionSets: notMetSets });
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

describe('recommendSessionStart — fallback path honors the success-predicate gate', () => {
  it('bumps off a met session (top set at repMax) and reseeds reps at the range floor', () => {
    const rec = recommendSessionStart({
      prevWeightKg: 100,
      prevReps: 12,
      prevRir: 3,
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: INC,
      prevSessionSets: oneStrongSet,
    });
    expect(rec.rationale).toBe('increase_load');
    expect(rec.weightKg).toBeGreaterThan(100);
    expect(rec.reps).toBe(REP_RANGE[0]);
  });

  it('HOLDs the load (with a +1 rep ask) when no top set reached repMax', () => {
    const rec = recommendSessionStart({
      prevWeightKg: 100,
      prevReps: 11,
      prevRir: 3,
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: INC,
      prevSessionSets: [
        { weightKg: 100, reps: 11, rir: 3 },
        { weightKg: 100, reps: 10, rir: 1 },
      ],
    });
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(100);
    expect(rec.reps).toBe(12); // 11 + 1, capped at repMax
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
