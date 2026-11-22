/**
 * Which kind of day Home leads with. Pure — every input is data Home already
 * holds, so the decision never waits on a fetch.
 *
 * 'food' is for people who use HyperTrack to track what they eat or weigh and
 * don't lift with it: no completed workout ever (or none in the last 12
 * weeks), no active plan, nothing on today's workout slot, and recent food or
 * weigh-in logs. They see food and weight first, and a single compact workout
 * entry lower down instead of the "Ready to train?" hero and program prompt.
 *
 * A brand-new user (no completed workout ever) who answered "No, food
 * tracking" at sign-up also gets 'food' before logging anything — a fresh
 * account has no logs to go on. Their first completed workout ends that.
 *
 * Anything uncertain falls back to 'training' (today's layout): an unknown
 * workout history is treated as a lifter, never as food-only.
 */
export type HomeFocus = 'training' | 'food';

export interface HomeFocusInput {
  /** All-time completed workouts; undefined when unknown. */
  completedWorkoutsCount?: number | null;
  /** Completed workouts in the lift-trend window (12 weeks); undefined when unknown. */
  recentCompletedWorkouts?: number | null;
  /** Active mesocycle the user trains from. */
  hasPlan: boolean;
  /** Today's workout (planned, in progress or done) exists. */
  hasTodaysWorkout: boolean;
  /** A weigh-in in the recent history Home loads. */
  hasRecentWeighIn: boolean;
  /** Any food logged today. */
  hasFoodToday: boolean;
  /** Ever logged food or a weigh-in (useBodyOrFoodLogged); undefined while unknown. */
  hasLoggedBodyOrFood?: boolean | null;
  /** Sign-up answer (lib/onboarding/trackingFocus); null when not given. */
  statedFocus?: 'food' | null;
}

export function homeFocus(input: HomeFocusInput): HomeFocus {
  if (input.hasPlan || input.hasTodaysWorkout) return 'training';

  const noWorkoutsEver = input.completedWorkoutsCount === 0;
  if (noWorkoutsEver && input.statedFocus === 'food') return 'food';
  const noRecentWorkouts = input.recentCompletedWorkouts === 0;
  if (!noWorkoutsEver && !noRecentWorkouts) return 'training';

  const recentFoodOrWeight = input.hasRecentWeighIn || input.hasFoodToday;
  // "Ever logged food or weight" is enough only for someone who has never
  // lifted with the app. A lapsed lifter needs RECENT food/weight logs: one
  // old food entry shouldn't swap their Home away from training.
  const logsFoodOrWeight =
    recentFoodOrWeight || (noWorkoutsEver && input.hasLoggedBodyOrFood === true);
  return logsFoodOrWeight ? 'food' : 'training';
}
