/**
 * Frequent foods + the portion a one-tap add will log.
 *
 * A one-tap add (Home "Quick add" chips, "Your foods" + in the add sheet)
 * re-logs the LAST portion of that food exactly as it was logged — serving
 * text, servings and macros from the same row — so what the chip says
 * ("Oatmeal · 1 cup") is what lands in the log. No macros are recomputed here.
 *
 * Pure: no I/O, no clock.
 */

import type { FoodSource, FrequentFood, FrequentFoodPortion, MealType } from '@/types/nutrition';

export interface FrequentFoodRow {
  meal_type: string;
  food_name: string;
  serving_size: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  servings: number | null;
  source?: FoodSource | null;
  food_id?: string | null;
}

/**
 * Group food_log rows (NEWEST FIRST) into per-meal frequent foods. The first
 * row seen for a (meal, name) pair is the most recent one and becomes the
 * one-tap portion; the averages stay per serving as before.
 */
export function buildFrequentFoods(rows: FrequentFoodRow[], userId: string, nowIso: string): FrequentFood[] {
  const byKey = new Map<string, FrequentFood>();
  for (const entry of rows) {
    if (!entry.food_name) continue;
    const key = `${entry.meal_type}:${entry.food_name}`;
    const existing = byKey.get(key);
    const servingsNum = entry.servings || 1;

    if (existing) {
      const totalLogs = existing.times_logged + 1;
      existing.avg_calories = (existing.avg_calories * existing.times_logged + (entry.calories || 0) / servingsNum) / totalLogs;
      existing.avg_protein = (existing.avg_protein * existing.times_logged + (entry.protein || 0) / servingsNum) / totalLogs;
      existing.avg_carbs = (existing.avg_carbs * existing.times_logged + (entry.carbs || 0) / servingsNum) / totalLogs;
      existing.avg_fat = (existing.avg_fat * existing.times_logged + (entry.fat || 0) / servingsNum) / totalLogs;
      existing.times_logged = totalLogs;
    } else {
      byKey.set(key, newFrequentFood(entry, userId, nowIso));
    }
  }
  return Array.from(byKey.values());
}

function portionOf(row: FrequentFoodRow): FrequentFoodPortion {
  return {
    serving_size: row.serving_size || '1 serving',
    servings: row.servings || 1,
    calories: row.calories || 0,
    protein: row.protein || 0,
    carbs: row.carbs || 0,
    fat: row.fat || 0,
    source: row.source ?? null,
    food_id: row.food_id ?? null,
  };
}

function newFrequentFood(row: FrequentFoodRow, userId: string, nowIso: string): FrequentFood {
  const servingsNum = row.servings || 1;
  return {
    user_id: userId,
    meal_type: row.meal_type as MealType,
    food_name: row.food_name,
    serving_size: row.serving_size,
    avg_calories: (row.calories || 0) / servingsNum,
    avg_protein: (row.protein || 0) / servingsNum,
    avg_carbs: (row.carbs || 0) / servingsNum,
    avg_fat: (row.fat || 0) / servingsNum,
    times_logged: 1,
    last_logged: nowIso,
    latest: portionOf(row),
  };
}

/**
 * Fold just-logged rows into the frequent foods without a refetch. A new row
 * is the newest log of its food, so it becomes that food's one-tap portion.
 */
export function addLoggedRowsToFrequentFoods(
  prev: FrequentFood[],
  rows: Array<FrequentFoodRow & { user_id: string }>,
  nowIso: string
): FrequentFood[] {
  const map = new Map(prev.map((f) => [`${f.meal_type}:${f.food_name}`, { ...f }]));
  for (const row of rows) {
    if (!row.food_name) continue;
    const key = `${row.meal_type}:${row.food_name}`;
    const servingsNum = row.servings || 1;
    const existing = map.get(key);
    if (existing) {
      const totalLogs = existing.times_logged + 1;
      existing.avg_calories = (existing.avg_calories * existing.times_logged + (row.calories || 0) / servingsNum) / totalLogs;
      existing.avg_protein = (existing.avg_protein * existing.times_logged + (row.protein || 0) / servingsNum) / totalLogs;
      existing.avg_carbs = (existing.avg_carbs * existing.times_logged + (row.carbs || 0) / servingsNum) / totalLogs;
      existing.avg_fat = (existing.avg_fat * existing.times_logged + (row.fat || 0) / servingsNum) / totalLogs;
      existing.times_logged = totalLogs;
      existing.last_logged = nowIso;
      existing.serving_size = row.serving_size;
      existing.latest = portionOf(row);
    } else {
      map.set(key, newFrequentFood(row, row.user_id, nowIso));
    }
  }
  return Array.from(map.values());
}

