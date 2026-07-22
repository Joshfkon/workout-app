/**
 * Enhanced Athlete Mode — cross-cutting behavior tests.
 *
 * Covers the acceptance criteria that live in pure services:
 * - differentiated landmark scaling through the central function
 * - proportionally faster weekly set progression (capped at MRV)
 * - enhanced recovery constants in the fatigue model
 * - sandbagging detection using the enhanced constants
 * - mesocycle generator consumption (volume, ramp, accumulation length)
 * - joint-stress caps provably unaffected by the toggle
 */
import { RESEARCH_VOLUME_BANDS } from '../volumeBands';
import {
  ENHANCED_SCALING,
  scaleLandmarksForEnhanced,
  DEFAULT_VOLUME_LANDMARKS,
  type VolumeLandmarks,
} from '@/types/schema';
import type { ExtendedUserProfile, Rating } from '@/types/schema';
import {
  recommendWeeklySetAdjustment,
  ENHANCED_WEEKLY_SET_INCREMENT,
  type WeeklySetAdjustmentInput,
} from '../weeklyProgressionEngine';
import {
  updateMesocycleFatigue,
  calculateFatigueAfterRest,
  calculateReadinessScore,
} from '../fatigueEngine';
import {
  ENHANCED_RECOVERY_MULTIPLIER,
  effectiveFatigueRecoveryRate,
  FATIGUE_RECOVERY_RATE,
} from '../shared/fatigueConstants';
import {
  RPECalibrationEngine,
  getBiasLevel,
  type CalibrationResult,
} from '../rpeCalibration';
import {
  calculateRecoveryFactors,
  calculateVolumeDistribution,
  recommendVolume,
  buildPeriodizationPlan,
  ENHANCED_EXTRA_ACCUMULATION_WEEKS,
} from '../mesocycleBuilder';
import { getFailureSafetyTier, getRIRFloor, isAMRAPEligible } from '../exerciseSafety';
import { prescribeSetType, type SetPrescriptionContext } from '../setPrescription';

function createProfile(overrides: Partial<ExtendedUserProfile> = {}): ExtendedUserProfile {
  return {
    goal: 'bulk',
    experience: 'intermediate',
    heightCm: 175,
    latestDexa: null,
    age: 30,
    sleepQuality: 3 as Rating,
    stressLevel: 3 as Rating,
    trainingAge: 2,
    availableEquipment: [],
    injuryHistory: [],
    ...overrides,
  };
}

// ============================================
// 1. Central landmark scaling
// ============================================

describe('scaleLandmarksForEnhanced', () => {
  const base: VolumeLandmarks = { mev: 8, mav: 14, mrv: 22 };

  it('uses the documented differentiated multipliers', () => {
    expect(ENHANCED_SCALING).toEqual({ mev: 1.1, mav: 1.25, mrv: 1.375 });
  });

  it('scales each landmark by its own multiplier, rounded to whole sets', () => {
    const scaled = scaleLandmarksForEnhanced(base, true);
    expect(scaled).toEqual({
      mev: Math.round(8 * 1.1),   // 9
      mav: Math.round(14 * 1.25), // 18
      mrv: Math.round(22 * 1.375), // 30
    });
  });

  it('returns landmarks unchanged when the mode is off or undefined', () => {
    expect(scaleLandmarksForEnhanced(base, false)).toBe(base);
    expect(scaleLandmarksForEnhanced(base, undefined)).toBe(base);
  });

  it('raises the ceiling far more than the floor (no flat multiplier)', () => {
    const scaled = scaleLandmarksForEnhanced(base, true);
    expect(scaled.mrv / base.mrv).toBeGreaterThan(scaled.mev / base.mev);
    // MRV rises 35-40%, MEV only ~10%
    expect(scaled.mrv / base.mrv).toBeGreaterThanOrEqual(1.35);
    expect(scaled.mev / base.mev).toBeLessThanOrEqual(1.15);
  });
});

// ============================================
// 2. Weekly set progression
// ============================================

