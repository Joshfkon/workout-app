/**
 * Regression pin — the rep_total "ceiling dead-end" (live case, Aug 17 → 25
 * 2026: weighted bodyweight exercise, 8–12 range, last session 13/15/15/14
 * at the same effective load, every set at or easier than target effort).
 *
 * Two rules that are each individually defensible interact into a plan that
 * prescribes LESS than last session while acknowledging it in the banner:
 *
 *  1. The bump gate (repTotalPolicy.ts recommendRepTotalSessionStart,
 *     `bumped`) fails any at-load set whose resolved RIR is more than
 *     EFFORT_TOLERANCE_RIR EASIER than target ("too easy doesn't earn the
 *     bump — chase reps instead", pinned in repTotalPolicy.test.ts). So one
 *     "Easy (4+ RIR)"-rated set — or a calibration/readiness-lowered target
 *     RIR — holds the load.
 *  2. The repeat branch then seeds each set from last session's counts
 *     CLAMPED into the configured range (min(repMax, max(repMin, prev))),
 *     and the target increment can only be distributed to sets below the
 *     ceiling. With every observed count at/above repMax there is no rep
 *     headroom: the increment loop breaks with `needed` unplaced, and the
 *     session target ships BELOW last session's actual total — violating
 *     spec §3 ("on a load repeat the target grows from last session's
 *     actual total by at least 1 rep") — with only the volumeShortfall
 *     banner as an acknowledgement ("projects N% below last session's
 *     volume"). "Chase reps instead" is not possible; nothing routes the
 *     over-ceiling capacity to the load lever.
 *
 * The `it.failing` cases pin the CORRECTED behavior (repo convention: they
 * go red when the engine is fixed — remove `.failing` then). The plain `it`
 * pins today's defective output byte-for-byte and must be DELETED in the
 * same change that fixes the engine.
 */

import { recommendRepTotalSessionStart } from '../suggestionEngine/repTotalPolicy';

// Effective loads (kg), modeled on the live case: set 1 carried a recorded
// composition (BW+60 → 110.2 effective); sets 2–4 are legacy/migrated rows
// whose stored blended load sits ~1.4% lower (108.7) — inside the at-load
// grid tolerance max(inc/2, 2.5%) = 2.755, so all four sets group at the top
// load and the previous-session total is 57.
const TOP_KG = 110.2;
const EST_KG = 108.7;
const RANGE: [number, number] = [8, 12];

const aug17 = (rirs: [number, number, number, number]) => [
  { weightKg: TOP_KG, reps: 13, rir: rirs[0] }, // 13 @ RPE 7.5 → rpeToRir = 2
  { weightKg: EST_KG, reps: 15, rir: rirs[1] },
  { weightKg: EST_KG, reps: 15, rir: rirs[2] },
  { weightKg: EST_KG, reps: 14, rir: rirs[3] },
];

const plan = (rirs: [number, number, number, number], targetRir = 2) =>
  recommendRepTotalSessionStart({
    prevSessionSets: aug17(rirs),
    targetRepRange: RANGE,
    targetRir,
    minIncrementKg: 2.5,
    plannedSets: 4,
  })!;

describe('rep_total ceiling dead-end (Aug 17 case)', () => {
  it('PINS today’s defective output — delete this test with the engine fix', () => {
    // One set rated "Easy" (4+ RIR chip → RPE 6 → rir 4) blocks the bump
    // gate (4 > targetRir 2 + tolerance 1) even though every set cleared the
    // floor with reps past the CEILING.
    const p = plan([2, 2, 2, 4]);

    // Load held verbatim; no bump, not even a deferred one.
    expect(p.weightKg).toBe(TOP_KG);
    expect(p.bumped).toBe(false);
    expect(p.bumpDeferred).toBeUndefined();

    // All four at-load sets grouped: prev total = 13+15+15+14.
    expect(p.prevSessionRepTotal).toBe(57);
    expect(p.rampHistory).toBe(false);

    // Seeds clamp to the 12 ceiling; the +2 increment (1 + overshoot gain on
    // the easy set's 2-rep effort surplus) has no sub-ceiling set to land in.
    expect(p.perSetRepTargets).toEqual([12, 12, 12, 12]);
    expect(p.sessionRepTotalTarget).toBe(48);

    // THE DEFECT: a same-load plan asking for LESS than last session's
    // actual total (48 < 57 + 1), shipped with only a banner acknowledgment.
    expect(p.sessionRepTotalTarget).toBeLessThan(p.prevSessionRepTotal + 1);
    expect(p.volumeShortfall).toEqual({
      prevKg: 6215.4, // 110.2×13 + 108.7×44
      projectedKg: 5289.6, // 110.2×48 → "projects 15% below last session's volume"
    });
  });

  it.failing(
    'CORRECTED: over-ceiling capacity at ≤ target effort must engage the load lever, not ship a sub-prev-total plan',
    () => {
      const p = plan([2, 2, 2, 4]);
      // Every at-load set cleared the range floor at target effort OR EASIER,
      // with counts past the range ceiling. Rep headroom is zero, so "chase
      // reps instead" is unavailable; per spec §4/AM-5 over-range capacity is
      // the LOAD's job. The engine must not hold the load while asking below
      // last session's total + 1.
      const heldBelowPrev =
        p.weightKg === TOP_KG && p.sessionRepTotalTarget < p.prevSessionRepTotal + 1;
      expect(heldBelowPrev).toBe(false);
      // The concrete corrected shape: the multi-step bump fit (already used by
      // the bumped branch) prices the observed 13/15/15/14 onto a stepped-up
      // load with every target inside 8–12.
      expect(p.weightKg).toBeGreaterThan(TOP_KG);
      expect(p.perSetRepTargets.every((r) => r >= RANGE[0] && r <= RANGE[1])).toBe(true);
    }
  );

  it.failing(
    'CORRECTED: a calibration/readiness-lowered target RIR must not open the same dead-end',
    () => {
      // Same history logged at RPE 7.5/7/7/7 (rir 2/3/3/3), but the
      // calibration- and readiness-adjusted target RIR arrives as 1
      // (ExerciseCard effectiveTargetRir). Gate now needs rir ≤ 2 → three
      // sets "too easy" → bump blocked → identical sub-prev-total plan.
      const p = plan([2, 3, 3, 3], 1);
      const heldBelowPrev =
        p.weightKg === TOP_KG && p.sessionRepTotalTarget < p.prevSessionRepTotal + 1;
      expect(heldBelowPrev).toBe(false);
    }
  );
});
