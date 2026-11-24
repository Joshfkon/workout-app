import {
  addLoggedRowsToFrequentFoods,
  buildFrequentFoods,
  formatPortion,
  frequentFoodPortion,
  quickAddMessage,
  addedToMealMessage,
  quickAddConfirmation,
  mealTypeForHour,
  type FrequentFoodRow,
} from '../frequentFoods';
import type { FrequentFood } from '@/types/nutrition';

const NOW = '2026-07-12T10:00:00.000Z';

function row(o: Partial<FrequentFoodRow>): FrequentFoodRow {
  return {
    meal_type: 'breakfast', food_name: 'Eggs', serving_size: '1 large (50g)', servings: 1,
    calories: 78, protein: 6, carbs: 0.6, fat: 5, source: 'usda', food_id: '123', ...o,
  };
}

describe('buildFrequentFoods', () => {
  it('keeps the newest logged row as the one-tap portion, exactly as logged', () => {
    // Rows arrive newest first.
    const foods = buildFrequentFoods(
      [
        row({ serving_size: '2 large (100g)', servings: 2, calories: 156, protein: 12, carbs: 1.2, fat: 10 }),
        row({ serving_size: '1 large (50g)', servings: 1, calories: 78 }),
      ],
      'u1',
      NOW
    );
    expect(foods).toHaveLength(1);
    expect(foods[0].times_logged).toBe(2);
    // Label and macros describe the same amount: 2 eggs, 156 cal, servings 2.
    expect(frequentFoodPortion(foods[0])).toEqual({
      serving_size: '2 large (100g)', servings: 2, calories: 156, protein: 12, carbs: 1.2, fat: 10,
      source: 'usda', food_id: '123',
    });
    // Per-serving averages are unchanged.
    expect(foods[0].avg_calories).toBe(78);
  });

  it('keeps meals separate', () => {
    const foods = buildFrequentFoods([row({}), row({ meal_type: 'snack' })], 'u1', NOW);
    expect(foods.map((f) => f.meal_type).sort()).toEqual(['breakfast', 'snack']);
  });
});

describe('addLoggedRowsToFrequentFoods', () => {
  it('makes a just-logged row the new one-tap portion', () => {
    const prev = buildFrequentFoods([row({})], 'u1', NOW);
    const next = addLoggedRowsToFrequentFoods(
      prev,
      [{ ...row({ serving_size: '3 large (150g)', servings: 3, calories: 234 }), user_id: 'u1' }],
      NOW
    );
    expect(next[0].times_logged).toBe(2);
    expect(frequentFoodPortion(next[0]).serving_size).toBe('3 large (150g)');
    expect(frequentFoodPortion(next[0]).calories).toBe(234);
    // The previous state is not mutated.
    expect(prev[0].times_logged).toBe(1);
  });
});

describe('frequentFoodPortion fallback (no latest row)', () => {
  it('logs ONE serving at the per-serving average, labelled "1 serving"', () => {
    const food: FrequentFood = {
      user_id: 'u1', meal_type: 'lunch', food_name: 'Soup', serving_size: '2 serving',
      avg_calories: 120.4, avg_protein: 5.04, avg_carbs: 10, avg_fat: 3,
      times_logged: 3, last_logged: NOW,
    };
    expect(frequentFoodPortion(food)).toMatchObject({
      serving_size: '1 serving', servings: 1, calories: 120, protein: 5,
    });
  });
});

describe('formatPortion', () => {
  it.each([
    ['150g', '150 g'],
    ['6 oz', '6 oz'],
    ['1 large egg (50g)', '1 large egg · 50 g'],
    ['2 serving (60g)', '2 servings · 60 g'],
    ['1 serving', '1 serving'],
    ['1 cup', '1 cup'],
    ['', '1 serving'],
    [null, '1 serving'],
  ])('%p → %p', (input, expected) => {
    expect(formatPortion(input)).toBe(expected);
  });
});

it('quickAddMessage names the food, amount and meal', () => {
  expect(quickAddMessage('Oatmeal', '1 cup', 'Lunch')).toBe('Added Oatmeal (1 cup) to Lunch');
  expect(quickAddMessage('Chicken', '200g', 'Dinner')).toBe('Added Chicken (200 g) to Dinner');
});

it('addedToMealMessage names the meal and where the day now stands', () => {
  expect(addedToMealMessage('Dinner', { calories: 1640.4, protein: 120.2 }, { calories: 2400, protein: 180 })).toBe(
    'Added to Dinner · 1,640 / 2,400 kcal · 120 / 180 g protein'
  );
  expect(addedToMealMessage('Snack', { calories: 300, protein: 12 })).toBe('Added to Snack · 300 kcal · 12 g protein');
  expect(addedToMealMessage('Lunch', { calories: 900, protein: 40 }, { calories: null, protein: 150 })).toBe(
    'Added to Lunch · 900 kcal · 40 / 150 g protein'
  );
});

it('quickAddConfirmation says what was added, to which meal, and the day total', () => {
  expect(
    quickAddConfirmation('White Rice', '1 cup', 'Dinner', { calories: 283.2, protein: 11 }, { calories: 1872, protein: 144 })
  ).toEqual({
    added: 'Added White Rice (1 cup) to Dinner',
    totals: 'Day total 283 / 1,872 kcal · 11 / 144 g protein',
    removed: 'Removed White Rice (1 cup) from Dinner',
  });
});

it.each([
  [6, 'breakfast'],
  [10, 'breakfast'],
  [11, 'lunch'],
  [14, 'lunch'],
  [15, 'dinner'],
  [19, 'dinner'],
  [20, 'snack'],
  [23, 'snack'],
] as const)('mealTypeForHour(%p) → %p', (hour, meal) => {
  expect(mealTypeForHour(hour)).toBe(meal);
});
