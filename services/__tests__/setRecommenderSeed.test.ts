/**
 * Tests for the role-aware session-start prescription + override hook added to
 * services/setRecommender.ts (Phases 2–4).
 *
 * The centrepiece is the real-world failure case from the task:
 *   ISO-Lateral Low Row, prev session 90×13@4, 140×14@2.5, 160×8@2.5, 160×11@1,
 *   stored e1RM 252.5, target 8–12 @ 2 RIR. The engine suggested
 *   "92.5 × 13 @ 2 RIR — clearly too light". That must be impossible.
 *
 * Numbers below are in lb-equivalent units (the engine is unit-agnostic; feed a
 * matching increment). 92.5×13@2RIR is the exact wrong output we assert against.
 */

import {
  recommendSeedForSlot,
  recommendSet,
  deviatesFromSuggestion,
  recalibrateSessionE1RM,
  type SeedSlotInput,
} from '../setRecommender';

const TOP_WORKING = 160; // best recent working weight last session
const E1RM = 252.5;
const RANGE: [number, number] = [8, 12];

const seed = (over: Partial<SeedSlotInput> = {}): SeedSlotInput => ({
  role: 'working',
  targetRepRange: RANGE,
  targetRir: 2,
  minIncrementKg: 2.5,
  anchorE1RMKg: E1RM,
  recentWorkingWeightKg: TOP_WORKING,
  prevWeightKg: 90,
  prevReps: 13,
  prevRir: 4,
  ...over,
});

describe('recommendSeedForSlot — failure case (ISO-Lateral Low Row set 1)', () => {
  it('the wrong output (92.5 × 13 @ 2 RIR "too light") is impossible for a working slot', () => {
    const r = recommendSeedForSlot(seed({ role: 'working' }));
    // Weight lands in the e1RM-implied working band ~170–190, NOT the low 90s.
    expect(r.weightKg).toBeGreaterThanOrEqual(170);
    expect(r.weightKg).toBeLessThanOrEqual(190);
    expect(r.weightKg).not.toBeCloseTo(92.5, 0);
    // A RANGE is prescribed, never a copied rep count like 13.
    expect(r.repRange).toEqual(RANGE);
    expect(r).not.toHaveProperty('reps');
  });

  it('working slot anchors on the e1RM that was previously displayed-but-ignored', () => {
    const r = recommendSeedForSlot(seed({ role: 'working' }));
    expect(r.anchorSource).toBe('e1rm');
    expect(r.showRirTarget).toBe(true);
    expect(r.rir).toBe(2);
    // A hot e1RM vs a 160 recent working weight would imply >10% jump → clamped.
    expect(r.clamped).toBe(true);
    expect(r.weightKg).toBeLessThanOrEqual(TOP_WORKING * 1.1);
  });

  it('inferred ramp slot (the actual set-1 role) prescribes ~55–60% of top with NO RIR claim', () => {
    // Set 1's previous-session slot is the 90-lb feeder → inferred ramp upstream.
    const r = recommendSeedForSlot(seed({ role: 'ramp' }));
    expect(r.role).toBe('ramp');
    expect(r.showRirTarget).toBe(false); // no "@ 2 RIR", no "too light" nagging
    expect(r.anchorSource).toBe('ramp_percent');

    // Basis is the working prescription (~175); ramp is 55–60% of that.
    const workingRec = recommendSeedForSlot(seed({ role: 'working' }));
    expect(r.weightKg).toBeGreaterThanOrEqual(workingRec.weightKg * 0.55 - 2.5);
    expect(r.weightKg).toBeLessThanOrEqual(workingRec.weightKg * 0.6 + 2.5);
    // And nowhere near a working-set prescription.
    expect(r.weightKg).toBeLessThan(workingRec.weightKg);
  });

  it('stamps the engine version on the record for auditability', () => {
    expect(recommendSeedForSlot(seed()).engineVersion).toBeGreaterThanOrEqual(2);
  });
});

