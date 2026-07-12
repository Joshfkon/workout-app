import {
  dedupeRecentFoods,
  filterRecentFoods,
  groupPriorMeals,
  limitPriorMealsByDays,
  dayLabel,
  recentFoodKey,
  RECENTS_MAX_DISTINCT,
} from '../recentFoods';
import type { FoodLogEntry } from '@/types/nutrition';

/** Minimal food_log row factory. */
function entry(overrides: Partial<FoodLogEntry> & { id: string; logged_at: string }): FoodLogEntry {
  return {
    user_id: 'u1',
    meal_type: 'breakfast',
    food_name: 'Oats',
    serving_size: '1 cup',
    servings: 1,
    calories: 300,
    protein: 10,
    carbs: 54,
    fat: 5,
    source: 'manual',
    food_id: null,
    nutritionix_id: null,
    created_at: `${overrides.logged_at}T08:00:00Z`,
    ...overrides,
  } as FoodLogEntry;
}

describe('recentFoodKey', () => {
  it('prefers food_id when present', () => {
    expect(recentFoodKey({ food_id: 'abc', food_name: 'Banana' })).toBe('id:abc');
  });
  it('falls back to normalized name', () => {
    expect(recentFoodKey({ food_id: null, food_name: '  Banana ' })).toBe('name:banana');
  });
});

describe('dedupeRecentFoods', () => {
  it('keeps one row per food, using the MOST RECENT log as the snapshot', () => {
    const rows = [
      entry({ id: 'a', logged_at: '2026-07-10', food_name: 'Rice', servings: 1, calories: 200 }),
      entry({ id: 'b', logged_at: '2026-07-12', food_name: 'Rice', servings: 2, calories: 400 }),
      entry({ id: 'c', logged_at: '2026-07-11', food_name: 'Rice', servings: 1, calories: 200 }),
    ];
    const recents = dedupeRecentFoods(rows);
    expect(recents).toHaveLength(1);
    expect(recents[0].loggedAt).toBe('2026-07-12');
    expect(recents[0].servings).toBe(2); // most-recent serving is the quick-add default
    expect(recents[0].calories).toBe(400);
  });

  it('dedupes by food_id even when names differ, and by name when no id', () => {
    const rows = [
      entry({ id: 'a', logged_at: '2026-07-12', food_id: 'x', food_name: 'Chicken Breast' }),
      entry({ id: 'b', logged_at: '2026-07-11', food_id: 'x', food_name: 'Chicken (raw)' }),
      entry({ id: 'c', logged_at: '2026-07-10', food_id: null, food_name: 'Milk' }),
      entry({ id: 'd', logged_at: '2026-07-09', food_id: null, food_name: 'milk' }),
    ];
    const recents = dedupeRecentFoods(rows);
    expect(recents.map((r) => r.key).sort()).toEqual(['id:x', 'name:milk']);
  });

  it('keeps same-day repeats collapsed but present (dated today)', () => {
    const rows = [
      entry({ id: 'a', logged_at: '2026-07-12', created_at: '2026-07-12T08:00:00Z', food_name: 'Eggs' }),
      entry({ id: 'b', logged_at: '2026-07-12', created_at: '2026-07-12T12:00:00Z', food_name: 'Eggs' }),
    ];
    const recents = dedupeRecentFoods(rows);
    expect(recents).toHaveLength(1);
    expect(recents[0].loggedAt).toBe('2026-07-12');
    expect(recents[0].entry.id).toBe('b'); // later created_at wins the tiebreak
  });

  it('caps at maxDistinct distinct foods', () => {
    const rows = Array.from({ length: 250 }, (_, i) =>
      entry({ id: `id-${i}`, logged_at: '2026-07-12', food_name: `Food ${i}` })
    );
    expect(dedupeRecentFoods(rows)).toHaveLength(RECENTS_MAX_DISTINCT);
    expect(dedupeRecentFoods(rows, 5)).toHaveLength(5);
  });

  it('ignores rows with no food name', () => {
    const rows = [entry({ id: 'a', logged_at: '2026-07-12', food_name: '' })];
    expect(dedupeRecentFoods(rows)).toHaveLength(0);
  });
});

describe('filterRecentFoods', () => {
  const recents = dedupeRecentFoods([
    entry({ id: 'a', logged_at: '2026-07-12', food_name: 'Greek Yogurt' }),
    entry({ id: 'b', logged_at: '2026-07-11', food_name: 'RXBAR' }),
  ]);
  it('filters case-insensitively', () => {
    expect(filterRecentFoods(recents, 'yog').map((r) => r.food_name)).toEqual(['Greek Yogurt']);
  });
  it('matches ignoring spaces (Rx bar → RXBAR)', () => {
    expect(filterRecentFoods(recents, 'rx bar').map((r) => r.food_name)).toEqual(['RXBAR']);
  });
  it('returns all for an empty query', () => {
    expect(filterRecentFoods(recents, '')).toHaveLength(2);
  });
});

