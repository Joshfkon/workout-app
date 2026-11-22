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
}

export function homeFocus(input: HomeFocusInput): HomeFocus {
  if (input.hasPlan || input.hasTodaysWorkout) return 'training';

  const noWorkoutsEver = input.completedWorkoutsCount === 0;
  const noRecentWorkouts = input.recentCompletedWorkouts === 0;
  if (!noWorkoutsEver && !noRecentWorkouts) return 'training';

  const logsFoodOrWeight =
    input.hasRecentWeighIn || input.hasFoodToday || input.hasLoggedBodyOrFood === true;
  return logsFoodOrWeight ? 'food' : 'training';
}