describe('recommendSeedForSlot — anchors & clamps', () => {
  it('falls back to last-session anchor when no e1RM is available', () => {
    const r = recommendSeedForSlot(seed({ anchorE1RMKg: 0 }));
    expect(r.anchorSource).toBe('last_session');
    expect(r.repRange).toEqual(RANGE);
    // 13 reps clears the 8–12 top with 2 RIR spare (4 vs 2 target); 13 is not
    // past the +2 rep-overshoot line, so the named rule is top_range_reserve.
    expect(r.trigger).toBe('top_range_reserve');
  });

  it('reports trigger "none" when the seed just repeats last session', () => {
    const r = recommendSeedForSlot(
      seed({ anchorE1RMKg: 0, prevWeightKg: 160, prevReps: 10, prevRir: 2 })
    );
    expect(r.anchorSource).toBe('last_session');
    expect(r.trigger).toBe('none');
  });

  it('e1RM and ramp anchors always carry trigger "none" (no adjustment vs a reference set)', () => {
    expect(recommendSeedForSlot(seed({ role: 'working' })).trigger).toBe('none');
    expect(recommendSeedForSlot(seed({ role: 'ramp' })).trigger).toBe('none');
  });

  it('does not clamp when the e1RM prescription is within ±10% of recent working weight', () => {
    // recent working weight aligned with the e1RM implication → no clamp.
    const r = recommendSeedForSlot(seed({ recentWorkingWeightKg: 180 }));
    expect(r.clamped).toBe(false);
    expect(r.weightKg).toBeGreaterThanOrEqual(170);
    expect(r.weightKg).toBeLessThanOrEqual(190);
  });

  it('reports "none" when there is nothing to anchor on', () => {
    const r = recommendSeedForSlot(
      seed({ anchorE1RMKg: 0, prevWeightKg: 0, prevReps: 0 })
    );
    expect(r.anchorSource).toBe('none');
    expect(r.weightKg).toBe(0);
  });
});

describe('deviatesFromSuggestion (override detection, Phase 4)', () => {
  it('flags the failure-case override: 180 logged vs ~92.5 suggested', () => {
    expect(deviatesFromSuggestion(180, 92.5)).toBe(true); // ~95% over → override
  });

  it('does not flag a within-tolerance deviation', () => {
    expect(deviatesFromSuggestion(176, 175)).toBe(false);
    expect(deviatesFromSuggestion(190, 175)).toBe(false); // ~8.6% < 20%
  });

  it('is safe for degenerate inputs', () => {
    expect(deviatesFromSuggestion(0, 100)).toBe(false);
    expect(deviatesFromSuggestion(100, 0)).toBe(false);
  });
});

describe('override re-anchors subsequent sets (Phase 4)', () => {
  it('a heavy near-failure logged set becomes the anchor for the next set, not the stale ~92.5', () => {
    // User ignored the 92.5 ramp suggestion and logged 180×9 @ 1 RIR.
    // The within-session recommender anchors on that set (+ session-best e1RM),
    // so the next suggestion is heavy, not a re-run of 92.5.
    const next = recommendSet({
      lastWeightKg: 180,
      lastReps: 9,
      lastRir: 1,
      setsCompletedThisExercise: 1,
      sessionBestE1RMKg: recalibrateSessionE1RM([{ weightKg: 180, reps: 9, rir: 1 }]),
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
    });
    expect(next.weightKg).toBeGreaterThanOrEqual(170); // anchored to the logged set
    expect(next.weightKg).not.toBeCloseTo(92.5, 0);
  });
});

describe('recalibrateSessionE1RM — fresh-set weighting hook (Phase 4)', () => {
  it('credits a late fatigued grinder more than the same set done fresh', () => {
    const set = { weightKg: 160, reps: 11, rir: 1 };
    const fresh = recalibrateSessionE1RM([set]); // position 0, no correction
    const late = recalibrateSessionE1RM([
      { weightKg: 100, reps: 5, rir: 3 },
      { weightKg: 120, reps: 5, rir: 3 },
      { weightKg: 140, reps: 5, rir: 3 },
      set, // position 3 → fatigue-corrected upward
    ]);
    expect(late).toBeGreaterThan(fresh);
  });

  it('a fresh set-1 near-failure effort is trusted at face value (no discount)', () => {
    // Position 0 → correction 0 → equals the raw Epley estimate.
    const e = recalibrateSessionE1RM([{ weightKg: 180, reps: 9, rir: 1 }]);
    const rawEpley = 180 * (1 + (9 + 1) / 30); // 240
    expect(e).toBeCloseTo(Math.round(rawEpley * 10) / 10, 1);
  });

  it('caps the freshness correction so deep sets cannot over-inflate', () => {
    const many = Array.from({ length: 20 }, () => ({ weightKg: 100, reps: 5, rir: 2 }));
    const capped = recalibrateSessionE1RM(many);
    const raw = 100 * (1 + (5 + 2) / 30);
    // Correction is capped at 8% regardless of depth.
    expect(capped).toBeLessThanOrEqual(raw * 1.08 + 0.1);
  });
});
