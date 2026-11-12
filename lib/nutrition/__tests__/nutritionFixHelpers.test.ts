/**
 * Pure helpers behind the nutrition review fixes: adaptive-sync gating,
 * formula profile resolution, client local date, workout expenditure,
 * scanned custom foods and the low-calorie warning.
 */
import { decideAdaptiveSync } from '@/lib/nutrition/adaptiveSyncPolicy';
import {
  resolveFormulaProfile,
  ageFromBirthDate,
  unitsFromUserPreferences,
} from '@/lib/nutrition/formulaProfile';
import { resolveLocalDate } from '@/lib/nutrition/localDate';
import {
  sumSessionExpenditure,
  resolveWorkoutBodyweightKg,
  resolveWorkoutBodyFatPercent,
} from '@/lib/nutrition/workoutExpenditure';
import { customFoodFieldsFromScan } from '@/lib/nutrition/scannedCustomFood';
import { lowCalorieTargetWarning } from '@/lib/nutrition/calorieTargetWarning';
import { getFormulaTDEE } from '@/lib/nutrition/adaptive-tdee';

describe('decideAdaptiveSync', () => {
  const stable = { confidence: 'stable' as const, adaptiveTDEE: 2600, formulaTDEE: 2300 };

  it('never syncs hand-entered targets (no macro_settings row)', () => {
    const d = decideAdaptiveSync({ ...stable, macroSettings: null });
    expect(d).toMatchObject({ sync: false, reason: 'manual_targets' });
  });

  it('never syncs when auto-update is switched off', () => {
    const d = decideAdaptiveSync({ ...stable, macroSettings: { auto_update_enabled: false } });
    expect(d).toMatchObject({ sync: false, reason: 'auto_update_off' });
  });

  it('syncs a stable, materially different estimate for an opted-in user', () => {
    expect(decideAdaptiveSync({ ...stable, macroSettings: { auto_update_enabled: true } })).toEqual({
      sync: true,
    });
  });

  it('does not sync within the 50 kcal tolerance', () => {
    const d = decideAdaptiveSync({
      confidence: 'stable',
      adaptiveTDEE: 2340,
      formulaTDEE: 2300,
      macroSettings: { auto_update_enabled: true },
    });
    expect(d).toMatchObject({ sync: false, reason: 'within_tolerance' });
  });

  it.each(['unstable', 'stabilizing'] as const)('does not sync a %s estimate', (confidence) => {
    const d = decideAdaptiveSync({
      ...stable,
      confidence,
      macroSettings: { auto_update_enabled: true },
    });
    expect(d).toMatchObject({ sync: false, reason: confidence });
  });
});

describe('resolveFormulaProfile', () => {
  it('uses the users row for a 160 cm, 45-year-old woman instead of male/175/30', () => {
    const profile = resolveFormulaProfile({
      macroSettings: null,
      userRow: { height_cm: '160.0', age: 45, sex: 'female', weight_kg: 60 },
      today: '2026-11-12',
    });
    expect(profile).toMatchObject({ heightCm: 160, age: 45, sex: 'female', isComplete: true });

    // Mifflin-St Jeor BMR: 10*60 + 6.25*160 - 5*45 - 161 = 1214 (not 1549).
    const formula = getFormulaTDEE(
      { weightKg: 60, heightCm: profile.heightCm, age: profile.age, sex: profile.sex },
      {
        activityLevel: 'sedentary',
        workoutsPerWeek: 0,
        avgWorkoutMinutes: 0,
        workoutIntensity: 'light',
      }
    );
    const defaults = resolveFormulaProfile({ macroSettings: null, userRow: null, today: '2026-11-12' });
    const defaultFormula = getFormulaTDEE(
      { weightKg: 60, heightCm: defaults.heightCm, age: defaults.age, sex: defaults.sex },
      {
        activityLevel: 'sedentary',
        workoutsPerWeek: 0,
        avgWorkoutMinutes: 0,
        workoutIntensity: 'light',
      }
    );
    expect(formula.estimatedTDEE).toBeLessThan(defaultFormula.estimatedTDEE * 0.85);
  });

  it('prefers macro_settings (calculator inputs) and takes activity from it', () => {
    const profile = resolveFormulaProfile({
      macroSettings: {
        height_cm: 182,
        age: 28,
        sex: 'male',
        activity_level: 'active',
        workouts_per_week: 5,
        avg_workout_minutes: 75,
        workout_intensity: 'intense',
      },
      userRow: { height_cm: 170, age: 50, sex: 'female' },
      today: '2026-11-12',
    });
    expect(profile).toMatchObject({
      heightCm: 182,
      age: 28,
      sex: 'male',
      activityLevel: 'active',
      workoutsPerWeek: 5,
      avgWorkoutMinutes: 75,
      workoutIntensity: 'intense',
    });
  });

  it('derives age from birth_date and falls back to defaults when nothing is stored', () => {
    expect(
      resolveFormulaProfile({
        macroSettings: null,
        userRow: { birth_date: '1981-12-01' },
        today: '2026-11-12',
      }).age
    ).toBe(44);
    expect(ageFromBirthDate('1981-11-12', '2026-11-12')).toBe(45);

    const defaults = resolveFormulaProfile({ macroSettings: null, userRow: null, today: '2026-11-12' });
    expect(defaults).toMatchObject({
      heightCm: 175,
      age: 30,
      sex: 'male',
      activityLevel: 'moderate',
      isComplete: false,
      profileWeightKg: null,
    });
  });

  it('reads the unit preference from users.preferences.units (default lb)', () => {
    expect(unitsFromUserPreferences({ units: 'kg' })).toBe('kg');
    expect(unitsFromUserPreferences({ units: 'lb' })).toBe('lb');
    expect(unitsFromUserPreferences({})).toBe('lb');
    expect(unitsFromUserPreferences(null)).toBe('lb');
  });
});