describe('weeklyProgressionEngine (enhanced ramp)', () => {
  const landmarks: VolumeLandmarks = { mev: 8, mav: 14, mrv: 22 };
  const greenLight: WeeklySetAdjustmentInput = {
    muscle: 'chest_upper',
    currentWeeklySets: 10,
    landmarks,
    feedback: [{ sorenessBefore: 1, pump: 2, workload: 1 }],
    performanceTrend: 'improving',
    weekInMeso: 2,
    isDeloadWeek: false,
  };

  it('adds one set per green-light week for natural athletes', () => {
    const result = recommendWeeklySetAdjustment(greenLight);
    expect(result.action).toBe('add');
    expect(result.delta).toBe(1);
  });

  it('adds proportionally more sets per week for enhanced athletes', () => {
    const result = recommendWeeklySetAdjustment({ ...greenLight, enhancedAthleteMode: true });
    expect(result.action).toBe('add');
    expect(result.delta).toBe(ENHANCED_WEEKLY_SET_INCREMENT);
  });

  it('never adds past MRV even with the enhanced increment', () => {
    // One set below the ceiling: enhanced increment shrinks to fit.
    const nearCeiling = recommendWeeklySetAdjustment({
      ...greenLight,
      currentWeeklySets: landmarks.mrv - 1,
      feedback: [{ sorenessBefore: 1, pump: 3, workload: 1 }],
      enhancedAthleteMode: true,
    });
    expect(nearCeiling.delta).toBe(1);

    const atCeiling = recommendWeeklySetAdjustment({
      ...greenLight,
      currentWeeklySets: landmarks.mrv,
      enhancedAthleteMode: true,
    });
    expect(atCeiling.action).toBe('hold');
    expect(atCeiling.delta).toBe(0);
  });

  it('remove/hold logic is unchanged in enhanced mode', () => {
    const sore = recommendWeeklySetAdjustment({
      ...greenLight,
      feedback: [{ sorenessBefore: 3, pump: 2, workload: 1 }],
      enhancedAthleteMode: true,
    });
    expect(sore.action).toBe('remove');
    expect(sore.delta).toBe(-1);
  });
});

// ============================================
// 3. Fatigue model recovery constants
// ============================================

describe('fatigue model (enhanced recovery)', () => {
  it('exposes a named enhanced recovery multiplier in the tunable range', () => {
    expect(ENHANCED_RECOVERY_MULTIPLIER).toBeGreaterThanOrEqual(1.2);
    expect(ENHANCED_RECOVERY_MULTIPLIER).toBeLessThanOrEqual(1.25);
    expect(effectiveFatigueRecoveryRate(true)).toBeCloseTo(
      FATIGUE_RECOVERY_RATE * ENHANCED_RECOVERY_MULTIPLIER
    );
    expect(effectiveFatigueRecoveryRate(false)).toBe(FATIGUE_RECOVERY_RATE);
  });

  it('dissipates fatigue faster between sessions when enhanced', () => {
    const natural = calculateFatigueAfterRest(60, 5, false);
    const enhanced = calculateFatigueAfterRest(60, 5, true);
    expect(enhanced).toBeLessThan(natural);
  });

  it('accumulation is NOT reduced — only recovery speeds up', () => {
    // Zero rest days isolates the accumulation term.
    const natural = updateMesocycleFatigue({
      currentFatigue: 50,
      sessionRpe: 8,
      daysSinceLastSession: 0,
    });
    const enhanced = updateMesocycleFatigue({
      currentFatigue: 50,
      sessionRpe: 8,
      daysSinceLastSession: 0,
      enhancedAthleteMode: true,
    });
    expect(enhanced).toBe(natural);
  });

  it('readiness gives full rest credit a day sooner when enhanced', () => {
    const base = {
      sleepHours: 8,
      sleepQuality: 4 as Rating,
      stressLevel: 2 as Rating,
      nutritionRating: 4 as Rating,
      previousSessionRpe: 8,
      daysSinceLastSession: 1,
    };
    const natural = calculateReadinessScore(base);
    const enhanced = calculateReadinessScore({ ...base, enhancedAthleteMode: true });
    expect(enhanced).toBeGreaterThan(natural);
  });
});

// ============================================
// 4. Sandbagging / RPE-calibration detection
// ============================================

