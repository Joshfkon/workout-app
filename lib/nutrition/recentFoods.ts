/**
 * recentFoods — pure derivation of the "Recent" and "Meals" views in the
 * add-food flow from the user's raw food_log rows.
 *
 * Two consumers, ONE query. The Eat page fetches a single trailing-window slice
 * of food_log (see hooks/useRecentFoods) and this module derives both:
 *   - {@link dedupeRecentFoods}: the deduplicated "recently logged" list.
 *   - {@link groupPriorMeals}: prior meals grouped by day → meal for browsing.
 *
 * Everything here is pure (no React, no Supabase) and buckets time exclusively
 * through the localDay module — never raw UTC. That is deliberate: the
 * "Today"/"Yesterday"/"Jul 10" labels must flip on the LOCAL calendar-day
 * boundary, the same class of bug the localDay module was created to kill.
 */

import { localDaysBetween, startOfLocalDay } from '@/lib/date/localDay';
import type { FoodLogEntry, FoodSource, MealNames, MealType } from '@/types/nutrition';

/**
 * How far back the recents/meals query looks and how many distinct foods the
 * recents list keeps. "Last 90 days OR 200 distinct foods, whichever is
 * smaller." Both are single constants so the window is trivial to retune.
 */
export const RECENTS_WINDOW_DAYS = 90;
export const RECENTS_MAX_DISTINCT = 200;

/** Meals browser: initial day span and how many more days each "load more" reveals. */
export const MEALS_INITIAL_DAYS = 14;
export const MEALS_LOAD_MORE_DAYS = 14;

/** Meal display order + fallback labels (overridden by user meal_names). */
const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const DEFAULT_MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/** A single deduped recent food — carries the full snapshot used for quick-add. */
export interface RecentFood {
  /** Stable identity for dedup + React keys. */
  key: string;
  /** The most-recent log entry for this food (the quick-add source of truth). */
  entry: FoodLogEntry;
  food_name: string;
  serving_size: string | null;
  servings: number;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  source: FoodSource | null;
  food_id: string | null;
  /** logged_at (YYYY-MM-DD, local) of the most recent time this food was logged. */
  loggedAt: string;
}

/** A prior meal (one day + one meal slot) with its foods, for the Meals browser. */
export interface PriorMeal {
  /** `${loggedAt}:${mealType}` — stable key for expand state + React keys. */
  key: string;
  loggedAt: string;
  mealType: MealType;
  /** Meal label (user meal_names override, else the default). */
  mealLabel: string;
  /** "Today" / "Yesterday" / "Jul 9" — always via localDay boundaries. */
  dayLabel: string;
  entries: FoodLogEntry[];
  totalCalories: number;
  itemCount: number;
}

/**
 * Identity used to collapse repeat logs of the "same food". Prefer the source
 * food item id (USDA/FatSecret); log rows for custom/manual/system foods carry
 * no id, so fall back to the normalized name. This is why the recents list is a
 * single query + client dedup rather than a per-food lookup.
 */
export function recentFoodKey(entry: {
  food_id?: string | null;
  food_name: string;
}): string {
  if (entry.food_id) return `id:${entry.food_id}`;
  return `name:${entry.food_name.trim().toLowerCase()}`;
}

