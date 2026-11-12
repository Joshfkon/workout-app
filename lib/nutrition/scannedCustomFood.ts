/**
 * Turning a logged barcode scan into a reusable `custom_foods` row.
 *
 * The logged entry describes the WHOLE portion ("2 serving (60g)", 240 kcal,
 * servings = 2). A custom food stores ONE base serving, and its serving text
 * must describe the same amount as its macros — otherwise logging it later by
 * weight scales against the wrong gram basis (60 g → 120 kcal instead of 240).
 */

import { parseServingWeight } from '@/lib/nutrition/servingScaling';

export interface LoggedScan {
  serving_size?: string | null;
  servings?: number | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface ScannedCustomFoodFields {
  serving_size: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

const trim = (n: number) => String(Math.round(n * 10) / 10);

export function customFoodFieldsFromScan(food: LoggedScan): ScannedCustomFoodFields {
  const servings = food.servings && food.servings > 0 ? food.servings : 1;
  const { grams } = parseServingWeight(food.serving_size);

  // The logged text carries the weight of the whole portion; one base serving
  // weighs that divided by the number of servings logged.
  const baseGrams = grams != null && grams > 0 ? grams / servings : null;

  return {
    serving_size: baseGrams != null ? `${trim(baseGrams)}g` : '1 serving',
    calories: Math.round(food.calories / servings),
    protein: Math.round((food.protein / servings) * 10) / 10,
    carbs: Math.round((food.carbs / servings) * 10) / 10,
    fat: Math.round((food.fat / servings) * 10) / 10,
  };
}
