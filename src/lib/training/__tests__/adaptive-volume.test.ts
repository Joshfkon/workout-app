import {
  createInitialVolumeProfile,
  getAdjustedBaseline,
  setEnhancedStatus,
  BASELINE_VOLUME_RECOMMENDATIONS,
} from '@/src/lib/training/adaptive-volume';
import { MUSCLE_GROUPS } from '@/types/schema';

describe('setEnhancedStatus', () => {
  it('scales MEV/MRV up by 1.4x when enabling enhanced mode', () => {
    const profile = createInitialVolumeProfile('user-1', 'intermediate', false);
    const updated = setEnhancedStatus(profile, true);

    expect(updated.isEnhanced).toBe(true);
    for (const muscle of MUSCLE_GROUPS) {
      const before = profile.muscleTolerance[muscle];
      const after = updated.muscleTolerance[muscle];
      expect(after.estimatedMEV).toBe(Math.round(before.estimatedMEV * 1.4));
      expect(after.estimatedMRV).toBe(Math.round(before.estimatedMRV * 1.4));
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
    // 1.4x then /1.4 round-trips to within rounding error of the natural baseline
    expect(updated.muscleTolerance.chest.estimatedMRV).toBeCloseTo(baseline.mrv, 0);
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
