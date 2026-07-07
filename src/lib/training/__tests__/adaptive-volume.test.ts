import {
  createInitialVolumeProfile,
  getAdjustedBaseline,
  setEnhancedStatus,
  BASELINE_VOLUME_RECOMMENDATIONS,
} from '@/src/lib/training/adaptive-volume';
import { MUSCLE_GROUPS, ENHANCED_SCALING } from '@/types/schema';

describe('setEnhancedStatus', () => {
  it('applies differentiated per-landmark scaling when enabling enhanced mode', () => {
    const profile = createInitialVolumeProfile('user-1', 'intermediate', false);
    const updated = setEnhancedStatus(profile, true);

    expect(updated.isEnhanced).toBe(true);
    for (const muscle of MUSCLE_GROUPS) {
      const before = profile.muscleTolerance[muscle];
      const after = updated.muscleTolerance[muscle];
      // The ceiling rises far more than the floor — no flat 40% anywhere.
      expect(after.estimatedMEV).toBe(Math.round(before.estimatedMEV * ENHANCED_SCALING.mev));
      expect(after.estimatedMRV).toBe(Math.round(before.estimatedMRV * ENHANCED_SCALING.mrv));
    }
  });

  it('produces tolerances matching an enhanced-from-creation profile', () => {
    const natural = createInitialVolumeProfile('user-1', 'intermediate', false);
    const toggled = setEnhancedStatus(natural, true);

    for (const muscle of MUSCLE_GROUPS) {
      const expected = getAdjustedBaseline(muscle, 'intermediate', true);
      expect(toggled.muscleTolerance[muscle].estimatedMRV).toBe(expected.mrv);
      expect(toggled.muscleTolerance[muscle].estimatedMEV).toBe(expected.mev);
    }
  });

  it('scales back down when disabling enhanced mode', () => {
    const enhanced = createInitialVolumeProfile('user-1', 'intermediate', true);
    const updated = setEnhancedStatus(enhanced, false);

    expect(updated.isEnhanced).toBe(false);
    const baseline = BASELINE_VOLUME_RECOMMENDATIONS.chest;
    // scale up then back down round-trips to within rounding error
    expect(updated.muscleTolerance.chest.estimatedMRV).toBeCloseTo(baseline.mrv, 0);
    expect(updated.muscleTolerance.chest.estimatedMEV).toBeCloseTo(baseline.mev, 0);
  });

  it('on -> off -> on converges instead of compounding', () => {
    const natural = createInitialVolumeProfile('user-1', 'intermediate', false);
    const once = setEnhancedStatus(natural, true);
    const cycled = setEnhancedStatus(setEnhancedStatus(once, false), true);

    for (const muscle of MUSCLE_GROUPS) {
      expect(cycled.muscleTolerance[muscle].estimatedMRV).toBeCloseTo(
        once.muscleTolerance[muscle].estimatedMRV,
        0
      );
      expect(cycled.muscleTolerance[muscle].estimatedMEV).toBeCloseTo(
        once.muscleTolerance[muscle].estimatedMEV,
        0
      );
    }
  });

  it('returns the profile unchanged when the status is not changing', () => {
    const profile = createInitialVolumeProfile('user-1', 'intermediate', false);
    expect(setEnhancedStatus(profile, false)).toBe(profile);
  });

  it('preserves learned data points and confidence when rescaling', () => {
    const profile = createInitialVolumeProfile('user-1', 'advanced', false);
    profile.muscleTolerance.chest.dataPoints = 5;
    profile.muscleTolerance.chest.confidence = 'high';

    const updated = setEnhancedStatus(profile, true);
    expect(updated.muscleTolerance.chest.dataPoints).toBe(5);
    expect(updated.muscleTolerance.chest.confidence).toBe('high');
  });
});

describe('getAdjustedBaseline (enhanced scaling)', () => {
  it('scales MEV by the floor multiplier and MRV by the ceiling multiplier', () => {
    const natural = getAdjustedBaseline('chest', 'intermediate', false);
    const enhanced = getAdjustedBaseline('chest', 'intermediate', true);

    expect(enhanced.mev).toBe(Math.round(natural.mev * ENHANCED_SCALING.mev));
    expect(enhanced.mrv).toBe(Math.round(natural.mrv * ENHANCED_SCALING.mrv));
    expect(enhanced.optimal).toBe(Math.round(natural.optimal * ENHANCED_SCALING.mav));
  });

  it('raises the ceiling proportionally more than the floor', () => {
    const natural = getAdjustedBaseline('back', 'advanced', false);
    const enhanced = getAdjustedBaseline('back', 'advanced', true);

    const mevRatio = enhanced.mev / natural.mev;
    const mrvRatio = enhanced.mrv / natural.mrv;
    expect(mrvRatio).toBeGreaterThan(mevRatio);
  });
});