describe('resolveLocalDate', () => {
  it("uses the client's day when it is a day ahead of the server (Sydney morning, UTC host)", () => {
    expect(resolveLocalDate('2026-11-12', '2026-11-11')).toBe('2026-11-12');
  });

  it("uses the client's day when it is a day behind the server (US evening, UTC host)", () => {
    expect(resolveLocalDate('2026-11-10', '2026-11-11')).toBe('2026-11-10');
  });

  it('falls back to the server day when missing, malformed or implausible', () => {
    expect(resolveLocalDate(undefined, '2026-11-11')).toBe('2026-11-11');
    expect(resolveLocalDate('11/12/2026', '2026-11-11')).toBe('2026-11-11');
    expect(resolveLocalDate('2026-02-31', '2026-03-02')).toBe('2026-03-02');
    expect(resolveLocalDate('2027-01-01', '2026-11-11')).toBe('2026-11-11');
    expect(resolveLocalDate('2026-11-08', '2026-11-11')).toBe('2026-11-11');
  });
});

describe('workout expenditure helpers', () => {
  it('sums two sessions on one day and counts a re-saved session once', () => {
    expect(
      sumSessionExpenditure([
        { workout_session_id: 'am', estimated_calories: 310 },
        { workout_session_id: 'pm', estimated_calories: 280 },
      ])
    ).toBe(590);
    expect(
      sumSessionExpenditure([
        { workout_session_id: 'am', estimated_calories: 310 },
        { workout_session_id: 'am', estimated_calories: 310 },
      ])
    ).toBe(310);
    expect(sumSessionExpenditure([])).toBe(0);
  });

  it('uses the real bodyweight from the latest weigh-in, converting lb to kg', () => {
    expect(resolveWorkoutBodyweightKg({ latestWeighIn: { weight: 132, unit: 'lb' } })).toBeCloseTo(59.87, 1);
    expect(resolveWorkoutBodyweightKg({ latestWeighIn: { weight: 104, unit: 'kg' } })).toBe(104);
  });

  it('falls back to the profile weight, then to 80 kg only when nothing is known', () => {
    expect(resolveWorkoutBodyweightKg({ latestWeighIn: null, profileWeightKg: 61.5 })).toBe(61.5);
    expect(resolveWorkoutBodyweightKg({ latestWeighIn: null, profileWeightKg: null })).toBe(80);
  });

  it('uses measured body fat when plausible', () => {
    expect(resolveWorkoutBodyFatPercent(27.4)).toBe(27.4);
    expect(resolveWorkoutBodyFatPercent(null)).toBe(15);
    expect(resolveWorkoutBodyFatPercent(0)).toBe(15);
  });
});

describe('customFoodFieldsFromScan', () => {
  it('stores one base serving: 2 servings of a 30 g / 120 kcal item -> "30g", 120 kcal', () => {
    const fields = customFoodFieldsFromScan({
      serving_size: '2 serving (60g)',
      servings: 2,
      calories: 240,
      protein: 20,
      carbs: 24,
      fat: 8,
    });
    expect(fields).toEqual({ serving_size: '30g', calories: 120, protein: 10, carbs: 12, fat: 4 });
    // Logging 60 g of it later is 2 base servings = 240 kcal (was 120).
    expect((60 / 30) * fields.calories).toBe(240);
  });

  it('handles a portion logged by weight', () => {
    // 45 g of a 30 g / 120 kcal item: servings = 1.5
    const fields = customFoodFieldsFromScan({
      serving_size: '45g',
      servings: 1.5,
      calories: 180,
      protein: 15,
      carbs: 18,
      fat: 6,
    });
    expect(fields).toMatchObject({ serving_size: '30g', calories: 120 });
  });

  it('falls back to "1 serving" when the logged text has no weight', () => {
    const fields = customFoodFieldsFromScan({
      serving_size: '2 serving',
      servings: 2,
      calories: 300,
      protein: 10,
      carbs: 40,
      fat: 10,
    });
    expect(fields).toMatchObject({ serving_size: '1 serving', calories: 150 });
  });
});

describe('lowCalorieTargetWarning', () => {
  it('warns below the calculator floors (1500 male / 1200 female)', () => {
    expect(lowCalorieTargetWarning(1400, 'male')).toMatch(/1500/);
    expect(lowCalorieTargetWarning(1100, 'female')).toMatch(/1200/);
  });

  it('does not warn at or above the floor, or for empty input', () => {
    expect(lowCalorieTargetWarning(1500, 'male')).toBeNull();
    expect(lowCalorieTargetWarning(1300, 'female')).toBeNull();
    expect(lowCalorieTargetWarning(NaN, 'male')).toBeNull();
  });

  it('uses the lower floor when sex is unknown', () => {
    expect(lowCalorieTargetWarning(1300, null)).toBeNull();
    expect(lowCalorieTargetWarning(900, undefined)).toMatch(/1200/);
  });
});
