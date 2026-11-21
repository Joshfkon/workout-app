import type { MealType } from '@/types/nutrition';

/**
 * Deep link into Eat's Add food sheet (search, recents, saved meals). Every
 * "Log food" entry point outside Eat uses this so there is one food logger.
 * `meal` omitted = the meal that fits the time of day on arrival.
 */
export function addFoodHref(meal?: MealType): string {
  return `/dashboard/nutrition?add=${meal ?? 'now'}`;
}

const MEALS: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * Reads `?add=` on Eat: null when absent (don't open the sheet), else the meal
 * to open it on, falling back to `fallback` for `now` or anything unknown.
 */
export function mealFromAddParam(param: string | null, fallback: MealType): MealType | null {
  if (!param) return null;
  return (MEALS as readonly string[]).includes(param) ? (param as MealType) : fallback;
}