describe('sandbagging detection (enhanced constants)', () => {
  function makeCalibration(bias: number): CalibrationResult {
    return {
      exerciseName: 'Machine Chest Press',
      predictedMaxReps: 10,
      actualMaxReps: 10 + bias,
      bias,
      biasInterpretation: '',
      confidenceLevel: 'high',
      lastCalibrated: new Date(),
      dataPoints: 6,
      method: 'fatigue_adjusted_v2',
    };
  }

  it('flags a moderate positive bias as sandbagging for natural athletes', () => {
    const engine = new RPECalibrationEngine([], [makeCalibration(2.2)]);
    expect(engine.analyzeOverallBias().sandbaggingDetected).toBe(true);
  });

  it('does not flag the same bias for enhanced athletes (recovered, not sandbagging)', () => {
    const engine = new RPECalibrationEngine([], [makeCalibration(2.2)], {
      enhancedAthleteMode: true,
    });
    expect(engine.analyzeOverallBias().sandbaggingDetected).toBe(false);
  });

  it('still flags large biases for enhanced athletes', () => {
    const engine = new RPECalibrationEngine([], [makeCalibration(4)], {
      enhancedAthleteMode: true,
    });
    expect(engine.analyzeOverallBias().sandbaggingDetected).toBe(true);
  });

  it('getBiasLevel raises the display threshold with the same constant', () => {
    expect(getBiasLevel(1.6)).toBe('sandbagging');
    expect(getBiasLevel(1.6, true)).toBe('accurate');
    expect(getBiasLevel(1.5 * ENHANCED_RECOVERY_MULTIPLIER + 0.1, true)).toBe('sandbagging');
  });
});

// ============================================
// 5. Mesocycle generator consumption
// ============================================

describe('mesocycle generator (enhanced mode)', () => {
  it('extends the default accumulation block by one week', () => {
    const natural = calculateRecoveryFactors(createProfile());
    const enhanced = calculateRecoveryFactors(createProfile({ enhancedAthleteMode: true }));
    expect(enhanced.deloadFrequencyWeeks).toBe(
      natural.deloadFrequencyWeeks + ENHANCED_EXTRA_ACCUMULATION_WEEKS
    );
  });

  it('scales MAV-derived base volume by the MAV multiplier', () => {
    const natural = recommendVolume('intermediate', 'maintenance', 'chest');
    const enhanced = recommendVolume('intermediate', 'maintenance', 'chest', true);
    expect(enhanced).toBe(Math.round(natural * ENHANCED_SCALING.mav));
  });

  it('clamps weekly volume at the shared band MRV for BOTH natural and enhanced', () => {
    // Max out every recovery multiplier so the clamp actually binds.
    const boostedRecovery = calculateRecoveryFactors(
      createProfile({ age: 22, sleepQuality: 5 as Rating, stressLevel: 1 as Rating })
    );

    const natural = calculateVolumeDistribution(
      'Upper/Lower', 4, 'advanced', 'bulk', boostedRecovery, undefined, undefined, false
    );
    const enhanced = calculateVolumeDistribution(
      'Upper/Lower', 4, 'advanced', 'bulk', boostedRecovery, undefined, undefined, true
    );

    // Coarse groups clamp at the SHARED band MRV (services/volumeBands) —
    // the tracking card renders that ceiling un-scaled for enhanced users
    // too, so the clamp deliberately applies to both modes: a target the
    // card would flag is wrong regardless of recovery capacity. (The old
    // behavior clamped 'chest' at the {mrv:16} legacy fallback because the
    // coarse key missed the per-standard landmark table entirely.)
    const bandMrv = RESEARCH_VOLUME_BANDS.chest.mrv;
    expect(natural.chest.sets).toBeLessThanOrEqual(bandMrv);
    expect(enhanced.chest.sets).toBeLessThanOrEqual(bandMrv);
    // Enhanced never allocates LESS; at the shared ceiling both may saturate.
    expect(enhanced.chest.sets).toBeGreaterThanOrEqual(natural.chest.sets);
  });

  it('ramps weekly volume proportionally faster so the lifter approaches MRV before deload', () => {
    const naturalPlan = buildPeriodizationPlan(
      createProfile({ experience: 'novice', trainingAge: 0.5 }),
      calculateRecoveryFactors(createProfile({ experience: 'novice', trainingAge: 0.5 }))
    );
    const enhancedProfile = createProfile({
      experience: 'novice',
      trainingAge: 0.5,
      enhancedAthleteMode: true,
    });
    const enhancedPlan = buildPeriodizationPlan(
      enhancedProfile,
      calculateRecoveryFactors(enhancedProfile)
    );

    // Final accumulation week (last non-deload entry) ramps higher.
    const lastNatural = naturalPlan.weeklyProgression[naturalPlan.deloadFrequency - 1];
    const lastEnhanced = enhancedPlan.weeklyProgression[enhancedPlan.deloadFrequency - 1];
    expect(lastEnhanced.volumeModifier).toBeGreaterThan(lastNatural.volumeModifier);

    // Deload week volumes are calculated the same way (no special casing).
    const deloadNatural = naturalPlan.weeklyProgression[naturalPlan.deloadFrequency];
    const deloadEnhanced = enhancedPlan.weeklyProgression[enhancedPlan.deloadFrequency];
    expect(deloadEnhanced.volumeModifier).toBe(deloadNatural.volumeModifier);
  });
});

