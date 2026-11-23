/**
 * Progress page tab selection (pure — no I/O, no React).
 *
 * The page opens on whichever tab applies to the user: a food-only or
 * weigh-in-only user has nothing on Strength, so they land on Body. An
 * explicit choice — a tab the user tapped, or a ?tab= deep link — always
 * wins over the data-driven default.
 */

import type { LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';

export type ProgressTab = 'body-composition' | 'strength' | 'wellness';

export const PROGRESS_TAB_IDS: readonly ProgressTab[] = ['body-composition', 'strength', 'wellness'];

/** The tab used whenever data can't (yet) say otherwise. */
export const FALLBACK_PROGRESS_TAB: ProgressTab = 'strength';

export function parseProgressTabParam(value: string | null): ProgressTab | null {
  // Back-compat aliases so existing home tiles / notifications / deep links
  // keep working after the tab restructures:
  //   body  → Body (friendly alias the Home Weight tile links to)
  //   goals → Body (goal-setting + projections moved here)
  // Retired ids (volume/training) fall through to the default tab.
  if (value === 'body' || value === 'goals') return 'body-composition';
  return value && (PROGRESS_TAB_IDS as readonly string[]).includes(value)
    ? (value as ProgressTab)
    : null;
}

/**
 * Whether the lift-trend summary saw any completed session with working sets.
 * The summary covers LIFT_TREND_WINDOW_DAYS (84 days = 12 weeks) and only
 * counts non-warm-up sets with load and reps, so any tracked or
 * not-yet-trended lift means the user lifted in the last 12 weeks.
 * `undefined` = not known yet (query loading / signed out).
 */
export function hasRecentLifting(
  summary: Pick<LiftTrendsSummary, 'lifts' | 'insufficientData'> | null | undefined
): boolean | undefined {
  if (!summary) return undefined;
  return summary.lifts.length > 0 || summary.insufficientData > 0;
}

export interface DefaultTabSignals {
  /** Completed workouts with working sets in the last 12 weeks; undefined = unknown. */
  hasRecentLifting: boolean | undefined;
  /** Any weigh-in or nutrition log; undefined = unknown. */
  hasBodyOrFoodData: boolean | undefined;
}

/**
 * The data-driven default tab, or null while the signals needed to decide
 * are still loading. A lifter → Strength as soon as that's known; a
 * non-lifter with weigh-ins or food logs → Body; nobody with any data →
 * Strength (its empty state says how to get a trend).
 */
export function resolveDefaultProgressTab({
  hasRecentLifting: lifted,
  hasBodyOrFoodData,
}: DefaultTabSignals): ProgressTab | null {
  if (lifted === true) return 'strength';
  if (lifted === undefined) return null;
  if (hasBodyOrFoodData === undefined) return null;
  return hasBodyOrFoodData ? 'body-composition' : 'strength';
}

/**
 * Which tab is showing. Precedence: the tab the user tapped, then the ?tab=
 * deep link, then the data-driven default, then Strength.
 */
export function resolveActiveProgressTab({
  pickedTab,
  explicitTab,
  dataDefaultTab,
}: {
  pickedTab: ProgressTab | null;
  explicitTab: ProgressTab | null;
  dataDefaultTab: ProgressTab | null;
}): ProgressTab {
  return pickedTab ?? explicitTab ?? dataDefaultTab ?? FALLBACK_PROGRESS_TAB;
}

/**
 * Tab order. Someone who hasn't lifted in the window (food / weigh-in only)
 * gets Body first and Strength last, so an empty Strength tab isn't the
 * first thing offered; everyone else (or not known yet) keeps
 * Strength · Body · Wellness.
 */
export function orderProgressTabs(lifted: boolean | undefined): ProgressTab[] {
  return lifted === false
    ? ['body-composition', 'wellness', 'strength']
    : ['strength', 'body-composition', 'wellness'];
}

/**
 * Beginner mode before any body scan: hide the FFMI ceiling, the FFMI trend
 * option and the "log a DEXA scan" prompt (UX panel: "Jargon such as FFMI
 * and DEXA is shown with no explanation, which is intimidating for a
 * beginner"). Once a scan exists, FFMI shows with its plain explanation.
 */
export function hideBodyScanPrompts(beginnerMode: boolean, scanCount: number): boolean {
  return beginnerMode && scanCount === 0;
}
