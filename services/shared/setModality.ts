/**
 * Set modality accessors — the single sanctioned way to read a set's
 * reps/duration value.
 *
 * Duration-based exercises (planks, carries, hangs, holds) store SECONDS in
 * the `reps` field of a logged set, and their `defaultRepRange` /
 * `targetRepRange` tuples hold a seconds range. That overloading is the
 * storage convention (see ExerciseType in types/schema.ts and migration
 * 20260110000001_add_exercise_type.sql); these accessors are what keep it
 * from leaking bugs into rep-shaped math.
 *
 * Rules:
 * - New code must not read `set.reps` directly — go through getSetReps /
 *   getSetDuration so the modality branch is explicit. A CI ratchet
 *   (scripts/check-reps-access.mjs) fails the build when the count of raw
 *   `.reps` reads grows.
 * - Anything computing tonnage, e1RM, or rep PRs must first check
 *   isDurationExercise and skip/branch for duration sets.
 */

import type { ExerciseType } from '@/types/schema';

/** The minimal exercise shape the accessors need. `exerciseType` is optional
 *  on Exercise (absent = rep_based) so older objects work unchanged. */
export interface ModalitySource {
  exerciseType?: ExerciseType | null;
}

/** The minimal logged-set shape the accessors need. */
export interface RepsCarrier {
  reps: number;
}

/** A target range with its unit made explicit. */
export interface TargetRange {
  min: number;
  max: number;
  unit: 'reps' | 'seconds';
}

/** True when the exercise tracks time (seconds in the reps field). */
export function isDurationExercise(exercise: ModalitySource | null | undefined): boolean {
  return exercise?.exerciseType === 'duration_based';
}

/**
 * Seconds held for a duration set, or null for a rep-based exercise's set.
 * Callers get an explicit "not applicable" instead of seconds-as-reps.
 */
export function getSetDuration(
  set: RepsCarrier,
  exercise: ModalitySource | null | undefined
): number | null {
  return isDurationExercise(exercise) ? set.reps : null;
}

/**
 * Rep count for a rep-based set, or null for a duration exercise's set.
 * Rep-shaped math (tonnage, e1RM, rep PRs) must treat null as "skip this set".
 */
export function getSetReps(
  set: RepsCarrier,
  exercise: ModalitySource | null | undefined
): number | null {
  return isDurationExercise(exercise) ? null : set.reps;
}

/**
 * An exercise's target range with its unit resolved from modality. Works for
 * both `defaultRepRange` on the exercise and `targetRepRange` on a block —
 * pass whichever tuple applies.
 */
export function getTargetRange(
  range: [number, number],
  exercise: ModalitySource | null | undefined
): TargetRange {
  return {
    min: range[0],
    max: range[1],
    unit: isDurationExercise(exercise) ? 'seconds' : 'reps',
  };
}

/**
 * Display formatter for a set's count value: "12" for reps, "45s" for
 * seconds. Weight formatting stays with formatWeight in lib/utils.
 */
export function formatSetCount(
  set: RepsCarrier,
  exercise: ModalitySource | null | undefined
): string {
  return isDurationExercise(exercise) ? `${set.reps}s` : `${set.reps}`;
}

/** Display formatter for a target range: "8–12" for reps, "30–60s" for seconds. */
export function formatTargetRange(
  range: [number, number],
  exercise: ModalitySource | null | undefined
): string {
  const suffix = isDurationExercise(exercise) ? 's' : '';
  return range[0] === range[1] ? `${range[0]}${suffix}` : `${range[0]}–${range[1]}${suffix}`;
}