/**
 * The exact portion a one-tap add of this frequent food logs. Prefers the last
 * logged row; a FrequentFood without one (older cache) falls back to ONE
 * serving at the per-serving average, labelled as such so the text and the
 * macros describe the same amount.
 */
export function frequentFoodPortion(food: FrequentFood): FrequentFoodPortion {
  if (food.latest) return food.latest;
  return {
    serving_size: '1 serving',
    servings: 1,
    calories: Math.round(food.avg_calories),
    protein: Math.round(food.avg_protein * 10) / 10,
    carbs: Math.round(food.avg_carbs * 10) / 10,
    fat: Math.round(food.avg_fat * 10) / 10,
    source: null,
    food_id: null,
  };
}

/**
 * A stored serving_size as people read it: "150g" → "150 g",
 * "1 large egg (50g)" → "1 large egg · 50 g", "2 serving (60g)" →
 * "2 servings · 60 g". Display only; the stored string is never changed.
 */
export function formatPortion(servingSize: string | null | undefined): string {
  const s = (servingSize ?? '').trim();
  if (!s) return '1 serving';

  const bareWeight = s.match(/^([\d.]+)\s*(g|oz|ml)$/i);
  if (bareWeight) return `${bareWeight[1]} ${bareWeight[2].toLowerCase()}`;

  const withGrams = s.match(/^(.*?)\s*\(\s*([\d.]+)\s*g\s*\)$/i);
  if (withGrams && withGrams[1]) {
    return `${pluralServing(withGrams[1])} · ${withGrams[2]} g`;
  }
  return pluralServing(s);
}

/** "2 serving" → "2 servings" (the stored noun is always singular). */
function pluralServing(s: string): string {
  const m = s.match(/^([\d.]+)\s+serving$/i);
  if (m && parseFloat(m[1]) !== 1) return `${m[1]} servings`;
  return s;
}

/** Toast after a one-tap add: "Added Oatmeal (1 cup) to Lunch". */
export function quickAddMessage(foodName: string, servingSize: string | null | undefined, mealLabel: string): string {
  return `Added ${foodName} (${formatPortion(servingSize)}) to ${mealLabel}`;
}

/**
 * Toast after adding a food from the add sheet, with the day's running
 * totals so the add is visible against the goal:
 * "Added to Dinner · 1,640 / 2,400 kcal · 120 / 180 g protein".
 * Without a target the totals stand alone ("1,640 kcal · 120 g protein").
 */
export function addedToMealMessage(
  mealLabel: string,
  totals: { calories: number; protein: number },
  targets: { calories?: number | null; protein?: number | null } = {}
): string {
  return `Added to ${mealLabel} · ${dayTotalsLine(totals, targets)}`;
}

/**
 * The day's running calories and protein against the goal:
 * "1,640 / 2,400 kcal · 120 / 180 g protein" (no goal → "1,640 kcal · …").
 */
export function dayTotalsLine(
  totals: { calories: number; protein: number },
  targets: { calories?: number | null; protein?: number | null } = {}
): string {
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  const kcal = targets.calories && targets.calories > 0
    ? `${fmt(totals.calories)} / ${fmt(targets.calories)} kcal`
    : `${fmt(totals.calories)} kcal`;
  const protein = targets.protein && targets.protein > 0
    ? `${fmt(totals.protein)} / ${fmt(targets.protein)} g protein`
    : `${fmt(totals.protein)} g protein`;
  return `${kcal} · ${protein}`;
}

/**
 * Confirmation shown under the quick-add chips after a one-tap add: what was
 * added, how much, to which meal, and where the day now stands.
 *
 * Panel finding (3 of 6): "there was little feedback that the food was
 * added … I wasn't sure the add worked."
 */
export function quickAddConfirmation(
  foodName: string,
  servingSize: string | null | undefined,
  mealLabel: string,
  dayTotals: { calories: number; protein: number },
  targets: { calories?: number | null; protein?: number | null } = {}
): { added: string; totals: string; removed: string } {
  return {
    added: quickAddMessage(foodName, servingSize, mealLabel),
    totals: `Day total ${dayTotalsLine(dayTotals, targets)}`,
    removed: `Removed ${foodName} (${formatPortion(servingSize)}) from ${mealLabel}`,
  };
}

/**
 * The time-of-day meal a quick add defaults to: before 11:00 breakfast,
 * before 15:00 lunch, before 20:00 dinner, then snacks. `hour` is the local
 * hour (0–23), read from lib/clock by the caller.
 */
export function mealTypeForHour(hour: number): MealType {
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 20) return 'dinner';
  return 'snack';
}
