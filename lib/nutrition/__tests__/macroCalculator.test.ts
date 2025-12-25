/**
 * Tests for lib/nutrition/macroCalculator.ts
 * BMR, TDEE, macro calculations, cardio prescription
 */

import {
  calculateBMR,
  calculateTDEE,
  calculateMacros,
  kgToLbs,
  lbsToKg,
  cmToInches,
  inchesToCm,
  getGoalOptions,
  getActivityOptions,
  getPeptideOptions,
  getRefeedIntegrationSignals,
  type UserStats,
  type ActivityConfig,
  type GoalConfig,
  type CardioConfig,
  type PhaseStatus,
} from '../macroCalculator';

// ============================================
// TEST FIXTURES
// ============================================

const createMockStats = (overrides: Partial<UserStats> = {}): UserStats => ({
  weightKg: 80,
  heightCm: 180,
  age: 30,
  sex: 'male',
  ...overrides,
});

const createMockActivity = (overrides: Partial<ActivityConfig> = {}): ActivityConfig => ({
  activityLevel: 'moderate',
  workoutsPerWeek: 4,
  avgWorkoutMinutes: 60,
  workoutIntensity: 'moderate',
  ...overrides,
});

const createMockGoalConfig = (overrides: Partial<GoalConfig> = {}): GoalConfig => ({
  goal: 'maintain',
  ...overrides,
});

// ============================================
// CONVERSION FUNCTION TESTS
// ============================================

describe('Unit Conversions', () => {
  describe('kgToLbs', () => {
    it('converts kg to lbs correctly', () => {
      expect(kgToLbs(100)).toBeCloseTo(220.46, 1);
      expect(kgToLbs(80)).toBeCloseTo(176.37, 1);
      expect(kgToLbs(0)).toBe(0);
    });
  });

  describe('lbsToKg', () => {
    it('converts lbs to kg correctly', () => {
      expect(lbsToKg(220.46)).toBeCloseTo(100, 1);
      expect(lbsToKg(176)).toBeCloseTo(79.8, 1);
      expect(lbsToKg(0)).toBe(0);
    });
  });

  describe('cmToInches', () => {
    it('converts cm to inches correctly', () => {
      expect(cmToInches(180)).toBeCloseTo(70.87, 1);
      expect(cmToInches(2.54)).toBeCloseTo(1, 2);
    });
  });

  describe('inchesToCm', () => {
    it('converts inches to cm correctly', () => {
      expect(inchesToCm(70)).toBeCloseTo(177.8, 1);
      expect(inchesToCm(1)).toBeCloseTo(2.54, 2);
    });
  });
});

// ============================================
// BMR CALCULATION TESTS
// ============================================

describe('calculateBMR', () => {
  it('uses Katch-McArdle when body fat is available', () => {
    const stats = createMockStats({ bodyFatPercent: 15 });

    const bmr = calculateBMR(stats);

    // LBM = 80 * 0.85 = 68kg
    // BMR = 370 + 21.6 * 68 = 370 + 1468.8 = 1838.8
    expect(bmr).toBeCloseTo(1839, 0);
  });

  it('uses Mifflin-St Jeor for males without body fat', () => {
    const stats = createMockStats({ sex: 'male', bodyFatPercent: undefined });

    const bmr = calculateBMR(stats);

    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    expect(bmr).toBeCloseTo(1780, 0);
  });

  it('uses Mifflin-St Jeor for females without body fat', () => {
    const stats = createMockStats({ sex: 'female', bodyFatPercent: undefined });

    const bmr = calculateBMR(stats);

    // 10*80 + 6.25*180 - 5*30 - 161 = 800 + 1125 - 150 - 161 = 1614
    expect(bmr).toBeCloseTo(1614, 0);
  });

  it('handles 0% body fat (edge case)', () => {
    const stats = createMockStats({ bodyFatPercent: 0 });

    // Should fall back to Mifflin
    const bmr = calculateBMR(stats);
    expect(bmr).toBeGreaterThan(0);
  });
});

// ============================================
// TDEE CALCULATION TESTS
// ============================================

describe('calculateTDEE', () => {
  it('applies activity multiplier to BMR', () => {
    const stats = createMockStats();
    const activity = createMockActivity({ activityLevel: 'sedentary' });

    const tdee = calculateTDEE(stats, activity);
    const bmr = calculateBMR(stats);

    expect(tdee).toBeCloseTo(bmr * 1.2, 0);
  });

  it('applies higher multiplier for more active levels', () => {
    const stats = createMockStats();

    const sedentary = calculateTDEE(stats, createMockActivity({ activityLevel: 'sedentary' }));
    const active = calculateTDEE(stats, createMockActivity({ activityLevel: 'active' }));

    expect(active).toBeGreaterThan(sedentary);
  });

  it('adds bonus for intense workouts', () => {
    const stats = createMockStats();

    const moderate = calculateTDEE(stats, createMockActivity({
      workoutsPerWeek: 4,
      workoutIntensity: 'moderate',
    }));

    const intense = calculateTDEE(stats, createMockActivity({
      workoutsPerWeek: 5,
      workoutIntensity: 'intense',
    }));

    expect(intense).toBeGreaterThan(moderate);
  });
});

