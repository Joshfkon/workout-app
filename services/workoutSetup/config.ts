/**
 * Tunable constants for the workout-setup flow, in one place.
 *
 * Duration uses the app-wide model (services/workoutDurationEstimator
 * DURATION_MODEL: per-set work time by mechanic, warmups, transitions); the
 * knobs here are only what the setup flow adds on top — how many sets a
 * selected group gets, how a group splits into exercises, and rest by
 * exercise type.
 */

export const SETUP_CONFIG = {
  /** Session sets for a Fresh group already at/above its zone min. */
  baseGroupSets: 4,
  /** A selected group never gets fewer sets than this. */
  minGroupSets: 2,
  /**
   * Per-session ceiling for one group — past ~8 hard sets in a session the
   * extra sets are mostly fatigue, so a big weekly deficit is closed across
   * sessions rather than dumped into one.
   */
  maxGroupSets: 8,
  /** Recovering groups get this fraction of the Fresh prescription. */
  recoveringScale: 0.6,
  /** A Fatigued group the user still chose gets light technique work only. */
  fatiguedGroupSets: 2,
  /** No evidence either way (unknown) → a conservative starting dose. */
  unknownGroupSets: 3,
  /** RIR added for fatigued groups and for picks that load a fatigued stabilizer. */
  cautionRirBump: 1,
  /** A group whose session sets exceed this is split across two exercises. */
  splitAboveSets: 4,
  /** Minimum working sets for one exercise in a plan (trimming floor). */
  minSetsPerExercise: 2,
  /** exercise_blocks.target_sets CHECK (1–10). */
  minSetsPerItem: 1,
  maxSetsPerItem: 10,
  /**
   * Rest by exercise type — the same values handleAddExercise writes for a
   * block added mid-workout, so the plan's duration promise matches the
   * blocks Start creates.
   */
  restSeconds: { compound: 180, isolation: 90 },
  /** Time-budget options offered in the picker (minutes; null = none). */
  timeBudgetOptions: [30, 45, 60, 90] as const,
  /** Swap sheet: how many candidates the AI review may choose from. */
  swapCandidatesForReview: 5,
  /** Swap ranking: an exercise done within this many days counts as recent. */
  swapRecentDays: 7,
} as const;

export type TimeBudgetMinutes = (typeof SETUP_CONFIG.timeBudgetOptions)[number];
