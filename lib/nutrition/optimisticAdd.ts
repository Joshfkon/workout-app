/**
 * Optimistic food-log adds for Eat's one-tap paths (quick-add chips, the Add
 * food sheet's + buttons).
 *
 * Panel finding (r21, 5 of 6): "little visible confirmation or updated macro
 * totals" after a quick add. The confirmation and the day's totals waited for
 * the insert round trip, so the screen looked unchanged right after the tap.
 * Now a placeholder row goes into the day's cache at once (totals, the meal
 * card and the confirmation all update on the tap), and is swapped for the
 * saved row when the insert lands, or removed if it fails.
 *
 * Pure: no React, no Supabase.
 */

import type { FoodLogEntry, FoodSource, MealType } from '@/types/nutrition';

/** Prefix of a placeholder row's id (never a real uuid). */
export const PENDING_ID_PREFIX = 'pending-';

export function isPendingFoodLogId(id: string): boolean {
  return id.startsWith(PENDING_ID_PREFIX);
}

export interface PendingFoodInput {
  food_name: string;
  serving_size: string | null;
  servings: number;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  meal_type: MealType;
  source?: FoodSource | null;
  food_id?: string | null;
  nutritionix_id?: string | null;
}

/** Placeholder rows for `foods`, shaped like the rows the insert will return. */
export function buildPendingRows(
  foods: PendingFoodInput[],
  opts: { day: string; createdAt: string; nextId: () => string }
): FoodLogEntry[] {
  return foods.map((food) => ({
    id: `${PENDING_ID_PREFIX}${opts.nextId()}`,
    user_id: '',
    logged_at: opts.day,
    meal_type: food.meal_type,
    food_name: food.food_name,
    serving_size: food.serving_size ?? null,
    servings: food.servings,
    calories: food.calories,
    protein: food.protein ?? null,
    carbs: food.carbs ?? null,
    fat: food.fat ?? null,
    source: food.source ?? 'manual',
    food_id: food.food_id ?? null,
    nutritionix_id: food.nutritionix_id ?? null,
    created_at: opts.createdAt,
  }));
}

/**
 * Swap placeholders for the saved rows, in place. `pendingIds[i]` became
 * `saved[i]`. If a refetch dropped the placeholders meanwhile, the saved rows
 * are appended unless the refetch already brought them; never duplicated.
 */
export function reconcileSavedRows(
  prev: FoodLogEntry[],
  pendingIds: string[],
  saved: FoodLogEntry[]
): FoodLogEntry[] {
  const realFor = new Map<string, FoodLogEntry>();
  pendingIds.forEach((id, i) => {
    if (saved[i]) realFor.set(id, saved[i]);
  });
  const seen = new Set<string>();
  const out: FoodLogEntry[] = [];
  for (const entry of prev) {
    // A placeholder with no saved row (shouldn't happen) is dropped.
    const next = pendingIds.includes(entry.id) ? realFor.get(entry.id) : entry;
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
  }
  for (const row of saved) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/** Remove placeholders after a failed save. */
export function dropPendingRows(prev: FoodLogEntry[], pendingIds: string[]): FoodLogEntry[] {
  const ids = new Set(pendingIds);
  return prev.filter((entry) => !ids.has(entry.id));
}

/** Day totals after adding `rows` to `totals` (what the confirmation quotes). */
export function totalsWith(
  totals: { calories: number; protein: number },
  rows: Array<Pick<FoodLogEntry, 'calories' | 'protein'>>
): { calories: number; protein: number } {
  return rows.reduce<{ calories: number; protein: number }>(
    (acc, row) => ({
      calories: acc.calories + (row.calories || 0),
      protein: acc.protein + (row.protein || 0),
    }),
    { calories: totals.calories, protein: totals.protein }
  );
}
