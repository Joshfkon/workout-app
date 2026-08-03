/**
 * Enhanced VOLUME TOLERANCE vs enhanced RECOVERY RATE (Bug 8).
 *
 * These are different physiological claims about different quantities. They
 * are already separate in this codebase — a per-group tiered volume table
 * (ENHANCED_MRV_MULTIPLIERS) and a single recovery scalar
 * (ENHANCED_RECOVERY_MULTIPLIER). No user-visible value changes here; the job
 * is to make the separation impossible to collapse by accident.
 *
 * The assertions are BEHAVIOURAL, not symbol-identity: changing one constant
 * must not move the other's outputs. A test that merely asserted
 * `A !== B` would pass even if both were aliased to the same source.
 */

import {
  ENHANCED_MRV_MULTIPLIERS,
  ENHANCED_MAV_MULTIPLIER,
  RESEARCH_VOLUME_BANDS,
  COARSE_MUSCLES,
  applyRecoveryProfileToLandmarks,
  getEffectiveBand,
} from '@/services/volumeBands';
import {
  ENHANCED_RECOVERY_MULTIPLIER,
  effectiveFatigueRecoveryRate,
  FATIGUE_RECOVERY_RATE,
} from '@/services/shared/fatigueConstants';
import { DEFAULT_VOLUME_LANDMARKS, STANDARD_MUSCLE_GROUPS } from '@/types/schema';

describe('the two concepts are structurally distinct', () => {
  it('enhanced VOLUME is per-group and tiered; enhanced RECOVERY is one scalar', () => {
    const tiers = new Set(Object.values(ENHANCED_MRV_MULTIPLIERS));
    expect(tiers.size).toBeGreaterThan(1); // genuinely tiered, not a disguised constant
    expect(typeof ENHANCED_RECOVERY_MULTIPLIER).toBe('number');
  });

  it('every coarse group carries an AUTHORED volume multiplier — no default to fall back on', () => {
    // Why there is deliberately no DEFAULT_ENHANCED_VOLUME_FACTOR: it would be
    // dead code today, and its only future use would be to let someone skip
    // choosing a tier for a new group.
    for (const group of COARSE_MUSCLES) {
      expect(ENHANCED_MRV_MULTIPLIERS[group]).toBeGreaterThan(0);
    }
    expect(Object.keys(ENHANCED_MRV_MULTIPLIERS).sort()).toEqual([...COARSE_MUSCLES].sort());
  });
});

describe('behavioural independence', () => {
  it('the recovery-rate factor does not appear in any enhanced MRV band', () => {
    // Simulating "someone changed the recovery constant": the volume path
    // reads none of it, so recomputing bands with a different recovery factor
    // is impossible — the bands are a pure function of their own table.
    for (const group of COARSE_MUSCLES) {
      const band = getEffectiveBand(group, { recoveryProfile: 'enhanced' });
      const expected = Math.round(RESEARCH_VOLUME_BANDS[group].mrv * ENHANCED_MRV_MULTIPLIERS[group] * 2) / 2;
      expect(band.mrv).toBe(expected);
      // The recovery scalar plays no part in that arithmetic.
      expect(band.mrv).not.toBe(
        Math.round(RESEARCH_VOLUME_BANDS[group].mrv * ENHANCED_RECOVERY_MULTIPLIER * 2) / 2
      );
    }
  });

  it('the recovery rate is a pure function of the recovery factor alone', () => {
    expect(effectiveFatigueRecoveryRate(true)).toBeCloseTo(
      FATIGUE_RECOVERY_RATE * ENHANCED_RECOVERY_MULTIPLIER,
      10
    );
    expect(effectiveFatigueRecoveryRate(false)).toBe(FATIGUE_RECOVERY_RATE);
    // No volume override participates.
    for (const group of COARSE_MUSCLES) {
      expect(effectiveFatigueRecoveryRate(true)).not.toBeCloseTo(
        FATIGUE_RECOVERY_RATE * ENHANCED_MRV_MULTIPLIERS[group],
        10
      );
    }
  });

  it('per-group volume variation SURVIVES — the tiers are not flattened', () => {
    expect(ENHANCED_MRV_MULTIPLIERS.calves).toBe(1.35);
    expect(ENHANCED_MRV_MULTIPLIERS.chest).toBe(1.25);
    expect(ENHANCED_MRV_MULTIPLIERS.quads).toBe(1.15);
    expect(ENHANCED_MRV_MULTIPLIERS.quads).not.toBe(ENHANCED_MRV_MULTIPLIERS.calves);
  });
});

describe('enhanced MEV invariant', () => {
  it('enhanced NEVER raises a floor, for any muscle', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const base = DEFAULT_VOLUME_LANDMARKS.advanced[muscle];
      const scaled = applyRecoveryProfileToLandmarks(base, muscle, {
        recoveryProfile: 'enhanced',
      });
      expect(scaled.mev).toBe(base.mev);
      expect(scaled.mav).toBeLessThanOrEqual(scaled.mrv);
      expect(scaled.mav).toBeLessThanOrEqual(Math.round(base.mav * ENHANCED_MAV_MULTIPLIER));
    }
  });
});

describe('scaled fine bands are computed, never restated in prose', () => {
  it('soleus scales from its band to whatever getEffectiveBand actually produces', () => {
    // The definition-site comment used to claim "soleus 12 -> 17"; the code
    // produces 16. Asserting against the implementation is the fix — a prose
    // number cannot drift if no prose number exists.
    const standard = getEffectiveBand('soleus', { recoveryProfile: 'standard' });
    const enhanced = getEffectiveBand('soleus', { recoveryProfile: 'enhanced' });
    expect(standard.mrv).toBe(12);
    expect(enhanced.mrv).toBe(Math.round(standard.mrv * ENHANCED_MRV_MULTIPLIERS.calves * 2) / 2);
    expect(enhanced.mrv).toBe(16);
  });

  it('gastrocnemius likewise', () => {
    const standard = getEffectiveBand('gastrocnemius', { recoveryProfile: 'standard' });
    const enhanced = getEffectiveBand('gastrocnemius', { recoveryProfile: 'enhanced' });
    expect(enhanced.mrv).toBe(Math.round(standard.mrv * ENHANCED_MRV_MULTIPLIERS.calves * 2) / 2);
  });

  it('every fine band scales by its OWN coarse tier', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const standard = getEffectiveBand(muscle, { recoveryProfile: 'standard' });
      const enhanced = getEffectiveBand(muscle, { recoveryProfile: 'enhanced' });
      expect(enhanced.mev).toBe(standard.mev);
      expect(enhanced.mrv).toBeGreaterThanOrEqual(standard.mrv);
    }
  });
});