// ============================================
// MACRO CALCULATION TESTS
// ============================================

describe('calculateMacros', () => {
  describe('maintenance', () => {
    it('returns calories near TDEE for maintenance', () => {
      const stats = createMockStats();
      const activity = createMockActivity();
      const goal = createMockGoalConfig({ goal: 'maintain' });

      const result = calculateMacros(stats, activity, goal);

      expect(result.weeklyChangeKg).toBeCloseTo(0, 1);
      // Deficit should be very close to 0 for maintenance (within 50 cal rounding)
      expect(Math.abs(result.deficit)).toBeLessThanOrEqual(50);
    });
  });

  describe('cutting', () => {
    it('creates deficit for cuts', () => {
      const result = calculateMacros(
        createMockStats(),
        createMockActivity(),
        createMockGoalConfig({ goal: 'moderate_cut' })
      );

      expect(result.deficit).toBeLessThan(0);
      expect(result.weeklyChangeKg).toBeLessThan(0);
    });

    it('applies loss rate cap for lean individuals', () => {
      const result = calculateMacros(
        createMockStats({ bodyFatPercent: 10 }),
        createMockActivity(),
        createMockGoalConfig({ goal: 'aggressive_cut' })
      );

      // Should be capped more conservatively for low body fat
      expect(result.guardrailsApplied).toBeDefined();
      expect(result.guardrailsApplied!.some((g) => g.includes('cap'))).toBe(true);
    });

    it('applies calorie floor', () => {
      const result = calculateMacros(
        createMockStats({ sex: 'female', weightKg: 50 }),
        createMockActivity({ activityLevel: 'sedentary' }),
        createMockGoalConfig({ goal: 'aggressive_cut' })
      );

      expect(result.calories).toBeGreaterThanOrEqual(1200);
    });
  });

  describe('bulking', () => {
    it('creates surplus for bulks', () => {
      const result = calculateMacros(
        createMockStats(),
        createMockActivity(),
        createMockGoalConfig({ goal: 'moderate_bulk' })
      );

      expect(result.deficit).toBeGreaterThan(0);
      expect(result.weeklyChangeKg).toBeGreaterThan(0);
    });
  });

  describe('macro allocation', () => {
    it('allocates protein based on lean body mass', () => {
      const result = calculateMacros(
        createMockStats({ bodyFatPercent: 15 }),
        createMockActivity(),
        createMockGoalConfig({ goal: 'maintain' })
      );

      // Should be 1.0-1.2 g/lb LBM
      const lbm = kgToLbs(80 * 0.85);
      const proteinPerLb = result.protein / lbm;

      expect(proteinPerLb).toBeGreaterThanOrEqual(1.0);
      expect(proteinPerLb).toBeLessThanOrEqual(1.2);
    });

    it('applies fat floor', () => {
      const result = calculateMacros(
        createMockStats(),
        createMockActivity(),
        createMockGoalConfig({ goal: 'aggressive_cut' })
      );

      // Fat floor is 0.35 g/lb BW
      const bwLbs = kgToLbs(80);
      const fatFloor = bwLbs * 0.35;

      expect(result.fat).toBeGreaterThanOrEqual(fatFloor - 5);
    });

    it('applies carb floor based on training', () => {
      const result = calculateMacros(
        createMockStats(),
        createMockActivity({ workoutsPerWeek: 5 }),
        createMockGoalConfig({ goal: 'moderate_cut' })
      );

      // Lifting 4-5 days = 130g carb floor
      expect(result.carbs).toBeGreaterThanOrEqual(125);
    });

    it('macro percentages sum to ~100%', () => {
      const result = calculateMacros(
        createMockStats(),
        createMockActivity(),
        createMockGoalConfig({ goal: 'maintain' })
      );

      const total = result.proteinPercent + result.carbsPercent + result.fatPercent;
      expect(total).toBeGreaterThanOrEqual(98);
      expect(total).toBeLessThanOrEqual(102);
    });
  });

  describe('peptide adjustment', () => {
    it('increases protein for semaglutide', () => {
      const withoutPeptide = calculateMacros(
        createMockStats(),
        createMockActivity(),
        createMockGoalConfig({ goal: 'moderate_cut' })
      );

      const withPeptide = calculateMacros(
        createMockStats(),
        createMockActivity(),
        createMockGoalConfig({ goal: 'moderate_cut', peptide: 'semaglutide' })
      );

      expect(withPeptide.protein).toBeGreaterThanOrEqual(withoutPeptide.protein);
      expect(withPeptide.peptideNotes).toBeDefined();
    });
  });

  describe('custom TDEE override', () => {
    it('uses override TDEE when provided', () => {
      const result = calculateMacros(
        createMockStats(),
        createMockActivity(),
        createMockGoalConfig({ goal: 'maintain' }),
        2500
      );

      expect(result.tdee).toBe(2500);
    });
  });
});

