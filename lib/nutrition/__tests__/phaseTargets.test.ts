import { calculateMacros } from '@/lib/nutrition/macroCalculator';
import {
  phaseToNutritionGoal,
  starterTargets,
  targetsFromMacroSettings,
  STARTER_ACTIVITY_SETTINGS,
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
