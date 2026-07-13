import {
  createInitialVolumeProfile,
  getAdjustedBaseline,
  setEnhancedStatus,
  compareProfileToResearch,
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

describe('compareProfileToResearch', () => {
  it('classifies a fresh intermediate natural profile as all at-average', () => {
    const profile = createInitialVolumeProfile('user-1', 'intermediate', false);
    const comparison = compareProfileToResearch(profile);

    expect(comparison.entries).toHaveLength(MUSCLE_GROUPS.length);
    expect(comparison.average).toHaveLength(MUSCLE_GROUPS.length);
    expect(comparison.lower).toHaveLength(0);
    expect(comparison.higher).toHaveLength(0);
  });

  it('bucket lists partition the entries exactly', () => {
    const profile = createInitialVolumeProfile('user-1', 'novice', true);
    const comparison = compareProfileToResearch(profile);

    expect(
      comparison.lower.length + comparison.average.length + comparison.higher.length
    ).toBe(comparison.entries.length);
  });

  it('classifies a novice profile as lower than research averages', () => {
    const profile = createInitialVolumeProfile('user-1', 'novice', false);
    const comparison = compareProfileToResearch(profile);

    expect(comparison.lower).toHaveLength(MUSCLE_GROUPS.length);
    for (const entry of comparison.entries) {
      expect(entry.percentDiff).toBeLessThan(0);
      expect(entry.reasons.join(' ')).toMatch(/novice/i);
    }
  });

  it('classifies an enhanced intermediate profile as higher than research averages', () => {
    const profile = createInitialVolumeProfile('user-1', 'intermediate', true);
    const comparison = compareProfileToResearch(profile);

    expect(comparison.higher).toHaveLength(MUSCLE_GROUPS.length);
    for (const entry of comparison.entries) {
      expect(entry.reasons.join(' ')).toMatch(/enhanced/i);
    }
  });

  it('surfaces learned per-muscle deviations with a learned-data reason', () => {
    const profile = createInitialVolumeProfile('user-1', 'intermediate', false);
    profile.muscleTolerance.chest.estimatedMRV = Math.round(
      BASELINE_VOLUME_RECOMMENDATIONS.chest.mrv * 1.4
    );
    profile.muscleTolerance.chest.dataPoints = 3;
    profile.muscleTolerance.chest.confidence = 'medium';

    const comparison = compareProfileToResearch(profile);
    const chest = comparison.entries.find((e) => e.muscle === 'chest')!;

    expect(chest.status).toBe('higher');
    expect(chest.percentDiff).toBeGreaterThan(0);
    expect(chest.reasons[0]).toMatch(/learned from 3 mesocycles/i);
    expect(chest.reasons[0]).toMatch(/medium confidence/i);
    // Other muscles stay at research defaults with the default reason.
    const back = comparison.entries.find((e) => e.muscle === 'back')!;
    expect(back.status).toBe('average');
    expect(back.reasons.join(' ')).toMatch(/research default/i);
  });

  it('reports both bands so the UI can show "you vs research"', () => {
    const profile = createInitialVolumeProfile('user-1', 'advanced', false);
    const comparison = compareProfileToResearch(profile);
    const chest = comparison.entries.find((e) => e.muscle === 'chest')!;

    expect(chest.researchMev).toBe(BASELINE_VOLUME_RECOMMENDATIONS.chest.mev);
    expect(chest.researchMrv).toBe(BASELINE_VOLUME_RECOMMENDATIONS.chest.mrv);
    expect(chest.personalMev).toBe(profile.muscleTolerance.chest.estimatedMEV);
    expect(chest.personalMrv).toBe(profile.muscleTolerance.chest.estimatedMRV);
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
