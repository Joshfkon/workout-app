/**
 * Meal-section color identities for the Eat tab: breakfast amber, lunch blue,
 * dinner violet, snack teal. Rendered as a subtle LEFT BORDER on the meal
 * cards (never a full colored background — the card structure is unchanged).
 *
 * Theme handling: the classes reference the `meal-*` Tailwind colors, which
 * resolve through CSS variables in app/globals.css — 400-weight hues on the
 * default dark theme, 600-weight on data-theme="light" so the accent keeps
 * >= 3:1 (WCAG non-text) contrast against the card background in BOTH themes.
 * The hex values here mirror those variables purely so the contrast test
 * (lib/nutrition/__tests__/mealAccents.test.ts) can guard them — keep the two
 * in sync when tuning.
 */

import type { MealType } from '@/types/nutrition';

export interface MealAccent {
  /** Left-border accent for the meal card. */
  borderClass: string;
  /** Matching text tint (icon / small label use). */
  textClass: string;
  /** Hex rendered on the DARK theme (mirrors --meal-* in :root). */
  darkHex: string;
  /** Hex rendered on the LIGHT theme (mirrors --meal-* in [data-theme=light]). */
  lightHex: string;
}

/** Card backgrounds the accents sit on (surface-900 in each theme). */
export const MEAL_ACCENT_SURFACES = {
  dark: '#18181b', // rgb(24 24 27)
  light: '#ffffff',
} as const;

export const MEAL_ACCENTS: Record<MealType, MealAccent> = {
  breakfast: {
    borderClass: 'border-l-meal-breakfast',
    textClass: 'text-meal-breakfast',
    darkHex: '#fbbf24', // amber-400
    lightHex: '#d97706', // amber-600
  },
  lunch: {
    borderClass: 'border-l-meal-lunch',
    textClass: 'text-meal-lunch',
    darkHex: '#60a5fa', // blue-400
    lightHex: '#2563eb', // blue-600
  },
  dinner: {
    borderClass: 'border-l-meal-dinner',
    textClass: 'text-meal-dinner',
    darkHex: '#a78bfa', // violet-400
    lightHex: '#7c3aed', // violet-600
  },
  snack: {
    borderClass: 'border-l-meal-snack',
    textClass: 'text-meal-snack',
    darkHex: '#2dd4bf', // teal-400
    lightHex: '#0d9488', // teal-600
  },
};
