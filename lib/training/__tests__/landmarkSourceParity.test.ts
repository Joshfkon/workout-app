/**
 * Landmark-source ARITHMETIC parity (enforcement-hole fix).
 *
 * The symbol-list import guard only catches parallel landmark sources you
 * already know the names of — which is exactly how the retired
 * ENHANCED_SCALING table (rollover landmarks at MEV ×1.10) slipped past 3b.
 * This suite inverts the enforcement: it asserts the VALUES every landmark
 * consumer uses agree with the single derivation in services/volumeBands,
 * for every (muscle, experience, profile) combination — so a future parallel
 * table fails on arithmetic, whatever it is called.
 */

import { resolveVolumeLandmarks } from '../weeklyRollover';
import {
  applyRecoveryProfileToLandmarks,
  getEffectiveBand,
  COARSE_MUSCLES,
} from '@/services/volumeBands';
import { DEFAULT_VOLUME_LANDMARKS, STANDARD_MUSCLE_GROUPS } from '@/types/schema';
import type { Experience } from '@/types/schema';

const EXPERIENCES: Experience[] = ['novice', 'intermediate', 'advanced'];

describe('rollover landmarks agree with the single profile derivation', () => {
  it.each(EXPERIENCES.map((e): [Experience] => [e]))(
    '%s: enhanced landmarks = applyRecoveryProfileToLandmarks(base) for every standard muscle',
    (experience) => {
      const standard = resolveVolumeLandmarks(experience, null, false);
      const enhanced = resolveVolumeLandmarks(experience, null, true);
      for (const muscle of STANDARD_MUSCLE_GROUPS) {
        expect(enhanced[muscle]).toEqual(
          applyRecoveryProfileToLandmarks(standard[muscle], muscle, {
            recoveryProfile: 'enhanced',
          })
        );
        // The invariant the retired table violated: enhanced NEVER raises MEV.
        expect(enhanced[muscle].mev).toBe(standard[muscle].mev);
        // And the ceiling never shrinks.
        expect(enhanced[muscle].mrv).toBeGreaterThanOrEqual(standard[muscle].mrv);
      }
    }
  );

  it('custom-landmark overlays scale through the same derivation', () => {
    const custom = { quads: { mev: 9, mav: 15, mrv: 21 } };
    const enhanced = resolveVolumeLandmarks('intermediate', custom, true);
    expect(enhanced.quads).toEqual(
      applyRecoveryProfileToLandmarks(custom.quads, 'quads', { recoveryProfile: 'enhanced' })
    );
  });
});

describe('the derivation is arithmetically tied to getEffectiveBand', () => {
  it('scaling the standard band through the landmark derivation reproduces the enhanced band, every coarse muscle', () => {
    for (const muscle of COARSE_MUSCLES) {
      const standardBand = getEffectiveBand(muscle, { recoveryProfile: 'standard' });
      const enhancedBand = getEffectiveBand(muscle, { recoveryProfile: 'enhanced' });
      const viaLandmarks = applyRecoveryProfileToLandmarks(
        { mev: standardBand.mev, mav: standardBand.mev, mrv: standardBand.mrv },
        muscle,
        { recoveryProfile: 'enhanced' }
      );
      // Same multiplier table, same rounding — a second table breaks this.
      expect(viaLandmarks.mrv).toBe(enhancedBand.mrv);
      expect(viaLandmarks.mev).toBe(enhancedBand.mev);
    }
  });

  it('per-standard-muscle scaling matches the fine effective bands too', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const standardBand = getEffectiveBand(muscle, { recoveryProfile: 'standard' });
      const enhancedBand = getEffectiveBand(muscle, { recoveryProfile: 'enhanced' });
      const viaLandmarks = applyRecoveryProfileToLandmarks(
        { mev: standardBand.mev, mav: standardBand.mev, mrv: standardBand.mrv },
        muscle,
        { recoveryProfile: 'enhanced' }
      );
      expect(viaLandmarks.mrv).toBe(enhancedBand.mrv);
      expect(viaLandmarks.mev).toBe(enhancedBand.mev);
    }
  });
});

describe('base landmark tables stay self-consistent', () => {
  it('DEFAULT_VOLUME_LANDMARKS: mev ≤ mav ≤ mrv everywhere', () => {
    for (const experience of EXPERIENCES) {
      for (const muscle of STANDARD_MUSCLE_GROUPS) {
        const lm = DEFAULT_VOLUME_LANDMARKS[experience][muscle];
        expect(lm.mev).toBeLessThanOrEqual(lm.mav);
        expect(lm.mav).toBeLessThanOrEqual(lm.mrv);
      }
    }
  });
});
