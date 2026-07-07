'use client';

import { useMemo } from 'react';
import type { FoodLogEntry, NutritionTargets } from '@/types/nutrition';

export interface DailyMacroTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * Verdict for a single macro, ready for display:
 * - `remaining`: under target — show grams left
 * - `hit`: at/over target where that's a win (protein only)
 * - `over`: past target where that's a miss (carbs/fat) — show grams over
 * - `none`: no target set for this macro
 */
export type MacroVerdict =
  | { state: 'remaining'; grams: number }
  | { state: 'hit' }
  | { state: 'over'; grams: number }
  | { state: 'none' };

export interface DailyNutritionSummary {
  totals: DailyMacroTotals;
  hasTargets: boolean;
  targetCalories: number | null;
  /** Raw gram targets for the labeled progress bars ("Protein 194 / 155g") */
  targetGrams: { protein: number | null; carbs: number | null; fat: number | null };
  /** Rounded kcal remaining; negative when over budget */
  remainingCalories: number;
  overCalorieBudget: boolean;
  /** Calorie fill percentage, capped at 100 */
  caloriePct: number;
  protein: MacroVerdict;
  carbs: MacroVerdict;
  fat: MacroVerdict;
}

/** Protein overage is fine — at/over target is a "hit", never flagged as over. */
function proteinVerdict(consumed: number, target: number | null | undefined): MacroVerdict {
  if (!target || target <= 0) return { state: 'none' };
  if (consumed >= target) return { state: 'hit' };
  return { state: 'remaining', grams: Math.round(target - consumed) };
}

/** Carbs/fat: strictly over target is a miss. */
function capVerdict(consumed: number, target: number | null | undefined): MacroVerdict {
  if (!target || target <= 0) return { state: 'none' };
  if (consumed > target) return { state: 'over', grams: Math.round(consumed - target) };
  return { state: 'remaining', grams: Math.round(target - consumed) };
}

/**
 * Pure derivation of the daily nutrition summary from the day's food log
 * entries and the user's targets. Single source of truth for the hero
 * MacroSummaryCard and the sticky remaining-macros bar — the numbers here
 * intentionally use the same rounding as the hero card.
 */
export function computeDailyNutritionSummary(
  entries: FoodLogEntry[],
  targets: NutritionTargets | null
): DailyNutritionSummary {
  const totals = entries.reduce(
    (acc, entry) => ({
      calories: acc.calories + (entry.calories || 0),
      protein: acc.protein + (entry.protein || 0),
      carbs: acc.carbs + (entry.carbs || 0),
      fat: acc.fat + (entry.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const targetCalories = targets?.calories || null;
  const hasTargets = !!targetCalories;
  const remainingCalories = targetCalories ? Math.round(targetCalories - totals.calories) : 0;
  const caloriePct = targetCalories ? Math.min((totals.calories / targetCalories) * 100, 100) : 0;

  return {
    totals,
    hasTargets,
    targetCalories,
    targetGrams: {
      protein: targets?.protein || null,
      carbs: targets?.carbs || null,
      fat: targets?.fat || null,
    },
    remainingCalories,
    overCalorieBudget: hasTargets && remainingCalories < 0,
    caloriePct,
    protein: proteinVerdict(totals.protein, targets?.protein),
    carbs: capVerdict(totals.carbs, targets?.carbs),
    fat: capVerdict(totals.fat, targets?.fat),
  };
}

/** Memoized hook wrapper — recomputes only when entries or targets change. */
export function useDailyNutritionSummary(
  entries: FoodLogEntry[],
  targets: NutritionTargets | null
): DailyNutritionSummary {
  return useMemo(() => computeDailyNutritionSummary(entries, targets), [entries, targets]);
}
