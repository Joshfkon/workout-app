/**
 * What a new user said they're here for, captured at sign-up.
 *
 * The register form's "Do you lift weights?" question has a "No, food
 * tracking" answer; it is stored in the auth user's metadata as
 * `tracking_focus: 'food'`. Home reads it so a brand-new food tracker (no
 * food or weigh-ins logged yet, so nothing for homeFocus to go on) lands on
 * food first instead of "Ready to train?". Anything else — a skipped
 * question, an OAuth sign-up, a lifter — is null and changes nothing.
 */
export const TRACKING_FOCUS_METADATA_KEY = 'tracking_focus';

export type StatedTrackingFocus = 'food';

export function statedTrackingFocus(userMetadata: unknown): StatedTrackingFocus | null {
  if (!userMetadata || typeof userMetadata !== 'object') return null;
  const value = (userMetadata as Record<string, unknown>)[TRACKING_FOCUS_METADATA_KEY];
  return value === 'food' ? 'food' : null;
}

/**
 * Where onboarding goes after the goal step. Lifters continue to the
 * strength benchmarks; a food-only user finishes onboarding there and lands
 * on the dashboard (benchmark lifts mean nothing to someone who doesn't
 * lift). A food-only user can still reach the benchmarks on purpose: entry
 * points that offer strength calibration link to
 * {@link ONBOARDING_BENCHMARKS_ENTRY}, whose query flag means "I want the
 * benchmarks".
 */
export function skipsBenchmarks(
  focus: StatedTrackingFocus | null,
  askedForBenchmarks: boolean
): boolean {
  return focus === 'food' && !askedForBenchmarks;
}

/** Query flag: the user came to onboarding to calibrate strength. */
export const BENCHMARKS_INTENT_PARAM = 'benchmarks';

/** Onboarding entry for "calibrate my strength" links (always reaches benchmarks). */
export const ONBOARDING_BENCHMARKS_ENTRY = `/onboarding?${BENCHMARKS_INTENT_PARAM}=1`;

/**
 * Food-only mode: someone who said "No, food tracking" at sign-up and has
 * not lifted with the app. The lifting UI steps back for them: the Train tab
 * becomes Weight, Home drops its workout entries, Progress drops strength /
 * FFMI / body-scan prompts (Strength stays reachable, last).
 *
 * Lifting comes back on when they switch on "I also lift weights"
 * (users.preferences.alsoLifts) or complete a workout — any completed
 * workout, or after switching lifting off, one completed after that
 * (`liftingOffAt`). Unknown workout history counts as lifting: a lifter must
 * never lose the Train tab to a slow query.
 *
 * Read it ONLY through hooks/useTrackingFocus.
 */
export const ALSO_LIFTS_PREFERENCE_KEY = 'alsoLifts';
export const LIFTING_OFF_AT_PREFERENCE_KEY = 'liftingOffAt';

export const ALSO_LIFTS_TITLE = 'I also lift weights';
export const ALSO_LIFTS_DESCRIPTION =
  'Shows workouts, the Train tab and strength progress. Turns on by itself when you log a workout.';

export interface FoodOnlyInput {
  statedFocus: StatedTrackingFocus | null | undefined;
  /** users.preferences.alsoLifts */
  alsoLifts: boolean | null | undefined;
  /**
   * A completed workout exists (after liftingOffAt, when set); undefined
   * while unknown.
   */
  hasCompletedWorkout: boolean | undefined;
}

export function resolveFoodOnly({ statedFocus, alsoLifts, hasCompletedWorkout }: FoodOnlyInput): boolean {
  if (statedFocus !== 'food') return false;
  if (alsoLifts === true) return false;
  return hasCompletedWorkout === false;
}

/** True when the onboarding URL carries the benchmarks intent flag. */
export function askedForBenchmarks(search: string): boolean {
  try {
    return new URLSearchParams(search).get(BENCHMARKS_INTENT_PARAM) === '1';
  } catch {
    return false;
  }
}
