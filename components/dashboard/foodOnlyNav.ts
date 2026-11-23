/**
 * The primary tabs for a food-only user (hooks/useTrackingFocus): Train is
 * swapped for Weight — weigh-ins, the weight trend and nutrition trends
 * (/dashboard/nutrition/trends) — so the bar keeps five useful tabs and none
 * leads to workouts they don't do. Shared by the bottom nav and the sidebar.
 * Lifters get their items back untouched.
 */

export const WEIGHT_TAB_HREF = '/dashboard/nutrition/trends';
export const TRAIN_TAB_HREF = '/dashboard/train';
const EAT_TAB_HREF = '/dashboard/nutrition';

interface SwappableItem {
  name: string;
  href: string;
  matchPaths?: string[];
  /** Paths under this item's section that belong to another tab. */
  excludePaths?: string[];
}

export function primaryTabsFor<T extends SwappableItem>(
  items: readonly T[],
  foodOnly: boolean,
  /** Anything else the Weight tab needs (its icon). */
  weightTab: Partial<T>
): T[] {
  if (!foodOnly) return [...items];
  return items.map((item) => {
    if (item.href === TRAIN_TAB_HREF) {
      return { ...item, ...weightTab, name: 'Weight', href: WEIGHT_TAB_HREF, matchPaths: [WEIGHT_TAB_HREF] } as T;
    }
    if (item.href === EAT_TAB_HREF) {
      // Weight now owns the trends page; Eat keeps the rest of Nutrition.
      return { ...item, excludePaths: [...(item.excludePaths ?? []), WEIGHT_TAB_HREF] };
    }
    return item;
  });
}

/** Is `pathname` inside `item`'s section? (`exact` = only the href itself.) */
export function isTabActive(
  item: SwappableItem & { exact?: boolean },
  pathname: string
): boolean {
  const within = (path: string) => pathname === path || pathname.startsWith(path + '/');
  if (item.exact) return pathname === item.href;
  if (item.excludePaths?.some(within)) return false;
  return (item.matchPaths || [item.href]).some(within);
}