/** Parse a YYYY-MM-DD local-day string into a local Date (midnight). */
function parseLocalDay(loggedAt: string): Date {
  const [y, m, d] = loggedAt.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Most-recent-first: logged_at desc, then created_at desc as a tiebreak. */
function compareByRecencyDesc(a: FoodLogEntry, b: FoodLogEntry): number {
  if (a.logged_at !== b.logged_at) return a.logged_at < b.logged_at ? 1 : -1;
  const ca = a.created_at || '';
  const cb = b.created_at || '';
  if (ca !== cb) return ca < cb ? 1 : -1;
  return 0;
}

/**
 * Human day label for a logged_at date, bucketed on LOCAL calendar days:
 * "Today", "Yesterday", or "Jul 9" (year appended only when it differs from the
 * reference day's year). `now` is injectable so tests can pin the clock across
 * midnight boundaries.
 */
export function dayLabel(loggedAt: string, now: Date = new Date()): string {
  const entryDay = parseLocalDay(loggedAt);
  const diff = localDaysBetween(entryDay, startOfLocalDay(now));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const sameYear = entryDay.getFullYear() === now.getFullYear();
  return entryDay.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function toRecentFood(key: string, entry: FoodLogEntry): RecentFood {
  return {
    key,
    entry,
    food_name: entry.food_name,
    serving_size: entry.serving_size,
    servings: entry.servings || 1,
    calories: entry.calories || 0,
    protein: entry.protein,
    carbs: entry.carbs,
    fat: entry.fat,
    source: entry.source,
    food_id: entry.food_id,
    loggedAt: entry.logged_at,
  };
}

/**
 * Deduplicate raw log rows into the recents list: each distinct food appears
 * once, represented by its MOST RECENT log (so the quick-add default serving is
 * the last-used one). Same-day repeats are kept as candidates but still collapse
 * to a single row. Capped at `maxDistinct` distinct foods.
 */
export function dedupeRecentFoods(
  entries: FoodLogEntry[],
  maxDistinct: number = RECENTS_MAX_DISTINCT
): RecentFood[] {
  const sorted = [...entries].sort(compareByRecencyDesc);
  const seen = new Map<string, RecentFood>();
  for (const entry of sorted) {
    if (!entry.food_name) continue;
    const key = recentFoodKey(entry);
    if (seen.has(key)) continue;
    seen.set(key, toRecentFood(key, entry));
    if (seen.size >= maxDistinct) break;
  }
  return Array.from(seen.values());
}

/** Case-insensitive name/space-insensitive filter, matching AddFoodModal search. */
export function filterRecentFoods(recents: RecentFood[], query: string): RecentFood[] {
  const q = query.trim().toLowerCase();
  if (!q) return recents;
  const qNoSpace = q.replace(/\s+/g, '');
  return recents.filter((r) => {
    const name = r.food_name.toLowerCase();
    return name.includes(q) || name.replace(/\s+/g, '').includes(qNoSpace);
  });
}

/**
 * Group raw log rows into prior meals (day → meal), reverse-chronological, with
 * meals within a day ordered breakfast→lunch→dinner→snack.
 *
 * @param opts.excludeDay  logged_at to omit (typically the currently-selected
 *                         day, so "prior" means strictly earlier days).
 * @param opts.mealNames   user meal-name overrides for labels.
 * @param opts.now         injectable clock for the day labels.
 */
export function groupPriorMeals(
  entries: FoodLogEntry[],
  opts: { excludeDay?: string | null; mealNames?: MealNames | null; now?: Date } = {}
): PriorMeal[] {
  const { excludeDay = null, mealNames = null, now = new Date() } = opts;
  const byKey = new Map<string, PriorMeal>();

  for (const entry of entries) {
    if (!entry.food_name) continue;
    if (excludeDay && entry.logged_at === excludeDay) continue;
    const mealType = entry.meal_type;
    const key = `${entry.logged_at}:${mealType}`;
    let meal = byKey.get(key);
    if (!meal) {
      meal = {
        key,
        loggedAt: entry.logged_at,
        mealType,
        mealLabel: mealNames?.[mealType] || DEFAULT_MEAL_LABELS[mealType],
        dayLabel: dayLabel(entry.logged_at, now),
        entries: [],
        totalCalories: 0,
        itemCount: 0,
      };
      byKey.set(key, meal);
    }
    meal.entries.push(entry);
    meal.totalCalories += entry.calories || 0;
    meal.itemCount += 1;
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.loggedAt !== b.loggedAt) return a.loggedAt < b.loggedAt ? 1 : -1;
    return MEAL_ORDER.indexOf(a.mealType) - MEAL_ORDER.indexOf(b.mealType);
  });
}

/**
 * Keep only prior meals whose day falls within the visible window (the most
 * recent `visibleDays` distinct logged days). Enables a client-side "load more"
 * over data already fetched — no extra query until the window is exhausted.
 * Returns the sliced meals plus whether more days exist beyond the window.
 */
export function limitPriorMealsByDays(
  meals: PriorMeal[],
  visibleDays: number
): { visible: PriorMeal[]; hasMore: boolean } {
  const days: string[] = [];
  for (const meal of meals) {
    if (!days.includes(meal.loggedAt)) days.push(meal.loggedAt);
  }
  const visibleSet = new Set(days.slice(0, visibleDays));
  const visible = meals.filter((m) => visibleSet.has(m.loggedAt));
  return { visible, hasMore: days.length > visibleSet.size };
}
