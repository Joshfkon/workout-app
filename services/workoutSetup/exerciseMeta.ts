/**
 * Small shared helpers over SetupExercise: which coarse group an exercise
 * serves, and which tracked stabilizers it loads. Pure.
 */

import { resolveMuscleToStandard, type StandardMuscleGroup } from '@/types/schema';
import { STANDARD_TO_COARSE, type CoarseMuscle } from '@/services/volumeBands';
import { STABILIZER_TRACKED_MUSCLES } from '@/services/shared/stabilizerTags';
import type { SetupExercise } from './types';

/** Standard muscles an exercise's PRIMARY tag resolves to. */
export function primaryStandards(ex: Pick<SetupExercise, 'primaryMuscle'>): StandardMuscleGroup[] {
  return ex.primaryMuscle ? resolveMuscleToStandard(ex.primaryMuscle) : [];
}

/** The coarse group an exercise's primary tag lands on (null if untagged). */
export function primaryGroupOf(ex: Pick<SetupExercise, 'primaryMuscle'>): CoarseMuscle | null {
  for (const std of primaryStandards(ex)) {
    const group = STANDARD_TO_COARSE[std];
    if (group) return group;
  }
  return null;
}

/** Does the exercise's primary tag hit any member of `group`? */
export function servesGroup(ex: Pick<SetupExercise, 'primaryMuscle'>, group: CoarseMuscle): boolean {
  return primaryStandards(ex).some((std) => STANDARD_TO_COARSE[std] === group);
}

const TRACKED = new Set<string>(STABILIZER_TRACKED_MUSCLES);

/** Tracked stabilizers the exercise loads (from its stabilizer tags). */
export function trackedStabilizersOf(ex: Pick<SetupExercise, 'stabilizers'>): StandardMuscleGroup[] {
  const out: StandardMuscleGroup[] = [];
  for (const tag of ex.stabilizers) {
    for (const std of resolveMuscleToStandard(tag)) {
      if (TRACKED.has(std) && !out.includes(std)) out.push(std);
    }
  }
  return out;
}

/** Human label for a stabilizer region (warnings, AI payload keys). */
export const STABILIZER_REGION_LABEL: Record<string, string> = {
  forearms: 'grip',
  erectors: 'lower back',
  rotator_cuff: 'rotator cuff',
  rear_delts: 'rear delts',
};
