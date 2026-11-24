/**
 * Household servings for the built-in system foods.
 *
 * `system_foods` rows only carry per-100g macros, so picking "Whole Eggs"
 * used to default to "100g" — a weight nobody pictures. These are the
 * natural units people count in, with standard USDA gram weights, so the add
 * sheet can default to "1 large egg · 50 g". Foods people genuinely weigh
 * (meat, fish, rice, vegetables) are deliberately absent and keep grams.
 *
 * `count` is how many make a typical portion when that isn't one (2 eggs,
 * 2 slices, the 2 tbsp a nut-butter label lists): the starting amount.
 *
 * Macros are never stored here: a household unit is just grams with a name,
 * scaled from the row's per-100g values (see withHouseholdServing).
 */

import type { HouseholdServing } from './servingScaling';

const SYSTEM_FOOD_HOUSEHOLD_SERVINGS: Record<string, HouseholdServing> = {
  'Whole Eggs (large, cooked)': { noun: 'large egg', grams: 50, count: 2 },
  'Egg Whites (liquid or cooked)': { noun: 'large egg white', grams: 33, count: 3 },
  'Egg Yolk (cooked)': { noun: 'large egg yolk', grams: 17 },
  Banana: { noun: 'medium banana', grams: 118 },
  Apple: { noun: 'medium apple', grams: 182 },
  Orange: { noun: 'medium orange', grams: 131 },
  'Bagel (plain)': { noun: 'bagel', grams: 105 },
  'English Muffin': { noun: 'muffin', grams: 57 },
  'Ezekiel Bread': { noun: 'slice', grams: 34, count: 2 },
  'Tortilla (flour, 10")': { noun: 'tortilla', grams: 72 },
  'Peanut Butter (natural)': { noun: 'tbsp', grams: 16, count: 2 },
  'Almond Butter': { noun: 'tbsp', grams: 16, count: 2 },
  'Cashew Butter': { noun: 'tbsp', grams: 16, count: 2 },
  'Olive Oil': { noun: 'tbsp', grams: 13.5 },
  'Coconut Oil': { noun: 'tbsp', grams: 13.6 },
  Butter: { noun: 'tbsp', grams: 14.2 },
  'Cream Cheese': { noun: 'tbsp', grams: 14.5 },
  'Milk (skim/nonfat)': { noun: 'cup', grams: 245 },
  'Milk (2% fat)': { noun: 'cup', grams: 244 },
  'Milk (whole)': { noun: 'cup', grams: 244 },
};

/** The household serving for a system food, or null when it's weighed. */
export function householdServingForSystemFood(name: string): HouseholdServing | null {
  return SYSTEM_FOOD_HOUSEHOLD_SERVINGS[name.trim()] ?? null;
}
