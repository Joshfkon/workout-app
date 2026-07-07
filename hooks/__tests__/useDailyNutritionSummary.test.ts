import { computeDailyNutritionSummary } from '../useDailyNutritionSummary';
import type { FoodLogEntry, NutritionTargets } from '@/types/nutrition';

function entry(macros: Partial<Pick<FoodLogEntry, 'calories' | 'protein' | 'carbs' | 'fat'>>): FoodLogEntry {
  return {
    id: 'id',
    user_id: 'user',
    logged_at: '2026-07-07',
    meal_type: 'lunch',
    food_name: 'Test Food',
    serving_size: '1 serving',
    servings: 1,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    source: 'manual',
    food_id: null,
    nutritionix_id: null,
    created_at: '2026-07-07T12:00:00Z',
    ...macros,
  };
}

function targets(overrides: Partial<NutritionTargets> = {}): NutritionTargets {
  return {
    id: 'targets-id',
    user_id: 'user',
    calories: 2200,
    protein: 155,
    carbs: 250,
    fat: 70,
    meals_per_day: 3,
    meal_names: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('computeDailyNutritionSummary', () => {
  it('sums totals across entries, treating null macros as zero', () => {
    const summary = computeDailyNutritionSummary(
      [entry({ calories: 500, protein: 40, carbs: 50, fat: 15 }), entry({ calories: 300, protein: null, carbs: 20, fat: null })],
      targets()
    );
    expect(summary.totals).toEqual({ calories: 800, protein: 40, carbs: 70, fat: 15 });
  });

  it('reports remaining calories and capped fill percentage', () => {
    const summary = computeDailyNutritionSummary([entry({ calories: 1983 })], targets());
    expect(summary.remainingCalories).toBe(217);
    expect(summary.overCalorieBudget).toBe(false);
    expect(summary.caloriePct).toBeCloseTo((1983 / 2200) * 100);
  });

  it('goes negative and caps the bar at 100% when over budget', () => {
    const summary = computeDailyNutritionSummary([entry({ calories: 2340 })], targets());
    expect(summary.remainingCalories).toBe(-140);
    expect(summary.overCalorieBudget).toBe(true);
    expect(summary.caloriePct).toBe(100);
  });

  it('handles an empty day: remaining equals the full target', () => {
    const summary = computeDailyNutritionSummary([], targets());
    expect(summary.remainingCalories).toBe(2200);
    expect(summary.caloriePct).toBe(0);
    expect(summary.protein).toEqual({ state: 'remaining', grams: 155 });
  });

  it('has no targets when calorie target is missing', () => {
    const summary = computeDailyNutritionSummary([entry({ calories: 500 })], null);
    expect(summary.hasTargets).toBe(false);
    expect(summary.protein).toEqual({ state: 'none' });

    const noCalories = computeDailyNutritionSummary([], targets({ calories: null }));
    expect(noCalories.hasTargets).toBe(false);
  });

  describe('macro verdicts', () => {
    it('shows grams remaining when under target', () => {
      const summary = computeDailyNutritionSummary([entry({ protein: 112.4, carbs: 93, fat: 40 })], targets());
      expect(summary.protein).toEqual({ state: 'remaining', grams: 43 });
      expect(summary.carbs).toEqual({ state: 'remaining', grams: 157 });
      expect(summary.fat).toEqual({ state: 'remaining', grams: 30 });
    });

    it('marks protein as hit at or above target, never over', () => {
      const atTarget = computeDailyNutritionSummary([entry({ protein: 155 })], targets());
      expect(atTarget.protein).toEqual({ state: 'hit' });

      const overTarget = computeDailyNutritionSummary([entry({ protein: 194 })], targets());
      expect(overTarget.protein).toEqual({ state: 'hit' });
    });

    it('marks carbs/fat over only when strictly above target', () => {
      const atTarget = computeDailyNutritionSummary([entry({ carbs: 250, fat: 70 })], targets());
      expect(atTarget.carbs).toEqual({ state: 'remaining', grams: 0 });
      expect(atTarget.fat).toEqual({ state: 'remaining', grams: 0 });

      const over = computeDailyNutritionSummary([entry({ carbs: 260, fat: 77 })], targets());
      expect(over.carbs).toEqual({ state: 'over', grams: 10 });
      expect(over.fat).toEqual({ state: 'over', grams: 7 });
    });

    it('returns none for a macro with no target', () => {
      const summary = computeDailyNutritionSummary([entry({ carbs: 100 })], targets({ carbs: null }));
      expect(summary.carbs).toEqual({ state: 'none' });
    });
  });
});
