import { calculateMacros } from '@/lib/nutrition/macroCalculator';
import {
  phaseToNutritionGoal,
  starterTargets,
  targetsFromMacroSettings,
  STARTER_ACTIVITY_SETTINGS,
  withProteinOverride,
} from '@/lib/nutrition/phaseTargets';

describe('phaseTargets', () => {
  it('maps phases to the calculator goal, keeping a same-direction pace', () => {
    expect(phaseToNutritionGoal('maintenance', 'slow_cut')).toBe('maintain');
    expect(phaseToNutritionGoal('cut', null)).toBe('moderate_cut');
    expect(phaseToNutritionGoal('cut', 'slow_cut')).toBe('slow_cut');
    expect(phaseToNutritionGoal('bulk', 'moderate_cut')).toBe('slow_bulk');
  });

  it('is calculateMacros with the saved settings (no second formula)', () => {
    const settings = {
      height_cm: 170,
      age: 40,
      sex: 'female' as const,
      goal: 'moderate_cut' as const,
      ...STARTER_ACTIVITY_SETTINGS,
    };
    const rec = calculateMacros(
      { weightKg: 70, heightCm: 170, age: 40, sex: 'female' },
      { activityLevel: 'moderate', workoutsPerWeek: 4, avgWorkoutMinutes: 60, workoutIntensity: 'moderate' },
      { goal: 'moderate_cut', peptide: 'none' }
    );
    expect(targetsFromMacroSettings(70, settings)).toEqual({
      calories: rec.calories,
      protein: rec.protein,
      carbs: rec.carbs,
      fat: rec.fat,
    });
  });

  it('builds starter targets for a goal, and refuses without an age', () => {
    const base = { weightKg: 80, heightCm: 180, sex: 'male' as const };
    const cut = starterTargets({ ...base, phase: 'cut', age: 30 });
    const maintain = starterTargets({ ...base, phase: 'maintenance', age: 30 });
    expect(cut?.settings.goal).toBe('moderate_cut');
    expect(cut!.targets.calories).toBeLessThan(maintain!.targets.calories);
    expect(starterTargets({ ...base, phase: 'cut', age: null })).toBeNull();
    expect(starterTargets({ ...base, phase: 'cut', age: 5 })).toBeNull();
    expect(starterTargets({ ...base, phase: 'cut', age: 30, sex: null })).toBeNull();
  });
});

describe('starter targets for someone who does not lift', () => {
  const base = { phase: 'maintenance' as const, weightKg: 72, heightCm: 165, age: 34, sex: 'female' as const };

  it('counts no workouts, so the calories are lower than a lifter\'s', () => {
    const lifter = starterTargets(base)!;
    const foodOnly = starterTargets({ ...base, liftsWeights: false })!;
    expect(foodOnly.settings.workouts_per_week).toBe(0);
    expect(foodOnly.targets.calories).toBeLessThan(lifter.targets.calories);
  });

  it('keeps a stated 0 workouts as 0 when recomputing from saved settings', () => {
    const foodOnly = starterTargets({ ...base, liftsWeights: false })!;
    expect(targetsFromMacroSettings(72, foodOnly.settings).calories).toBe(foodOnly.targets.calories);
  });
});

describe('starterTargets: onboarding training-step answers', () => {
  const base = { phase: 'bulk' as const, weightKg: 80, heightCm: 180, age: 30, sex: 'male' as const };

  it('uses a picked pace in the same direction, and ignores one in the other', () => {
    expect(starterTargets({ ...base, nutritionGoal: 'moderate_bulk' })!.settings.goal).toBe('moderate_bulk');
    expect(starterTargets({ ...base, nutritionGoal: 'moderate_cut' })!.settings.goal).toBe('slow_bulk');
    expect(starterTargets({ ...base, nutritionGoal: null })!.settings.goal).toBe('slow_bulk');
  });

  it('counts the stated days a week as workouts, never for a food-only tracker', () => {
    expect(starterTargets({ ...base, workoutsPerWeek: 6 })!.settings.workouts_per_week).toBe(6);
    expect(starterTargets({ ...base, workoutsPerWeek: null })!.settings.workouts_per_week).toBe(4);
    expect(starterTargets({ ...base, workoutsPerWeek: 6, liftsWeights: false })!.settings.workouts_per_week).toBe(0);
  });

  describe('onboarding extras (UX round 21)', () => {
    const base = { phase: 'bulk' as const, weightKg: 80, heightCm: 180, age: 30, sex: 'male' as const };

    it('sizes protein to the given body fat: the calculator\'s 1 g per lb of lean mass', () => {
      const r = starterTargets({ ...base, bodyFatPercent: 10 })!;
      const direct = calculateMacros(
        { weightKg: 80, heightCm: 180, age: 30, sex: 'male', bodyFatPercent: 10 },
        { activityLevel: 'moderate', workoutsPerWeek: 4, avgWorkoutMinutes: 60, workoutIntensity: 'moderate' },
        { goal: 'slow_bulk', peptide: 'none' }
      );
      expect(r.targets.protein).toBe(direct.protein);
      expect(r.targets.protein).toBe(159); // 80 kg × 0.9 = 72 kg lean = 158.7 lb
      expect(r.protein).toMatchObject({ perLbLeanMass: 1, fromBodyFat: true, setByHand: false });
      expect(r.protein.leanMassKg).toBeCloseTo(72, 5);
      // Without one: the calculator's assumed 20%.
      const assumed = starterTargets(base)!;
      expect(assumed.targets.protein).toBe(141);
      expect(assumed.protein.fromBodyFat).toBe(false);
    });

    it('passes a typed kg-a-week pace through, only in the phase\'s direction', () => {
      const r = starterTargets({ ...base, weeklyChangeKg: 0.25 })!;
      expect(r.targetWeightChangePerWeek).toBe(0.25);
      const preset = starterTargets(base)!; // lean bulk = 0.2 kg/wk at 80 kg
      expect(r.targets.calories).toBeGreaterThan(preset.targets.calories);
      expect(starterTargets({ ...base, weeklyChangeKg: -0.25 })!.targetWeightChangePerWeek).toBeNull();
      expect(starterTargets({ ...base, phase: 'maintenance', weightKg: 80, weeklyChangeKg: 0.25 })!.targetWeightChangePerWeek).toBeNull();
    });

    it('a hand-set protein keeps calories and moves carbs', () => {
      const calc = starterTargets(base)!;
      const r = starterTargets({ ...base, proteinG: 180 })!;
      expect(r.targets.protein).toBe(180);
      expect(r.targets.calories).toBe(calc.targets.calories);
      expect(r.targets.carbs).toBe(calc.targets.carbs - (180 - calc.targets.protein));
      expect(r.protein).toMatchObject({ setByHand: true, calculated: calc.targets.protein });
      // Out of range or equal to the calculated figure: ignored.
      expect(starterTargets({ ...base, proteinG: 5 })!.protein.setByHand).toBe(false);
      expect(starterTargets({ ...base, proteinG: calc.targets.protein })!.protein.setByHand).toBe(false);
    });

    it('never takes carbs below zero', () => {
      const t = withProteinOverride({ calories: 2000, protein: 150, carbs: 20, fat: 60 }, 200);
      expect(t).toEqual({ calories: 200 * 4 + 0 + 60 * 9, protein: 200, carbs: 0, fat: 60 });
    });
  });
});
