/**
 * Meal-accent contrast guardrail: every accent must clear WCAG's 3:1
 * non-text contrast against the meal-card background (surface-900) in BOTH
 * themes. These hexes mirror the --meal-* CSS variables in app/globals.css —
 * if a hue gets retuned there, retune it here and this test re-verifies it.
 */

import { MEAL_ACCENTS, MEAL_ACCENT_SURFACES } from '@/lib/nutrition/mealAccents';
import type { MealType } from '@/types/nutrition';

/** WCAG relative luminance of a #rrggbb hex. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two hex colors. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const MEALS = Object.keys(MEAL_ACCENTS) as MealType[];

describe('meal accent contrast', () => {
  it.each(MEALS)('%s accent clears 3:1 on the DARK card background', (meal) => {
    const ratio = contrast(MEAL_ACCENTS[meal].darkHex, MEAL_ACCENT_SURFACES.dark);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it.each(MEALS)('%s accent clears 3:1 on the LIGHT card background', (meal) => {
    const ratio = contrast(MEAL_ACCENTS[meal].lightHex, MEAL_ACCENT_SURFACES.light);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it('gives every meal a distinct color identity in both themes', () => {
    expect(new Set(MEALS.map((m) => MEAL_ACCENTS[m].darkHex)).size).toBe(MEALS.length);
    expect(new Set(MEALS.map((m) => MEAL_ACCENTS[m].lightHex)).size).toBe(MEALS.length);
  });

  it('covers all four meal types', () => {
    expect(MEALS.sort()).toEqual(['breakfast', 'dinner', 'lunch', 'snack']);
  });
});
