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

import { getUnit, isHouseholdNoun, round2, trimNum, type FoodAmountModel, type UnitMacros } from './servingScaling';

/**
 * Where the starting amount came from: your last log of this food ('last'),
 * the logged row you reopened ('logged'), the food's own serving
 * ('serving'), a typical portion ('typical'), or the model's default ('model').
 */
export type PortionReason = 'last' | 'logged' | 'serving' | 'typical' | 'model';

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
    return { amount: fallback.amount, unitId: fallback.unitId, reason: 'logged' };
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

/** Meat and fish portions are cooked weights: say so. */
const COOKED_SUBCATEGORIES = new Set(['poultry', 'beef', 'pork', 'game', 'fish', 'seafood']);

/** The food's name says it is cooked ("Chicken Breast (grilled, skinless)"). A
 *  raw row ("Chicken Breast (raw, …)") or one that doesn't say must not be
 *  labelled a cooked portion: its nutrition is per raw weight. */
const COOKED_NAME = /\b(cooked|grilled|roasted|baked|boiled|broiled|fried|pan[- ]?fried|steamed|poached|smoked|seared)\b/i;
const RAW_NAME = /\braw\b/i;

/**
 * A picture of the amount for people who don't think in grams. Only where
 * the comparison is a fair one; otherwise the gram figure stands alone.
 */
const HINT_BY_SUBCATEGORY: Record<string, string> = {
  poultry: 'about the size of your palm',
  beef: 'about the size of your palm',
  pork: 'about the size of your palm',
  game: 'about the size of your palm',
  fish: 'about the size of your palm',
  seafood: 'about the size of your palm',
  grains: 'about a cup',
  starches: 'about a cup',
  nuts: 'a small handful',
  protein_powder: 'about one scoop',
};

type SystemFoodLike = { name: string; category?: string | null; subcategory?: string | null };

export interface TypicalPortion {
  grams: number;
  /** True for meat/fish, whose typical portion is a cooked weight. */
  cooked: boolean;
  /** Plain-words picture of the amount ("about the size of your palm"). */
  hint: string | null;
}

/** Typical portion for a system food, with how to picture it, or null. */
export function typicalPortionForSystemFood(food: SystemFoodLike): TypicalPortion | null {
  const sub = food.subcategory ?? null;
  const byName = TYPICAL_BY_NAME[food.name.trim()];
  const grams =
    byName ??
    (sub && TYPICAL_BY_SUBCATEGORY[sub]) ??
    (food.category && TYPICAL_BY_CATEGORY[food.category]) ??
    null;
  if (!grams) return null;
  // A by-name portion (28 g of cheddar) doesn't fit the subcategory's picture.
  const fromSub = !byName && !!sub && !!TYPICAL_BY_SUBCATEGORY[sub];
  return {
    grams,
    cooked: fromSub && COOKED_SUBCATEGORIES.has(sub!) && COOKED_NAME.test(food.name) && !RAW_NAME.test(food.name),
    hint: fromSub ? HINT_BY_SUBCATEGORY[sub!] ?? null : null,
  };
}

/** Typical portion for a system food, or null when we don't know one. */
export function typicalPortionGramsForSystemFood(food: SystemFoodLike): number | null {
  return typicalPortionForSystemFood(food)?.grams ?? null;
}

const GRAMS_PER_OZ = 28.3495;

/**
 * One plain line saying what the starting amount is and where it came from,
 * with its calories and protein, e.g.
 *   "113 g · about 4 oz, a typical cooked portion · 186 kcal, 35 g protein"
 *   "1 large egg (the food's serving) · 78 kcal, 6 g protein"
 *   "150 g · what you logged last time · 248 kcal, 47 g protein"
 *
 * Panel finding (6/6): "The default portion size for chicken wasn't
 * explained. I just accepted it without knowing how much it was."
 *
 * Returns null for a bare model default in grams (100 g is the unit the data
 * is stored in, not a portion; the editor says "No standard serving").
 * `units` is the user's weight preference: imperial users get the ounce
 * equivalent of a gram amount, metric users the plain-words picture.
 */
export function describeDefaultPortion(
  portion: DefaultPortion,
  model: FoodAmountModel,
  opts: { units?: 'lb' | 'kg' | null; typical?: TypicalPortion | null; macros: UnitMacros }
): string | null {
  const unit = getUnit(model, portion.unitId);
  const amount = `${trimNum(portion.amount)} ${unit.noun}`;
  const numbers = `${Math.round(opts.macros.calories)} kcal, ${Math.round(opts.macros.protein)} g protein`;

  let source: string;
  switch (portion.reason) {
    case 'last':
    case 'logged':
      source = `${amount} · what you logged last time`;
      break;
    case 'serving':
      source = `${amount} (the food's serving)`;
      break;
    case 'typical': {
      const typical = opts.typical ?? null;
      const what = `a typical ${typical?.cooked ? 'cooked ' : ''}portion`;
      const imperial = opts.units !== 'kg' && unit.id === 'g';
      const parts: string[] = [];
      if (imperial) {
        const oz = Math.round((portion.amount / GRAMS_PER_OZ) * 2) / 2;
        parts.push(`about ${trimNum(oz)} oz, ${what}`);
      } else {
        parts.push(what);
      }
      if (typical?.hint) parts.push(typical.hint);
      source = `${amount} · ${parts.join(', ')}`;
      break;
    }
    case 'model':
    default:
      if (unit.kind === 'weight') return null;
      source = `${amount} (the food's listed serving)`;
  }
  return `${source} · ${numbers}`;
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
