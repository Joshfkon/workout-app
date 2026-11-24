/**
 * Onboarding's first screen (units, text size and body). Pure helpers and
 * copy kept out of the page file (Next.js page files may only export the
 * page).
 */
import type { WeightUnit } from '@/types/schema';

const LB_PER_KG = 2.20462;

/**
 * A typed weight carried to the other unit ("80" kg -> "176.4" lb), so
 * switching units on the body screen never re-reads the number. Empty or
 * unparseable text is left as it is.
 */
export function convertWeightText(text: string, from: WeightUnit, to: WeightUnit): string {
  const n = parseFloat(text);
  if (from === to || !text.trim() || !Number.isFinite(n) || n <= 0) return text;
  const converted = to === 'lb' ? n * LB_PER_KG : n / LB_PER_KG;
  return String(Math.round(converted * 10) / 10);
}

/**
 * Why age is asked and why it's optional, under the field (UX round 23:
 * "why age was optional, or that it affected targets"). Calories need it
 * (resting burn changes with age); without it the goal step asks once more,
 * or targets wait for Eat.
 */
export const AGE_WHY =
  'Optional, but your daily calorie target needs it: your resting burn changes with age. Skip it and you can set calories later in Eat.';