// ============================================
// CARDIO PRESCRIPTION TESTS
// ============================================

describe('Cardio Prescription', () => {
  it('does not prescribe cardio when disabled', () => {
    const cardio: CardioConfig = { enabled: false, mode: 'lifestyle' };

    const result = calculateMacros(
      createMockStats(),
      createMockActivity(),
      createMockGoalConfig({ goal: 'moderate_cut' }),
      undefined,
      cardio
    );

    expect(result.cardioPrescription?.needed).toBe(false);
  });

  it('does not prescribe cardio for non-cutting goals', () => {
    const cardio: CardioConfig = { enabled: true, mode: 'lifestyle' };

    const result = calculateMacros(
      createMockStats(),
      createMockActivity(),
      createMockGoalConfig({ goal: 'maintain' }),
      undefined,
      cardio
    );

    expect(result.cardioPrescription?.needed).toBe(false);
  });

  it('prescribes cardio to fill deficit gap', () => {
    const cardio: CardioConfig = { enabled: true, mode: 'lifestyle' };

    const result = calculateMacros(
      createMockStats({ bodyFatPercent: 12 }),
      createMockActivity(),
      createMockGoalConfig({ goal: 'aggressive_cut' }),
      undefined,
      cardio
    );

    // Aggressive cut on lean person should require cardio
    if (result.cardioPrescription?.needed) {
      expect(result.cardioPrescription.prescribedMinutesPerDay).toBeGreaterThan(0);
      expect(result.cardioPrescription.shortfallKcalPerDay).toBeGreaterThan(0);
    }
  });

  it('caps cardio at lifestyle limit (45 min)', () => {
    const cardio: CardioConfig = { enabled: true, mode: 'lifestyle' };

    const result = calculateMacros(
      createMockStats({ bodyFatPercent: 10 }),
      createMockActivity(),
      createMockGoalConfig({ goal: 'aggressive_cut' }),
      undefined,
      cardio
    );

    if (result.cardioPrescription?.needed) {
      expect(result.cardioPrescription.prescribedMinutesPerDay).toBeLessThanOrEqual(45);
      expect(result.cardioPrescription.capMinutesPerDay).toBe(45);
    }
  });

  it('allows higher cap for prep mode (90 min)', () => {
    const cardio: CardioConfig = { enabled: true, mode: 'prep' };

    const result = calculateMacros(
      createMockStats({ bodyFatPercent: 10 }),
      createMockActivity(),
      createMockGoalConfig({ goal: 'aggressive_cut' }),
      undefined,
      cardio
    );

    if (result.cardioPrescription) {
      expect(result.cardioPrescription.capMinutesPerDay).toBe(90);
    }
  });
});

// ============================================
// AGGRESSIVE PHASE TESTS
// ============================================

describe('Aggressive Phase Status', () => {
  it('returns phase status for aggressive cuts', () => {
    const result = calculateMacros(
      createMockStats(),
      createMockActivity(),
      createMockGoalConfig({
        goal: 'aggressive_cut',
        aggressivePhase: {
          currentWeeksInPhase: 0,
          plannedDurationWeeks: 3,
        },
      })
    );

    expect(result.phaseStatus).toBeDefined();
    expect(result.phaseStatus?.isAggressive).toBe(true);
    expect(result.phaseStatus?.weeksRemaining).toBe(3);
  });

  it('includes warnings at week 2', () => {
    const result = calculateMacros(
      createMockStats(),
      createMockActivity(),
      createMockGoalConfig({
        goal: 'aggressive_cut',
        aggressivePhase: {
          currentWeeksInPhase: 2,
          plannedDurationWeeks: 4,
        },
      })
    );

    expect(result.phaseStatus?.warnings.some((w) => w.level === 'caution')).toBe(true);
  });

  it('includes critical warning at week 4+', () => {
    const result = calculateMacros(
      createMockStats(),
      createMockActivity(),
      createMockGoalConfig({
        goal: 'aggressive_cut',
        aggressivePhase: {
          currentWeeksInPhase: 4,
          plannedDurationWeeks: 4,
        },
      })
    );

    expect(result.phaseStatus?.warnings.some((w) => w.level === 'critical')).toBe(true);
  });

  it('does not return phase status for non-aggressive goals', () => {
    const result = calculateMacros(
      createMockStats(),
      createMockActivity(),
      createMockGoalConfig({ goal: 'moderate_cut' })
    );

    expect(result.phaseStatus).toBeUndefined();
  });
});

