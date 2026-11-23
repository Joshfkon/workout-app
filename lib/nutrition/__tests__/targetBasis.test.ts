import { calculateMacros } from '@/lib/nutrition/macroCalculator';
import {
  describeTargetBasis,
  targetBasisLines,
  type TargetBasisSettings,
} from '@/lib/nutrition/targetBasis';

const settings: TargetBasisSettings = {
  height_cm: 180,
  age: 32,
  sex: 'male',
  activity_level: 'moderate',
  workouts_per_week: 4,
  avg_workout_minutes: 60,
  workout_intensity: 'moderate',
  goal: 'moderate_cut',
  target_weight_change_per_week: null,
  peptide: 'none',
  auto_update_enabled: true,
};

const weightKg = 90;

// What the calculator saved for these inputs (the app's own engine).
const calc = calculateMacros(
  { weightKg, heightCm: 180, age: 32, sex: 'male' },
  { activityLevel: 'moderate', workoutsPerWeek: 4, avgWorkoutMinutes: 60, workoutIntensity: 'moderate' },
  { goal: 'moderate_cut', peptide: 'none' }
);

describe('describeTargetBasis', () => {
  it('shows the burn, goal and adjustment when the stored target reproduces from the saved settings', () => {
    const basis = describeTargetBasis({
      targets: { calories: calc.calories, protein: calc.protein },
      settings,
      weightKg,
      units: 'lb',
    });
    expect(basis).toMatchObject({
      source: 'calculator',
      burnFrom: 'formula',
      dailyBurnKcal: calc.tdee,
      goalLabel: 'Moderate cut',
      adjustmentKcal: calc.calories - calc.tdee,
      activityLabel: 'Moderately active',
    });
    const lines = targetBasisLines(basis!);
    expect(lines[0]).toBe(
      `Estimated daily burn: ~${calc.tdee.toLocaleString('en-US')} kcal (from your weight, height, age and activity)`
    );
    expect(lines[1]).toBe('Activity: Moderately active');
    expect(lines[2]).toMatch(/^Goal: Moderate cut \(−[\d,]+ kcal a day\)$/);
    // protein / body weight in lb
    const perLb = Math.round((calc.protein / (weightKg * 2.20462)) * 10) / 10;
    expect(lines[3]).toBe(`Protein: ${perLb.toFixed(1)} g per lb of body weight`);
    expect(lines.join(' ')).not.toMatch(/TDEE/);
  });

  it('uses the user\'s unit for protein per body weight', () => {
    const basis = describeTargetBasis({
      targets: { calories: calc.calories, protein: 180 },
      settings,
      weightKg,
      units: 'kg',
    });
    expect(basis?.proteinPerWeight).toEqual({ grams: 2, unit: 'kg' });
  });

  it('says "measured" when the target came from the adaptive sync (stable measured burn)', () => {
    const measuredBurn = 2900;
    const synced = calculateMacros(
      { weightKg, heightCm: 180, age: 32, sex: 'male' },
      { activityLevel: 'moderate', workoutsPerWeek: 4, avgWorkoutMinutes: 60, workoutIntensity: 'moderate' },
      { goal: 'moderate_cut', peptide: 'none' },
      measuredBurn
    );
    const basis = describeTargetBasis({
      targets: { calories: synced.calories, protein: synced.protein },
      settings,
      weightKg,
      measuredBurnKcal: measuredBurn,
      units: 'lb',
    });
    expect(basis).toMatchObject({ source: 'calculator', burnFrom: 'measured', dailyBurnKcal: measuredBurn });
    expect(targetBasisLines(basis!)[0]).toContain('measured from your logged food and weight trend');
  });

  it('omits the burn and adjustment when the stored target does not reproduce (never guessed)', () => {
    const basis = describeTargetBasis({
      targets: { calories: calc.calories + 400, protein: calc.protein },
      settings,
      weightKg,
      units: 'lb',
    });
    expect(basis?.source).toBe('unknown');
    expect(basis?.dailyBurnKcal).toBeUndefined();
    expect(basis?.adjustmentKcal).toBeUndefined();
    const lines = targetBasisLines(basis!);
    expect(lines).toContain('Goal: Moderate cut');
    expect(lines.some((l) => l.startsWith('Estimated daily burn'))).toBe(false);
  });

  it('hand-entered targets (auto-update off, or no settings) say so and show no burn', () => {
    for (const s of [{ ...settings, auto_update_enabled: false }, null]) {
      const basis = describeTargetBasis({
        targets: { calories: 2200, protein: 180 },
        settings: s,
        weightKg,
        units: 'lb',
      });
      expect(basis?.source).toBe('manual');
      const lines = targetBasisLines(basis!);
      expect(lines[0]).toBe('You entered these targets yourself.');
      expect(lines.some((l) => l.includes('burn'))).toBe(false);
    }
  });

  it('omits protein per body weight without a weigh-in, and returns null without targets', () => {
    const basis = describeTargetBasis({
      targets: { calories: 2200, protein: 180 },
      settings: null,
      weightKg: null,
      units: 'lb',
    });
    expect(basis?.proteinPerWeight).toBeUndefined();
    expect(describeTargetBasis({ targets: null, settings, weightKg, units: 'lb' })).toBeNull();
  });
});