// ============================================
// 6. Joint-stress caps: provably unaffected
// ============================================

describe('connective-tissue safety caps (invariant under the toggle)', () => {
  const exercises = [
    'Barbell Back Squat',
    'Conventional Deadlift',
    'Barbell Bench Press',
    'Bulgarian Split Squat',
    'Machine Chest Press',
    'Cable Lateral Raise',
  ];

  it('safety tier and RIR floor take only the exercise — the API cannot read the toggle', () => {
    // Structural guarantee: one string parameter, nothing else.
    expect(getFailureSafetyTier.length).toBe(1);
    expect(getRIRFloor.length).toBe(1);
  });

  it('prescriptions carry identical caps with the mode on and off', () => {
    const context: Omit<SetPrescriptionContext, 'enhancedAthleteMode'> = {
      setNumber: 2,
      totalSets: 3,
      isMesocycleEnd: false,
      isReturnFromDeload: false,
      isFirstTimeExercise: false,
      hasRecentAMRAP: false,
    };

    for (const exercise of exercises) {
      const natural = prescribeSetType(exercise, { min: 6, max: 10 }, 1, {
        ...context,
        enhancedAthleteMode: false,
      });
      const enhanced = prescribeSetType(exercise, { min: 6, max: 10 }, 1, {
        ...context,
        enhancedAthleteMode: true,
      });

      // Every safety-relevant output is identical — only the informational
      // note may differ.
      expect(enhanced.rirFloor).toBe(natural.rirFloor);
      expect(enhanced.safetyTier).toBe(natural.safetyTier);
      expect(enhanced.isAMRAP).toBe(natural.isAMRAP);
      expect(enhanced.targetReps).toEqual(natural.targetReps);
      expect(enhanced.displayText).toBe(natural.displayText);
    }
  });

  it('AMRAP (max-effort frequency) gating is identical regardless of mode', () => {
    for (const exercise of exercises) {
      const eligibility = isAMRAPEligible(exercise, {
        isMesocycleEnd: false,
        isReturnFromDeload: false,
      });
      // isAMRAPEligible has no enhanced input at all; assert it stays a
      // function of exercise + meso context only.
      expect(typeof eligibility).toBe('boolean');
    }
    expect(isAMRAPEligible.length).toBeLessThanOrEqual(2);
  });

  it('surfaces the connective-tissue note ONLY when enhanced and the floor binds', () => {
    const context: SetPrescriptionContext = {
      setNumber: 1,
      totalSets: 3,
      isMesocycleEnd: false,
      isReturnFromDeload: false,
      isFirstTimeExercise: false,
      hasRecentAMRAP: true,
    };

    // Protected lift, base RIR below the floor of 2 -> the cap binds.
    const binding = prescribeSetType('Barbell Back Squat', { min: 5, max: 8 }, 1, {
      ...context,
      enhancedAthleteMode: true,
    });
    expect(binding.connectiveTissueNote).toBeTruthy();

    // Same cap, natural athlete -> capped silently (nothing to explain).
    const naturalBinding = prescribeSetType('Barbell Back Squat', { min: 5, max: 8 }, 1, {
      ...context,
      enhancedAthleteMode: false,
    });
    expect(naturalBinding.connectiveTissueNote).toBeUndefined();

    // Enhanced but the floor doesn't bind (base RIR already >= floor).
    const nonBinding = prescribeSetType('Barbell Back Squat', { min: 5, max: 8 }, 3, {
      ...context,
      enhancedAthleteMode: true,
    });
    expect(nonBinding.connectiveTissueNote).toBeUndefined();
  });
});

// ============================================
// 7. Landmark derivation integration
// ============================================

describe('DEFAULT_VOLUME_LANDMARKS + central scaling', () => {
  it('scaled intermediate chest_upper matches the table in the spec', () => {
    const base = DEFAULT_VOLUME_LANDMARKS.intermediate.chest_upper; // {6, 10, 16}
    const scaled = scaleLandmarksForEnhanced(base, true);
    expect(scaled.mev).toBe(Math.round(base.mev * 1.1));
    expect(scaled.mav).toBe(Math.round(base.mav * 1.25));
    expect(scaled.mrv).toBe(Math.round(base.mrv * 1.375));
  });
});
