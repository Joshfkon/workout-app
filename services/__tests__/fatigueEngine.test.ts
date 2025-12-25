/**
 * Tests for services/fatigueEngine.ts
 * Readiness scoring, fatigue management, deload recommendations
 */

import {
  calculateReadinessScore,
  createCheckIn,
  updateMesocycleFatigue,
  calculateFatigueAfterRest,
  shouldTriggerDeload,
  adjustTargetsForReadiness,
  forecastWeeklyFatigue,
  getReadinessInterpretation,
  type ReadinessInput,
  type FatigueUpdateInput,
  type DeloadCheckInput,
  type ReadinessAdjustmentInput,
} from '../fatigueEngine';

import type { ProgressionTargets } from '@/types/schema';

// ============================================
// READINESS SCORE TESTS
// ============================================

describe('calculateReadinessScore', () => {
  describe('optimal conditions', () => {
    it('returns high score for optimal inputs', () => {
      const input: ReadinessInput = {
        sleepHours: 8,
        sleepQuality: 5,
        stressLevel: 1,
        nutritionRating: 5,
        previousSessionRpe: 7,
        daysSinceLastSession: 2,
      };

      const score = calculateReadinessScore(input);
      expect(score).toBeGreaterThanOrEqual(85);
    });

    it('returns near-max score for 7-9 hours quality sleep, low stress', () => {
      const input: ReadinessInput = {
        sleepHours: 7.5,
        sleepQuality: 5,
        stressLevel: 1,
        nutritionRating: 5,
      };

      const score = calculateReadinessScore(input);
      expect(score).toBeGreaterThan(80);
    });
  });

  describe('sleep scoring', () => {
    it('penalizes poor sleep duration', () => {
      const goodSleep = calculateReadinessScore({
        sleepHours: 8,
        sleepQuality: 4,
        stressLevel: 3,
        nutritionRating: 3,
      });

      const poorSleep = calculateReadinessScore({
        sleepHours: 4,
        sleepQuality: 4,
        stressLevel: 3,
        nutritionRating: 3,
      });

      expect(goodSleep).toBeGreaterThan(poorSleep);
    });

    it('accepts slightly oversleep (9-10 hours)', () => {
      const score = calculateReadinessScore({
        sleepHours: 9.5,
        sleepQuality: 4,
        stressLevel: 3,
        nutritionRating: 3,
      });

      expect(score).toBeGreaterThan(60);
    });

    it('factors in sleep quality multiplier', () => {
      const highQuality = calculateReadinessScore({
        sleepHours: 7,
        sleepQuality: 5,
        stressLevel: 3,
        nutritionRating: 3,
      });

      const lowQuality = calculateReadinessScore({
        sleepHours: 7,
        sleepQuality: 1,
        stressLevel: 3,
        nutritionRating: 3,
      });

      expect(highQuality).toBeGreaterThan(lowQuality);
    });
  });

  describe('stress scoring', () => {
    it('penalizes high stress', () => {
      const lowStress = calculateReadinessScore({
        sleepHours: 7,
        sleepQuality: 4,
        stressLevel: 1,
        nutritionRating: 3,
      });

      const highStress = calculateReadinessScore({
        sleepHours: 7,
        sleepQuality: 4,
        stressLevel: 5,
        nutritionRating: 3,
      });

      expect(lowStress).toBeGreaterThan(highStress);
    });
  });

  describe('recovery factors', () => {
    it('boosts score for multiple rest days', () => {
      const oneDay = calculateReadinessScore({
        sleepHours: 7,
        sleepQuality: 3,
        stressLevel: 3,
        nutritionRating: 3,
        daysSinceLastSession: 1,
      });

      const twoDays = calculateReadinessScore({
        sleepHours: 7,
        sleepQuality: 3,
        stressLevel: 3,
        nutritionRating: 3,
        daysSinceLastSession: 2,
      });

      expect(twoDays).toBeGreaterThan(oneDay);
    });

    it('penalizes training same day', () => {
      const sameDay = calculateReadinessScore({
        sleepHours: 7,
        sleepQuality: 3,
        stressLevel: 3,
        nutritionRating: 3,
        daysSinceLastSession: 0,
      });

      const nextDay = calculateReadinessScore({
        sleepHours: 7,
        sleepQuality: 3,
        stressLevel: 3,
        nutritionRating: 3,
        daysSinceLastSession: 1,
      });

      expect(nextDay).toBeGreaterThan(sameDay);
    });

    it('penalizes high previous session RPE', () => {
      const easySession = calculateReadinessScore({
        sleepHours: 7,
        sleepQuality: 3,
        stressLevel: 3,
        nutritionRating: 3,
        previousSessionRpe: 6,
      });

      const brutalSession = calculateReadinessScore({
        sleepHours: 7,
        sleepQuality: 3,
        stressLevel: 3,
        nutritionRating: 3,
        previousSessionRpe: 10,
      });

      expect(easySession).toBeGreaterThan(brutalSession);
    });
  });

  describe('null handling', () => {
    it('uses neutral defaults for null values', () => {
      const score = calculateReadinessScore({
        sleepHours: null,
        sleepQuality: null,
        stressLevel: null,
        nutritionRating: null,
      });

      // Should return a moderate score with neutral defaults
      expect(score).toBeGreaterThan(40);
      expect(score).toBeLessThan(80);
    });
  });

  describe('score clamping', () => {
    it('never returns score below 0', () => {
      const score = calculateReadinessScore({
        sleepHours: 1,
        sleepQuality: 1,
        stressLevel: 5,
        nutritionRating: 1,
        previousSessionRpe: 10,
        daysSinceLastSession: 0,
      });

      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('never returns score above 100', () => {
      const score = calculateReadinessScore({
        sleepHours: 8,
        sleepQuality: 5,
        stressLevel: 1,
        nutritionRating: 5,
        previousSessionRpe: 5,
        daysSinceLastSession: 3,
      });

      expect(score).toBeLessThanOrEqual(100);
    });
  });
});

// ============================================
// CREATE CHECK-IN TESTS
// ============================================

describe('createCheckIn', () => {
  it('creates PreWorkoutCheckIn with calculated readiness', () => {
    const input: ReadinessInput = {
      sleepHours: 8,
      sleepQuality: 4,
      stressLevel: 2,
      nutritionRating: 4,
    };

    const checkIn = createCheckIn(input);

    expect(checkIn.sleepHours).toBe(8);
    expect(checkIn.sleepQuality).toBe(4);
    expect(checkIn.stressLevel).toBe(2);
    expect(checkIn.nutritionRating).toBe(4);
    expect(checkIn.bodyweightKg).toBeNull();
    expect(checkIn.readinessScore).toBeGreaterThan(0);
  });
});

// ============================================
// FATIGUE MANAGEMENT TESTS
// ============================================

describe('updateMesocycleFatigue', () => {
  it('accumulates fatigue after a session', () => {
    const input: FatigueUpdateInput = {
      currentFatigue: 30,
      sessionRpe: 8,
      daysSinceLastSession: 1,
    };

    const newFatigue = updateMesocycleFatigue(input);

    // Should add ~8 for RPE 8, subtract ~3 for 1 rest day
    expect(newFatigue).toBeGreaterThan(30);
  });

  it('recovers fatigue with rest days', () => {
    const input: FatigueUpdateInput = {
      currentFatigue: 50,
      sessionRpe: 7,
      daysSinceLastSession: 3,
    };

    const newFatigue = updateMesocycleFatigue(input);

    // 3 rest days = 9 recovery, RPE 7 = 6 accumulation
    // Net should be slight decrease
    expect(newFatigue).toBeLessThan(50);
  });

  it('accumulates more for higher RPE sessions', () => {
    const rpe7 = updateMesocycleFatigue({
      currentFatigue: 30,
      sessionRpe: 7,
      daysSinceLastSession: 1,
    });

    const rpe9 = updateMesocycleFatigue({
      currentFatigue: 30,
      sessionRpe: 9,
      daysSinceLastSession: 1,
    });

    expect(rpe9).toBeGreaterThan(rpe7);
  });

  it('clamps fatigue to 0-100 range', () => {
    const tooHigh = updateMesocycleFatigue({
      currentFatigue: 95,
      sessionRpe: 10,
      daysSinceLastSession: 0,
    });

    const tooLow = updateMesocycleFatigue({
      currentFatigue: 5,
      sessionRpe: 5,
      daysSinceLastSession: 5,
    });

    expect(tooHigh).toBeLessThanOrEqual(100);
    expect(tooLow).toBeGreaterThanOrEqual(0);
  });
});

describe('calculateFatigueAfterRest', () => {
  it('reduces fatigue based on rest days', () => {
    expect(calculateFatigueAfterRest(50, 2)).toBeLessThan(50);
    expect(calculateFatigueAfterRest(50, 5)).toBeLessThan(calculateFatigueAfterRest(50, 2));
  });

  it('never goes below 0', () => {
    expect(calculateFatigueAfterRest(10, 10)).toBe(0);
    expect(calculateFatigueAfterRest(5, 5)).toBe(0);
  });

  it('returns 0 for 0 fatigue', () => {
    expect(calculateFatigueAfterRest(0, 3)).toBe(0);
  });
});

// ============================================
// DELOAD TRIGGER TESTS
// ============================================

describe('shouldTriggerDeload', () => {
  const baseInput: DeloadCheckInput = {
    fatigue: 50,
    weekInMeso: 3,
    totalWeeks: 6,
    deloadWeek: 6,
    recentSessions: [
      { sessionRpe: 7.5, completionPercent: 90 },
      { sessionRpe: 7.5, completionPercent: 90 },
    ],
  };

  it('triggers on scheduled deload week', () => {
    const input: DeloadCheckInput = {
      ...baseInput,
      weekInMeso: 6,
      deloadWeek: 6,
    };

    const result = shouldTriggerDeload(input);
    expect(result.shouldDeload).toBe(true);
    expect(result.reason).toContain('Scheduled');
    expect(result.urgency).toBe('medium');
  });

  it('triggers on high fatigue score', () => {
    const input: DeloadCheckInput = {
      ...baseInput,
      fatigue: 80,
    };

    const result = shouldTriggerDeload(input);
    expect(result.shouldDeload).toBe(true);
    expect(result.reason).toContain('fatigue');
    expect(result.urgency).toBe('high');
  });

  it('triggers on consecutive missed targets', () => {
    const input: DeloadCheckInput = {
      ...baseInput,
      recentSessions: [
        { sessionRpe: 9, completionPercent: 70 },
        { sessionRpe: 9, completionPercent: 65 },
        { sessionRpe: 9, completionPercent: 75 },
      ],
    };

    const result = shouldTriggerDeload(input);
    expect(result.shouldDeload).toBe(true);
    expect(result.reason).toContain('targets');
  });

  it('triggers on significant RPE creep', () => {
    const input: DeloadCheckInput = {
      ...baseInput,
      recentSessions: [
        { sessionRpe: 7, completionPercent: 90 },
        { sessionRpe: 7, completionPercent: 90 },
        { sessionRpe: 7.5, completionPercent: 90 },
        { sessionRpe: 8.5, completionPercent: 85 },
        { sessionRpe: 9, completionPercent: 85 },
        { sessionRpe: 9.5, completionPercent: 80 },
      ],
    };

    const result = shouldTriggerDeload(input);
    expect(result.shouldDeload).toBe(true);
    expect(result.reason).toContain('RPE');
  });

  it('does not trigger under normal conditions', () => {
    const result = shouldTriggerDeload(baseInput);
    expect(result.shouldDeload).toBe(false);
  });
});

// ============================================
// TARGET ADJUSTMENT TESTS
// ============================================

describe('adjustTargetsForReadiness', () => {
  const baseTargets: ProgressionTargets = {
    weightKg: 100,
    repRange: [6, 10],
    targetRir: 2,
    sets: 4,
    restSeconds: 180,
    progressionType: 'load',
    reason: 'Normal progression',
  };

  const baseInput: ReadinessAdjustmentInput = {
    baseTargets,
    readinessScore: 80,
    minWeightIncrement: 2.5,
  };

  it('returns unchanged targets for high readiness (80+)', () => {
    const result = adjustTargetsForReadiness(baseInput);
    expect(result).toEqual(baseTargets);
  });

  it('makes minor adjustments for moderate readiness (60-79)', () => {
    const result = adjustTargetsForReadiness({
      ...baseInput,
      readinessScore: 70,
    });

    expect(result.targetRir).toBe(3); // +1
    expect(result.restSeconds).toBe(210); // +30
    expect(result.weightKg).toBe(100); // unchanged
    expect(result.reason).toContain('moderate readiness');
  });

  it('makes significant adjustments for low readiness (40-59)', () => {
    const result = adjustTargetsForReadiness({
      ...baseInput,
      readinessScore: 50,
    });

    expect(result.weightKg).toBeLessThan(100);
    expect(result.targetRir).toBe(4); // +2
    expect(result.sets).toBe(3); // -1
    expect(result.restSeconds).toBe(240); // +60
    expect(result.reason).toContain('low readiness');
  });

  it('suggests light session for very low readiness (<40)', () => {
    const result = adjustTargetsForReadiness({
      ...baseInput,
      readinessScore: 30,
    });

    expect(result.weightKg).toBeLessThan(90);
    expect(result.targetRir).toBe(4);
    expect(result.sets).toBe(2);
    expect(result.progressionType).toBe('technique');
    expect(result.reason).toContain('light technique');
  });
});

// ============================================
// FATIGUE FORECASTING TESTS
// ============================================

describe('forecastWeeklyFatigue', () => {
  it('projects fatigue for planned sessions', () => {
    const result = forecastWeeklyFatigue(30, 4, 7.5);

    expect(result.projectedFatigue).toBeGreaterThan(30);
    expect(result.recommendation).toBeTruthy();
  });

  it('recommends high intensity for low projected fatigue', () => {
    const result = forecastWeeklyFatigue(10, 2, 6);

    expect(result.projectedFatigue).toBeLessThan(50);
    expect(result.recommendation).toContain('high-intensity');
  });

  it('recommends deload for high projected fatigue', () => {
    const result = forecastWeeklyFatigue(70, 5, 9);

    expect(result.projectedFatigue).toBeGreaterThan(80);
    expect(result.recommendation).toContain('deload');
  });

  it('recommends volume/intensity reduction for moderate-high fatigue', () => {
    const result = forecastWeeklyFatigue(50, 4, 8);

    // Should end up in 70-85 range
    expect(result.recommendation).toMatch(/reducing|maintain/i);
  });
});

// ============================================
// READINESS INTERPRETATION TESTS
// ============================================

describe('getReadinessInterpretation', () => {
  it('returns excellent for 85+', () => {
    const result = getReadinessInterpretation(90);
    expect(result.level).toBe('excellent');
    expect(result.recommendation).toContain('progression');
  });

  it('returns good for 70-84', () => {
    const result = getReadinessInterpretation(75);
    expect(result.level).toBe('good');
    expect(result.recommendation).toContain('Proceed');
  });

  it('returns moderate for 55-69', () => {
    const result = getReadinessInterpretation(60);
    expect(result.level).toBe('moderate');
    expect(result.recommendation).toContain('Maintain');
  });

  it('returns low for 40-54', () => {
    const result = getReadinessInterpretation(45);
    expect(result.level).toBe('low');
    expect(result.recommendation).toContain('reducing');
  });

  it('returns poor for <40', () => {
    const result = getReadinessInterpretation(30);
    expect(result.level).toBe('poor');
    expect(result.recommendation).toContain('rest');
  });

  it('handles edge cases', () => {
    expect(getReadinessInterpretation(85).level).toBe('excellent');
    expect(getReadinessInterpretation(70).level).toBe('good');
    expect(getReadinessInterpretation(55).level).toBe('moderate');
    expect(getReadinessInterpretation(40).level).toBe('low');
    expect(getReadinessInterpretation(39).level).toBe('poor');
  });
});
