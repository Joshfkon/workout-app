import {
  confirmedRegression,
  recommendSeedForSlot,
  recommendSessionStart,
  type PrevSessionSet,
} from '../setRecommender';

/**
 * Fix 4: the regression path. Logged performance UNDER the prescribed range
 * (e.g. best set 6 reps where the floor is 8) prescribes DOWN only after TWO
 * consecutive below-floor sessions at a maintained load — one increment,
 * capped at −10% (mirror of the up-cap). One bad session is noise and holds.
 */

const REP_RANGE: [number, number] = [8, 12];
const TARGET_RIR = 2;
const INC = 2.5;

const belowFloorAt100: PrevSessionSet[] = [
  { weightKg: 100, reps: 6, rir: 0 },
  { weightKg: 100, reps: 5, rir: 0 },
  { weightKg: 100, reps: 5, rir: 0 },
];

const solidAt100: PrevSessionSet[] = [
  { weightKg: 100, reps: 10, rir: 2 },
  { weightKg: 100, reps: 9, rir: 2 },
];

describe('confirmedRegression', () => {
  it('two consecutive below-floor sessions at the same load confirm', () => {
    expect(confirmedRegression(belowFloorAt100, belowFloorAt100, REP_RANGE)).toBe(true);
  });

  it('one bad session after a solid one does NOT confirm', () => {
    expect(confirmedRegression(belowFloorAt100, solidAt100, REP_RANGE)).toBe(false);
  });

  it('a session that reaches the floor on its best set is not below floor', () => {
    const grinding: PrevSessionSet[] = [
      { weightKg: 100, reps: 8, rir: 0 }, // floor reached, just ground out
      { weightKg: 100, reps: 6, rir: 0 },
    ];
    expect(confirmedRegression(grinding, belowFloorAt100, REP_RANGE)).toBe(false);
  });

  it('does not confirm when the load was already self-corrected downward', () => {
    // Prior missed at 100; last session already dropped to 90 and still
    // missed — the reduced load gets its own second chance first.
    const belowFloorAt90 = belowFloorAt100.map((s) => ({ ...s, weightKg: 90 }));
    expect(confirmedRegression(belowFloorAt90, belowFloorAt100, REP_RANGE)).toBe(false);
    // Missing twice at the SAME reduced load then confirms.
    expect(confirmedRegression(belowFloorAt90, belowFloorAt90, REP_RANGE)).toBe(true);
  });

  it('no prior session (empty list) never confirms', () => {
    expect(confirmedRegression(belowFloorAt100, [], REP_RANGE)).toBe(false);
  });
});

describe('recommendSessionStart — regression path', () => {
  const base = {
    prevWeightKg: 100,
    prevReps: 6,
    prevRir: 0,
    targetRepRange: REP_RANGE,
    targetRir: TARGET_RIR,
    minIncrementKg: INC,
    prevSessionSets: belowFloorAt100,
  };

  it('two consecutive under-floor sessions → one-increment decrement, reps recentered', () => {
    const rec = recommendSessionStart({ ...base, priorSessionSets: belowFloorAt100 });
    expect(rec.rationale).toBe('reduce_load');
    expect(rec.weightKg).toBe(97.5); // 100 − one 2.5 kg increment (well inside the −10% cap)
    expect(rec.reps).toBe(10); // mid of 8-12
  });

  it('one bad session → HOLD at the same load (could be noise/sleep)', () => {
    const rec = recommendSessionStart({ ...base, priorSessionSets: solidAt100 });
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(100);
    expect(rec.reps).toBe(6); // honest reps — no invented in-range count
  });

  it('first-ever bad session (known-empty prior history) also holds', () => {
    const rec = recommendSessionStart({ ...base, priorSessionSets: [] });
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(100);
  });

  it('without prior-session info (legacy callers) the old curve-based reduce is unchanged', () => {
    const rec = recommendSessionStart({
      prevWeightKg: 100,
      prevReps: 6,
      prevRir: 0,
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: INC,
    });
    expect(rec.rationale).toBe('reduce_load');
    expect(rec.weightKg).toBeLessThan(97.5); // legacy aims mid-range, up to −30%
  });

  it('the decrement never exceeds ~10% even with a coarse increment', () => {
    // 20 kg cable with a 2.5 kg stack step: one increment (12.5%) is past the
    // cap; the step lands on the nearest loadable weight at/under the cap.
    const rec = recommendSessionStart({
      prevWeightKg: 20,
      prevReps: 6,
      prevRir: 0,
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: 2.5,
      prevSessionSets: belowFloorAt100.map((s) => ({ ...s, weightKg: 20 })),
      priorSessionSets: belowFloorAt100.map((s) => ({ ...s, weightKg: 20 })),
    });
    expect(rec.rationale).toBe('reduce_load');
    expect(rec.weightKg).toBe(17.5); // one increment — the smallest loadable step
  });
});

describe('recommendSeedForSlot — regression path on the e1RM anchor', () => {
  // A stale-ish anchor that would otherwise keep prescribing ~100 kg.
  const base = {
    role: 'working' as const,
    targetRepRange: REP_RANGE,
    targetRir: TARGET_RIR,
    minIncrementKg: INC,
    anchorE1RMKg: 140,
    recentWorkingWeightKg: 100,
    prevWeightKg: 100,
    prevReps: 6,
    prevRir: 0,
  };

  it('confirmed regression steps the working seed down one increment', () => {
    const seed = recommendSeedForSlot({
      ...base,
      prevSessionSets: belowFloorAt100,
      priorSessionSets: belowFloorAt100,
    });
    expect(seed.weightKg).toBe(97.5);
    expect(seed.anchorSource).toBe('last_session'); // provenance: not the curve
  });

  it('one bad session leaves the anchor prescription in place (no decrement)', () => {
    const seed = recommendSeedForSlot({
      ...base,
      prevSessionSets: belowFloorAt100,
      priorSessionSets: solidAt100,
    });
    // Anchor path unchanged: curve at mid-range, clamped/gated ≤ 100.
    expect(seed.weightKg).toBe(100);
    expect(seed.anchorSource).toBe('e1rm');
  });

  it('a ramp slot bases its percentage on the stepped-down working weight', () => {
    const seed = recommendSeedForSlot({
      ...base,
      role: 'ramp',
      prevWeightKg: 57.5,
      prevSessionSets: belowFloorAt100,
      priorSessionSets: belowFloorAt100,
    });
    // 57.5% of the stepped 97.5 ≈ 56.06 → rounded to 2.5.
    expect(seed.weightKg).toBe(55);
    expect(seed.role).toBe('ramp');
  });
});
