import {
  createInitialVolumeProfile,
  getAdjustedBaseline,
  setEnhancedStatus,
  compareProfileToResearch,
  BASELINE_VOLUME_RECOMMENDATIONS,
} from '@/src/lib/training/adaptive-volume';
import { MUSCLE_GROUPS } from '@/types/schema';
import { ENHANCED_MRV_MULTIPLIERS, ENHANCED_MAV_MULTIPLIER, type CoarseMuscle } from '@/services/volumeBands';

describe('setEnhancedStatus', () => {
  it('applies differentiated per-landmark scaling when enabling enhanced mode', () => {
    const profile = createInitialVolumeProfile('user-1', 'intermediate', false);
    const updated = setEnhancedStatus(profile, true);

    expect(updated.isEnhanced).toBe(true);
    for (const muscle of MUSCLE_GROUPS) {
      const before = profile.muscleTolerance[muscle];
      const after = updated.muscleTolerance[muscle];
      // The ceiling rises far more than the floor — no flat 40% anywhere.
      // MEV invariant: enhanced never raises (or changes) a floor.
      expect(after.estimatedMEV).toBe(before.estimatedMEV);
      expect(after.estimatedMRV).toBe(Math.round(before.estimatedMRV * (ENHANCED_MRV_MULTIPLIERS[muscle as CoarseMuscle] ?? 1)));
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

    // Under tiered MRV scaling the conservative axial tier (x1.15) leaves
    // hamstrings' midpoint shift at exactly the +10% tolerance boundary, so
    // it classifies 'average'; every other muscle clears the threshold.
    const higherMuscles = comparison.higher.map((e) => e.muscle);
    expect(higherMuscles).toEqual(
      MUSCLE_GROUPS.filter((m) => m !== 'hamstrings')
    );
    const hamstrings = comparison.entries.find((e) => e.muscle === 'hamstrings');
    expect(hamstrings?.status).toBe('average');
    expect(hamstrings?.percentDiff).toBe(10);
    // The enhanced reason still surfaces everywhere the profile diverges.
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

    expect(enhanced.mev).toBe(natural.mev); // MEV invariant
    expect(enhanced.mrv).toBe(Math.round(natural.mrv * ENHANCED_MRV_MULTIPLIERS.chest));
    expect(enhanced.optimal).toBe(Math.round(natural.optimal * ENHANCED_MAV_MULTIPLIER));
  });

  it('raises the ceiling proportionally more than the floor', () => {
    const natural = getAdjustedBaseline('back', 'advanced', false);
    const enhanced = getAdjustedBaseline('back', 'advanced', true);

    const mevRatio = enhanced.mev / natural.mev;
    const mrvRatio = enhanced.mrv / natural.mrv;
    expect(mrvRatio).toBeGreaterThan(mevRatio);
  });
});

// ============================================
// SUBJECTIVE SIGNALS (pump / workload / soreness chips)
// ============================================

import {
  aggregateSubjectiveSignals,
  analyzeMesocycle,
  determineVolumeVerdict,
  subjectiveVerdictNudges,
  SUBJECTIVE_SIGNAL_MAX_SCORE,
  type MuscleVolumeData,
  type SubjectiveVolumeSignals,
} from '@/src/lib/training/adaptive-volume';

const signals = (
  overrides: Partial<SubjectiveVolumeSignals> = {}
): SubjectiveVolumeSignals => ({
  ratedSessions: 4,
  lowPumpSessions: 0,
  easyWorkloadSessions: 0,
  tooMuchWorkloadSessions: 0,
  stillSoreSessions: 0,
  ...overrides,
});

describe('subjectiveVerdictNudges', () => {
  it('returns zero for missing or empty signals', () => {
    expect(subjectiveVerdictNudges(undefined)).toEqual({ tooHighScore: 0, tooLowScore: 0 });
    expect(subjectiveVerdictNudges(signals({ ratedSessions: 0 }))).toEqual({
      tooHighScore: 0,
      tooLowScore: 0,
    });
  });

  it('repeated "too much" workload / still-sore pattern nudges too_high', () => {
    expect(subjectiveVerdictNudges(signals({ tooMuchWorkloadSessions: 2 })).tooHighScore).toBe(20);
    expect(subjectiveVerdictNudges(signals({ stillSoreSessions: 2 })).tooHighScore).toBe(20);
    expect(
      subjectiveVerdictNudges(signals({ tooMuchWorkloadSessions: 1, stillSoreSessions: 1 }))
        .tooHighScore
    ).toBe(20);
    // A single event is a weaker nudge.
    expect(subjectiveVerdictNudges(signals({ tooMuchWorkloadSessions: 1 })).tooHighScore).toBe(10);
  });

  it('chronic low pump + easy workload nudges too_low; either alone does not max it', () => {
    const both = subjectiveVerdictNudges(
      signals({ lowPumpSessions: 3, easyWorkloadSessions: 3 })
    );
    expect(both.tooLowScore).toBe(20);

    const pumpOnly = subjectiveVerdictNudges(signals({ lowPumpSessions: 3 }));
    expect(pumpOnly.tooLowScore).toBe(0);

    const easyOnly = subjectiveVerdictNudges(signals({ easyWorkloadSessions: 3 }));
    expect(easyOnly.tooLowScore).toBe(0);
  });

  it('never exceeds the cap in either direction', () => {
    const extreme = subjectiveVerdictNudges(
      signals({
        ratedSessions: 20,
        lowPumpSessions: 20,
        easyWorkloadSessions: 20,
        tooMuchWorkloadSessions: 20,
        stillSoreSessions: 20,
      })
    );
    expect(extreme.tooHighScore).toBeLessThanOrEqual(SUBJECTIVE_SIGNAL_MAX_SCORE);
    expect(extreme.tooLowScore).toBeLessThanOrEqual(SUBJECTIVE_SIGNAL_MAX_SCORE);
  });
});

describe('determineVolumeVerdict with subjective signals', () => {
  const neutralProgression = {
    status: 'analyzed' as const,
    avgProgressionRate: 0,
    progressionTrend: 'maintaining' as const,
    totalRirDrift: 0.5,
    avgFormDegradation: 0.1,
    weekCount: 4,
  };
  const neutralRirDrift = { drift: 0.5, significance: 'normal' as const };
  const neutralFormTrend = { avgDegradation: 0.1, trend: 'stable' as const };
  const tolerance = {
    estimatedMRV: 18,
    estimatedMEV: 8,
    confidence: 'medium' as const,
    dataPoints: 2,
    lastUpdated: new Date('2026-07-01'),
  };

  it('subjective evidence tips a borderline case over the too_high threshold', () => {
    // Elevated RIR drift (15) + form wobble (10) + over MRV (15) = 40 < 50.
    const borderline = {
      rirDrift: { drift: 1.0, significance: 'elevated' as const },
      formTrend: { avgDegradation: 0.2, trend: 'degrading' as const },
      sets: tolerance.estimatedMRV + 2,
    };

    const without = determineVolumeVerdict(
      neutralProgression,
      borderline.rirDrift,
      borderline.formTrend,
      borderline.sets,
      tolerance
    );
    expect(without.verdict).toBe('optimal');

    const withSignals = determineVolumeVerdict(
      neutralProgression,
      borderline.rirDrift,
      borderline.formTrend,
      borderline.sets,
      tolerance,
      signals({ tooMuchWorkloadSessions: 2 })
    );
    expect(withSignals.verdict).toBe('too_high');
  });

  it('subjective evidence ALONE cannot flip a verdict (capped below the 50 threshold)', () => {
    const result = determineVolumeVerdict(
      neutralProgression,
      neutralRirDrift,
      neutralFormTrend,
      12,
      tolerance,
      signals({
        tooMuchWorkloadSessions: 5,
        stillSoreSessions: 5,
        lowPumpSessions: 5,
        easyWorkloadSessions: 5,
      })
    );
    expect(result.verdict).toBe('optimal');
  });
});

describe('aggregateSubjectiveSignals', () => {
  it('counts per-session ratings per muscle with the documented thresholds', () => {
    const rows = [
      { sessionId: 's1', muscle: 'chest' as const, pump: 1, workload: 0, sorenessBefore: null },
      { sessionId: 's2', muscle: 'chest' as const, pump: 0, workload: 0, sorenessBefore: 3 },
      { sessionId: 's3', muscle: 'chest' as const, pump: 3, workload: 3, sorenessBefore: 2 },
      { sessionId: 's1', muscle: 'quads' as const, pump: null, workload: null, sorenessBefore: null }, // unrated
    ];
    const result = aggregateSubjectiveSignals(rows);

    expect(result.chest).toEqual({
      ratedSessions: 3,
      lowPumpSessions: 2, // pump <= 1
      easyWorkloadSessions: 2, // workload === 0
      tooMuchWorkloadSessions: 1, // workload === 3
      stillSoreSessions: 1, // soreness === 3
    });
    expect(result.quads).toBeUndefined();
  });

  it('merges coarse-collapsed subdivision rows into ONE rated session', () => {
    // chest_upper + chest_lower from the SAME workout both collapse to
    // 'chest' — one session, not two. Without the merge, a single workout
    // with both subdivisions marked "too much" would hit the repeated-event
    // threshold (>=2 overreach events → +20) on its own.
    const rows = [
      { sessionId: 's1', muscle: 'chest' as const, pump: 1, workload: 3, sorenessBefore: null },
      { sessionId: 's1', muscle: 'chest' as const, pump: 2, workload: 3, sorenessBefore: null },
    ];
    const result = aggregateSubjectiveSignals(rows);

    expect(result.chest).toEqual({
      ratedSessions: 1,
      lowPumpSessions: 0, // pump merges best-case: max(1, 2) = 2
      easyWorkloadSessions: 0,
      tooMuchWorkloadSessions: 1, // one session, however many subdivision rows
      stillSoreSessions: 0,
    });

    // The dedup is what keeps a single workout at the weak nudge (+10);
    // the same answers across two sessions reach the repeated-pattern +20.
    expect(subjectiveVerdictNudges(result.chest).tooHighScore).toBe(10);
    const twoSessions = aggregateSubjectiveSignals([
      ...rows,
      { sessionId: 's2', muscle: 'chest' as const, pump: 2, workload: 3, sorenessBefore: null },
    ]);
    expect(subjectiveVerdictNudges(twoSessions.chest).tooHighScore).toBe(20);
  });
});

describe('analyzeMesocycle threads subjective signals into the verdict (existing update path)', () => {
  const weekData = (muscle: 'chest', week: number, sets: number): MuscleVolumeData => ({
    id: `${muscle}-${week}`,
    muscle,
    weekNumber: week,
    mesocycleId: 'meso-1',
    totalSets: sets,
    workingSets: sets,
    effectiveSets: sets,
    totalVolume: 0,
    averageRIR: 2 - week * 0.3, // mild drift
    averageFormScore: 0.8 - week * 0.05,
    exercisePerformance: [],
  });

  it('the same volume data produces a harsher verdict when overreach chips are present', () => {
    const profile = createInitialVolumeProfile('user-1', 'intermediate', false);
    const mrv = profile.muscleTolerance.chest.estimatedMRV;
    const muscleData = {
      chest: [1, 2, 3, 4].map((week) => weekData('chest', week, mrv + 2)),
    } as unknown as Parameters<typeof analyzeMesocycle>[1];

    const withoutChips = analyzeMesocycle(
      'meso-1',
      muscleData,
      profile,
      '2026-06-01',
      '2026-06-28'
    );
    const withChips = analyzeMesocycle(
      'meso-1',
      muscleData,
      profile,
      '2026-06-01',
      '2026-06-28',
      { chest: signals({ tooMuchWorkloadSessions: 3, stillSoreSessions: 2 }) }
    );

    const before = withoutChips.muscleOutcomes.chest;
    const after = withChips.muscleOutcomes.chest;
    // Chips can only push toward too_high — the suggested adjustment never
    // rises, and the verdict never flips toward too_low.
    expect(after.suggestedAdjustment).toBeLessThanOrEqual(before.suggestedAdjustment);
    expect(after.volumeVerdict).not.toBe('too_low');
  });
});
