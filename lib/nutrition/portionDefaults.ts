/**
 * The portion the add sheet opens on, before the user touches anything.
 *
 * Panel finding: "Searched foods add at a 100g default." 100 g is the unit
 * the nutrition data is stored in, not an amount anyone eats. The order is:
 *
 *   1. what YOU logged last time for this food (amount + unit), when that
 *      unit still exists for it;
 *   2. the food's own serving when it has a real one ("1 large egg",
 *      "1 bar", "1 cup (160g)");
 *   3. a typical portion for foods people weigh (4 oz of chicken, 150 g of
 *      cooked rice), still in grams so the number is editable as a weight;
 *   4. whatever the model says (the last resort, usually 100 g).
 *
 * Pure: no storage, no clock. The caller passes the last-used value in.
 */

import { isHouseholdNoun, round2, type FoodAmountModel } from './servingScaling';

export type PortionReason = 'last' | 'serving' | 'typical' | 'model';

export interface DefaultPortion {
  amount: number;
  unitId: string;
  reason: PortionReason;
}

/**
 * The starting amount + unit for a food in the add sheet. See the file
 * comment for the precedence.
 */
export function defaultPortion(
  model: FoodAmountModel,
  opts: {
    lastUsed?: { amount: number; unitId: string } | null;
    /** Typical portion in grams for a weighed food, when known. */
    typicalGrams?: number | null;
    /** Override the model's default (e.g. a logged entry's own portion). */
    fallback?: { amount: number; unitId: string } | null;
  } = {}
): DefaultPortion {
  const { lastUsed, typicalGrams, fallback } = opts;
  const hasUnit = (id: string) => model.units.some((u) => u.id === id);

  if (lastUsed && hasUnit(lastUsed.unitId) && Number.isFinite(lastUsed.amount) && lastUsed.amount > 0) {
    return { amount: lastUsed.amount, unitId: lastUsed.unitId, reason: 'last' };
  }

  if (fallback && hasUnit(fallback.unitId) && fallback.amount > 0) {
    return { amount: fallback.amount, unitId: fallback.unitId, reason: 'model' };
  }

  const defaultUnit = model.units.find((u) => u.id === model.defaultUnitId) ?? model.units[0];
  if (defaultUnit && defaultUnit.kind === 'serving' && isHouseholdNoun(defaultUnit.noun)) {
    return { amount: model.defaultAmount, unitId: defaultUnit.id, reason: 'serving' };
  }

  if (typicalGrams && typicalGrams > 0 && defaultUnit?.kind === 'weight' && hasUnit('g')) {
    return { amount: round2(typicalGrams), unitId: 'g', reason: 'typical' };
  }

  return { amount: model.defaultAmount, unitId: model.defaultUnitId, reason: 'model' };
}

/**
 * Typical portions (grams) for the built-in foods people WEIGH. Household
 * foods (eggs, bread, fruit) are in householdServings.ts and win over these.
 * Values are common single-meal portions: 4 oz (113 g) of cooked meat or
 * fish, a cup of cooked grains, a 1 oz handful of nuts, a scoop of powder.
 */
const TYPICAL_BY_NAME: Record<string, number> = {
  'Oats (dry/raw)': 40,
  'Oatmeal (cooked/prepared)': 234,
  'Cream of Rice (cooked)': 240,
  'Greek Yogurt (nonfat, plain)': 170,
  'Greek Yogurt (2% fat, plain)': 170,
  'Cottage Cheese (nonfat)': 113,
  'Cottage Cheese (2% fat)': 113,
  'Cottage Cheese (4% fat)': 113,
  'Mozzarella (part skim)': 28,
  'Cheddar Cheese': 28,
  'Parmesan (grated)': 5,
  'Turkey Breast (deli sliced)': 56,
  Avocado: 75,
};

const TYPICAL_BY_SUBCATEGORY: Record<string, number> = {
  poultry: 113,
  beef: 113,
  pork: 113,
  game: 113,
  fish: 113,
  seafood: 113,
  grains: 150,
  starches: 150,
  nuts: 28,
  protein_powder: 30,
};

const TYPICAL_BY_CATEGORY: Record<string, number> = {
  vegetables: 85,
  fruits: 140,
};

/** Typical portion for a system food, or null when we don't know one. */
export function typicalPortionGramsForSystemFood(food: {
  name: string;
  category?: string | null;
  subcategory?: string | null;
}): number | null {
  const byName = TYPICAL_BY_NAME[food.name.trim()];
  if (byName) return byName;
  if (food.subcategory && TYPICAL_BY_SUBCATEGORY[food.subcategory]) {
    return TYPICAL_BY_SUBCATEGORY[food.subcategory];
  }
  if (food.category && TYPICAL_BY_CATEGORY[food.category]) {
    return TYPICAL_BY_CATEGORY[food.category];
  }
  return null;
}

/**
 * One − / + press on the amount stepper. Servings move by ½, grams by 10,
 * ounces by ½. Never goes to zero or below: the smallest result is one step.
 */
export function stepAmount(
  current: string | number,
  unit: { id: string; kind: 'weight' | 'serving' },
  direction: 1 | -1
): number {
  const step = unit.kind === 'weight' && unit.id !== 'oz' ? 10 : 0.5;
  const n = typeof current === 'number' ? current : parseFloat(current);
  const base = Number.isFinite(n) && n > 0 ? n : 0;
  // Snap to the step grid first, so 113 g + 10 → 120 g and − 10 → 110 g.
  const snapped =
    direction > 0 ? Math.floor(base / step + 1e-9) * step + step : Math.ceil(base / step - 1e-9) * step - step;
  return round2(Math.max(step, snapped));
}