describe('groupPriorMeals', () => {
  const rows = [
    entry({ id: 'a', logged_at: '2026-07-11', meal_type: 'lunch', food_name: 'Rice', calories: 200 }),
    entry({ id: 'b', logged_at: '2026-07-11', meal_type: 'lunch', food_name: 'Chicken', calories: 300 }),
    entry({ id: 'c', logged_at: '2026-07-11', meal_type: 'breakfast', food_name: 'Oats', calories: 300 }),
    entry({ id: 'd', logged_at: '2026-07-10', meal_type: 'dinner', food_name: 'Salmon', calories: 280 }),
    entry({ id: 'e', logged_at: '2026-07-12', meal_type: 'breakfast', food_name: 'Toast', calories: 150 }),
  ];
  const now = new Date(2026, 6, 12, 10, 0, 0); // Jul 12 2026, local

  it('groups by day then meal, reverse-chronological, meals in canonical order', () => {
    const meals = groupPriorMeals(rows, { now });
    // Jul 12 (breakfast), Jul 11 (breakfast, lunch), Jul 10 (dinner)
    expect(meals.map((m) => m.key)).toEqual([
      '2026-07-12:breakfast',
      '2026-07-11:breakfast',
      '2026-07-11:lunch',
      '2026-07-10:dinner',
    ]);
  });

  it('summarizes calories + item count per meal', () => {
    const meals = groupPriorMeals(rows, { now });
    const lunch = meals.find((m) => m.key === '2026-07-11:lunch')!;
    expect(lunch.totalCalories).toBe(500);
    expect(lunch.itemCount).toBe(2);
    expect(lunch.entries.map((e) => e.food_name)).toEqual(['Rice', 'Chicken']);
  });

  it('excludes the selected day', () => {
    const meals = groupPriorMeals(rows, { now, excludeDay: '2026-07-12' });
    expect(meals.some((m) => m.loggedAt === '2026-07-12')).toBe(false);
  });

  it('applies user meal-name overrides', () => {
    const meals = groupPriorMeals(rows, { now, mealNames: { breakfast: 'Morning Fuel' } });
    expect(meals.find((m) => m.mealType === 'breakfast')!.mealLabel).toBe('Morning Fuel');
    expect(meals.find((m) => m.mealType === 'lunch')!.mealLabel).toBe('Lunch');
  });
});

describe('limitPriorMealsByDays', () => {
  const rows = Array.from({ length: 6 }, (_, i) =>
    entry({ id: `d${i}`, logged_at: `2026-07-${String(12 - i).padStart(2, '0')}`, meal_type: 'dinner', food_name: `Meal ${i}` })
  );
  const meals = groupPriorMeals(rows, { now: new Date(2026, 6, 12, 10) });

  it('shows only the most recent N distinct days and reports hasMore', () => {
    const { visible, hasMore } = limitPriorMealsByDays(meals, 3);
    expect(new Set(visible.map((m) => m.loggedAt)).size).toBe(3);
    expect(hasMore).toBe(true);
  });
  it('hasMore is false once the window covers every day', () => {
    expect(limitPriorMealsByDays(meals, 6).hasMore).toBe(false);
    expect(limitPriorMealsByDays(meals, 99).hasMore).toBe(false);
  });
});

describe('dayLabel — localDay boundaries', () => {
  it('labels Today / Yesterday / date relative to now', () => {
    const now = new Date(2026, 6, 12, 15, 0, 0); // Jul 12 2026 3pm local
    expect(dayLabel('2026-07-12', now)).toBe('Today');
    expect(dayLabel('2026-07-11', now)).toBe('Yesterday');
    expect(dayLabel('2026-07-09', now)).toBe('Jul 9');
  });

  it('appends the year only when it differs from now', () => {
    const now = new Date(2026, 0, 2, 12, 0, 0); // Jan 2 2026
    expect(dayLabel('2025-12-30', now)).toBe('Dec 30, 2025');
  });

  it('flips Today→Yesterday exactly on the LOCAL midnight boundary', () => {
    // 23:59 on Jul 12: an entry logged Jul 12 is still "Today".
    const justBeforeMidnight = new Date(2026, 6, 12, 23, 59, 0);
    expect(dayLabel('2026-07-12', justBeforeMidnight)).toBe('Today');
    // 00:01 on Jul 13: the SAME entry is now "Yesterday" — no UTC drift.
    const justAfterMidnight = new Date(2026, 6, 13, 0, 1, 0);
    expect(dayLabel('2026-07-12', justAfterMidnight)).toBe('Yesterday');
  });
});