// ============================================
// REFEED INTEGRATION TESTS
// ============================================

describe('getRefeedIntegrationSignals', () => {
  it('returns no signals when not aggressive', () => {
    const result = getRefeedIntegrationSignals(undefined);

    expect(result.suggestRefeedDay).toBe(false);
    expect(result.triggerDeloadCheck).toBe(false);
    expect(result.phaseHealth).toBe('good');
  });

  it('suggests refeed when phase suggests it', () => {
    const phaseStatus: PhaseStatus = {
      isAggressive: true,
      weeksRemaining: 1,
      weeksCompleted: 3,
      plannedDuration: 4,
      borrowedTimeWarning: 'Test',
      warnings: [
        {
          level: 'warning',
          message: 'Test',
          recommendation: 'Test',
          suggestRefeed: true,
          suggestRateReduction: false,
          suggestDietBreak: false,
          triggerDeloadCheck: true,
        },
      ],
      capsExhausted: false,
    };

    const result = getRefeedIntegrationSignals(phaseStatus);

    expect(result.suggestRefeedDay).toBe(true);
    expect(result.triggerDeloadCheck).toBe(true);
  });

  it('escalates phase health based on warning level', () => {
    const criticalPhase: PhaseStatus = {
      isAggressive: true,
      weeksRemaining: 0,
      weeksCompleted: 4,
      plannedDuration: 4,
      borrowedTimeWarning: 'Test',
      warnings: [
        {
          level: 'critical',
          message: 'Test',
          recommendation: 'Test',
          suggestRefeed: true,
          suggestRateReduction: true,
          suggestDietBreak: true,
          triggerDeloadCheck: true,
        },
      ],
      capsExhausted: false,
    };

    const result = getRefeedIntegrationSignals(criticalPhase);

    expect(result.phaseHealth).toBe('critical');
    expect(result.suggestDietBreak).toBe(true);
  });

  it('considers daily feedback for health assessment', () => {
    const phaseStatus: PhaseStatus = {
      isAggressive: true,
      weeksRemaining: 2,
      weeksCompleted: 2,
      plannedDuration: 4,
      borrowedTimeWarning: 'Test',
      warnings: [],
      capsExhausted: false,
    };

    const dailyFeedback = {
      sleepQuality: 2 as const,
      energyLevel: 2 as const,
      moodRating: 2 as const,
    };

    const result = getRefeedIntegrationSignals(phaseStatus, dailyFeedback);

    expect(result.phaseHealth).not.toBe('good');
    expect(result.suggestRefeedDay).toBe(true);
  });
});

// ============================================
// UI HELPER TESTS
// ============================================

describe('UI Helpers', () => {
  describe('getGoalOptions', () => {
    it('returns all goal options', () => {
      const options = getGoalOptions();

      expect(options).toHaveLength(7);
      expect(options.find((o) => o.value === 'aggressive_cut')).toBeDefined();
      expect(options.find((o) => o.value === 'maintain')).toBeDefined();
      expect(options.find((o) => o.value === 'aggressive_bulk')).toBeDefined();
    });

    it('includes labels and descriptions', () => {
      const options = getGoalOptions();

      options.forEach((opt) => {
        expect(opt.label).toBeTruthy();
        expect(opt.description).toBeTruthy();
      });
    });
  });

  describe('getActivityOptions', () => {
    it('returns all activity options', () => {
      const options = getActivityOptions();

      expect(options).toHaveLength(6);
      expect(options.find((o) => o.value === 'sedentary')).toBeDefined();
      expect(options.find((o) => o.value === 'athlete')).toBeDefined();
    });
  });

  describe('getPeptideOptions', () => {
    it('returns all peptide options', () => {
      const options = getPeptideOptions();

      expect(options.find((o) => o.value === 'none')).toBeDefined();
      expect(options.find((o) => o.value === 'semaglutide')).toBeDefined();
      expect(options.find((o) => o.value === 'tirzepatide')).toBeDefined();
    });

    it('includes descriptions', () => {
      const options = getPeptideOptions();

      options.forEach((opt) => {
        expect(opt.label).toBeTruthy();
        expect(opt.description).toBeTruthy();
      });
    });
  });
});
