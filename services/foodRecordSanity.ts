/**
 * Food-record sanity checks.
 *
 * A save bug once let an entered *amount* leak into a food record's serving size
 * and the computed *totals* into its per-serving nutrition (e.g. a 140 cal / 85 g
 * fries record rewritten to 26,640 cal per "180 g serving"). This module is the
 * pure detector used by the one-time repair pass (scripts/repair-food-records.ts)
 * and by tests. It only FLAGS records — it never deletes or silently rewrites
 * them; the repair script re-fetches from source where possible and otherwise
 * surfaces the record for manual review.
 */

import { parseServingWeight } from '@/lib/nutrition/servingScaling';

/** Per-serving nutrition is implausible above this many calories. */
export const MAX_PLAUSIBLE_CALORIES_PER_SERVING = 2000;

export interface FoodRecordForSanity {
  food_name?: string | null;
  serving_size?: string | null;
  /** Per-serving values, as stored on a custom_foods row. */
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
}

export interface FoodSanityResult {
  implausible: boolean;
  reasons: string[];
}

/**
 * Inspect a food record's per-serving nutrition for physically impossible
 * values. Returns every reason it looks corrupted (empty when it looks fine).
 */
export function checkFoodRecordSanity(record: FoodRecordForSanity): FoodSanityResult {
  const reasons: string[] = [];

  const calories = record.calories ?? 0;
  const protein = record.protein ?? 0;
  const carbs = record.carbs ?? 0;
  const fat = record.fat ?? 0;

  if (calories < 0 || protein < 0 || carbs < 0 || fat < 0) {
    reasons.push('negative nutrition value');
  }

  if (calories > MAX_PLAUSIBLE_CALORIES_PER_SERVING) {
    reasons.push(`per-serving calories ${Math.round(calories)} exceeds ${MAX_PLAUSIBLE_CALORIES_PER_SERVING}`);
  }

  // Macronutrient mass cannot exceed the serving mass (with a small tolerance
  // for rounding / water-free reporting). Only checkable when grams are known.
  const { grams } = parseServingWeight(record.serving_size);
  const macroGrams = protein + carbs + fat;
  if (grams != null && grams > 0 && macroGrams > grams * 1.05) {
    reasons.push(
      `macros ${Math.round(macroGrams)}g exceed serving weight ${Math.round(grams)}g`
    );
  }

  return { implausible: reasons.length > 0, reasons };
}
