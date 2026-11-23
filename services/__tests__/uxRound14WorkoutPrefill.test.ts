/**
 * UX round 14 — workout-screen prefill fixes (pure halves).
 *
 *  - seedRepsAtTarget: a position-matched load step prefills the reps the
 *    strip's own forecast gives at the target reserve, not the range floor
 *    (Bench: last 135 × 10 @ 2 RIR → 140 × 9, not 140 × 6 under a hint
 *    reading "~9 reps would leave 2").
 *  - weightEditAnchorE1RM: a weight edit never refills reps from the rough
 *    cold-start estimate (225 typed over an 80 lb guess snapped reps to 1).
 *  - effortBasisIsColdStartOnly: no near-max forecast on the app's own guess.
 */
import { recommendSeedForSlot, seedRepsAtTarget, estimateRepsForWeight } from '../setRecommender';
import {
  weightEditAnchorE1RM,
  effortBasisIsColdStartOnly,
  lastSessionE1RM,
  coldStartE1RM,
} from '../prescription/sessionPrescription';

const lb = (x: number) => x / 2.20462;

describe('seedRepsAtTarget (position-matched load step)', () => {
  // Bench last session: three sets of 135 × 10 at 2 RIR; range 6–10, 2 RIR.
  const prevSets = [0, 1, 2].map(() => ({ weightKg: lb(135), reps: 10, rir: 2 }));
  const seed = recommendSeedForSlot({
    role: 'working',
    targetRepRange: [6, 10],
    targetRir: 2,
    minIncrementKg: lb(5),
    anchorE1RMKg: 0,
    recentWorkingWeightKg: lb(135),
    prevWeightKg: lb(135),
    prevReps: 10,
    prevRir: 2,
    prevSessionSets: prevSets,
    slotIndex: 0,
    plannedSetCount: 3,
  });
  const e1rm = lastSessionE1RM(
    // 2 RIR logged = RPE 8.
    prevSets.map((s) => ({ weightKg: s.weightKg, reps: s.reps, rpe: 8 })),
    2
  );

  it('the engine steps the load and asks the range floor (unchanged)', () => {
    expect(seed.anchorSource).toBe('position_match');
    expect(seed.positionMatch?.progression).toBe('add_load');
    expect(seed.seedReps).toBe(6);
    expect(Math.round(seed.weightKg * 2.20462)).toBe(140);
  });

  it('prefills the reps predicted at the target RIR — the same number the hint quotes', () => {
    const reps = seedRepsAtTarget(seed, { loadKg: lb(140), e1rmKg: e1rm, targetRir: 2 });
    // The strip's hint: predicted max reps at the load, minus the target RIR, capped to the range.
    const maxReps = estimateRepsForWeight(lb(140), {
      lastWeightKg: 0,
      lastReps: 0,
      lastRir: 0,
      setsCompletedThisExercise: 0,
      sessionBestE1RMKg: e1rm,
      targetRepRange: [6, 10],
      targetRir: 0,
    })!;
    expect(reps).toBe(Math.min(10, maxReps - 2));
    expect(reps).toBe(9);
  });

  it('never drops below the engine floor or above the range ceiling', () => {
    // A weak anchor predicts fewer reps than the floor → keep the floor.
    expect(seedRepsAtTarget(seed, { loadKg: lb(140), e1rmKg: lb(150), targetRir: 2 })).toBe(6);
    // A very strong anchor → capped at the top of the range.
    expect(seedRepsAtTarget(seed, { loadKg: lb(140), e1rmKg: lb(300), targetRir: 2 })).toBe(10);
  });

  it('leaves every other seed\'s rep target alone', () => {
    expect(
      seedRepsAtTarget({ ...seed, positionMatch: { ...seed.positionMatch!, progression: 'add_rep' }, seedReps: 11 }, {
        loadKg: lb(140),
        e1rmKg: e1rm,
        targetRir: 2,
      })
    ).toBe(11);
    expect(seedRepsAtTarget({ ...seed, anchorSource: 'e1rm', seedReps: undefined }, { loadKg: lb(140), e1rmKg: e1rm, targetRir: 2 })).toBeUndefined();
    // No anchor to read → the engine's own ask.
    expect(seedRepsAtTarget(seed, { loadKg: lb(140), e1rmKg: undefined, targetRir: 2 })).toBe(6);
  });
});

describe('weightEditAnchorE1RM (no refill from the rough cold-start guess)', () => {
  it('a cold-start lift with nothing logged has no edit anchor — reps stay as they are', () => {
    // The cold-start estimate exists (80 lb guess → ~120 lb est. max) but is not a rung.
    expect(coldStartE1RM(lb(80), [10, 15], 2)).toBeGreaterThan(0);
    expect(
      weightEditAnchorE1RM({ sessionBestE1RM: undefined, storedE1RMKg: 0, lastSessionE1RM: undefined, hasReferenceSet: false })
    ).toBeUndefined();
  });

  it('a logged working set today resumes normal refills', () => {
    expect(
      weightEditAnchorE1RM({ sessionBestE1RM: 140, storedE1RMKg: 0, lastSessionE1RM: undefined, hasReferenceSet: true })
    ).toBe(140);
  });

  it('logged history from earlier sessions still anchors edits (stored first, then last session)', () => {
    expect(weightEditAnchorE1RM({ storedE1RMKg: 120, lastSessionE1RM: 110, hasReferenceSet: false })).toBe(120);
    expect(weightEditAnchorE1RM({ storedE1RMKg: 0, lastSessionE1RM: 110, hasReferenceSet: false })).toBe(110);
    // A reference set carries its own capacity; the stored value doesn't override it.
    expect(weightEditAnchorE1RM({ storedE1RMKg: 120, lastSessionE1RM: 110, hasReferenceSet: true })).toBeUndefined();
  });
});

describe('effortBasisIsColdStartOnly', () => {
  it('is true only when nothing is logged today and there is no previous session', () => {
    expect(effortBasisIsColdStartOnly({ hasLoggedSetToday: false, lastSessionE1RM: undefined })).toBe(true);
    expect(effortBasisIsColdStartOnly({ hasLoggedSetToday: true, lastSessionE1RM: undefined })).toBe(false);
    expect(effortBasisIsColdStartOnly({ hasLoggedSetToday: false, lastSessionE1RM: 100 })).toBe(false);
  });
});
