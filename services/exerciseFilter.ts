/**
 * exerciseFilter.ts
 *
 * ONE shared, pure filtering layer for every place the app shows a
 * searchable/filterable exercise list: the exercise library screen, the
 * add-exercise picker, and the replace/swap picker.
 *
 * Before this module each surface hand-rolled its own filter, which drifted:
 * the replace picker built its list by concatenating the current workout's
 * block exercises with the full library WITHOUT de-duping, so an exercise that
 * was both in the workout and the library rendered twice (duplicate rows AND
 * duplicate React keys). Search/muscle matching also varied per surface.
 *
 * Rules (identical everywhere now):
 *  - De-dupe by id (first occurrence wins) so a row never repeats.
 *  - Text query is case-insensitive and matches NAME, MUSCLES (primary +
 *    secondary, formatted + raw), or EQUIPMENT.
 *  - Muscle chip uses muscleMatchesGroup so a coarse chip ('back') matches
 *    precisely-tagged exercises ('lats', 'lower_back') and vice versa.
 *  - Query AND chip COMPOSE (both must pass).
 *  - No matches -> empty array. Callers render a real empty state; they must
 *    NOT fall back to the unfiltered default list.
 *
 * Field casing is tolerated: callers feed either snake_case DB rows
 * (primary_muscle, equipment_required) or camelCase domain objects
 * (primaryMuscle, equipmentRequired).
 */

import { isLegacyMuscle, muscleMatchesGroup, normalizeMuscleToken } from '@/types/schema';
import { formatMuscleName } from '@/lib/utils';

/**
 * The loosely-typed shape the filter reads. Every exercise-ish object in the
 * app satisfies this; only `id` and `name` are required.
 */
export interface FilterableExercise {
  id: string;
  name: string;
  primary_muscle?: string | null;
  primaryMuscle?: string | null;
  secondary_muscles?: string[] | null;
  secondaryMuscles?: string[] | null;
  equipment?: string | null;
  equipment_required?: string[] | null;
  equipmentRequired?: string[] | null;
}

export interface ExerciseFilterCriteria {
  /** Free-text query; matched against name, muscles, and equipment. */
  query?: string;
  /** Muscle-group chip value (e.g. 'back'); matched via muscleMatchesGroup. */
  muscleGroup?: string | null;
  /**
   * Optional exact-ish equipment chip (library screen). Matches the primary
   * `equipment` field or any entry in the equipment list, case-insensitive.
   */
  equipment?: string | null;
}

/** Primary muscle, lowercased, reading either casing. Empty string if absent. */
export function getPrimaryMuscle(ex: FilterableExercise): string {
  return String(ex.primaryMuscle ?? ex.primary_muscle ?? '').toLowerCase();
}

/** Secondary muscles, lowercased, reading either casing. */
export function getSecondaryMuscles(ex: FilterableExercise): string[] {
  const raw = ex.secondaryMuscles ?? ex.secondary_muscles ?? [];
  return raw.filter(Boolean).map((m) => String(m).toLowerCase());
}

/** Every equipment token for the exercise, lowercased, reading either casing. */
export function getExerciseEquipment(ex: FilterableExercise): string[] {
  const list = ex.equipmentRequired ?? ex.equipment_required ?? [];
  const out = list.filter(Boolean).map((e) => String(e).toLowerCase());
  if (ex.equipment) out.push(String(ex.equipment).toLowerCase());
  return out;
}

/** All muscle tokens (primary + secondary) an exercise trains, lowercased. */
export function getExerciseMuscles(ex: FilterableExercise): string[] {
  const primary = getPrimaryMuscle(ex);
  const muscles = getSecondaryMuscles(ex);
  if (primary) muscles.unshift(primary);
  return muscles;
}

/**
 * Case-insensitive text match against name, muscles (raw + human-formatted),
 * and equipment. An empty/whitespace query matches everything.
 */
export function exerciseMatchesQuery(ex: FilterableExercise, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (ex.name.toLowerCase().includes(q)) return true;
  // Match both the raw token ('rear_delts') and the display form ('Rear Delts')
  // so "delt" and "rear delt" both hit.
  for (const muscle of getExerciseMuscles(ex)) {
    if (muscle.includes(q)) return true;
    if (formatMuscleName(muscle).toLowerCase().includes(q)) return true;
  }
  for (const eq of getExerciseEquipment(ex)) {
    if (eq.includes(q)) return true;
  }
  return false;
}

/** Muscle-group chip match (coarse<->specific aware). Empty group matches all. */
export function exerciseMatchesMuscleGroup(
  ex: FilterableExercise,
  muscleGroup: string | null | undefined
): boolean {
  if (!muscleGroup) return true;
  return muscleMatchesGroup(getPrimaryMuscle(ex), muscleGroup);
}

/**
 * Muscle-CHIP match for chip rows built from raw `primary_muscle` values (the
 * add-exercise picker), which can be precise tokens ('lats', 'rear_delts').
 *
 * A coarse/legacy chip ('back', 'shoulders') expands to its sub-muscles
 * (group-aware). A precise chip matches ONLY that exact token, so tapping
 * 'lats' does not pull in generic 'back' rows — muscleMatchesGroup is
 * bidirectional (muscleMatchesGroup('back', 'lats') is true), which would
 * otherwise widen a specific chip. Empty chip matches everything.
 */
export function exerciseMatchesMuscleChip(
  ex: FilterableExercise,
  chip: string | null | undefined
): boolean {
  if (!chip) return true;
  const token = normalizeMuscleToken(chip);
  if (isLegacyMuscle(token)) return muscleMatchesGroup(getPrimaryMuscle(ex), chip);
  return normalizeMuscleToken(getPrimaryMuscle(ex)) === token;
}

/** Exact-ish equipment chip match. Empty value matches all. */
export function exerciseMatchesEquipment(
  ex: FilterableExercise,
  equipment: string | null | undefined
): boolean {
  if (!equipment) return true;
  const target = equipment.toLowerCase();
  return getExerciseEquipment(ex).some((eq) => eq === target);
}

/**
 * De-dupe a list by id, keeping the first occurrence. This is what fixes the
 * replace picker's duplicate rows (block exercise + library entry share an id).
 */
export function dedupeExercisesById<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * The single filter used everywhere. De-dupes, then applies query AND chip AND
 * equipment (all composing). Returns a fresh array; empty when nothing matches.
 */
export function filterExercises<T extends FilterableExercise>(
  exercises: T[],
  criteria: ExerciseFilterCriteria = {}
): T[] {
  const { query = '', muscleGroup = null, equipment = null } = criteria;
  return dedupeExercisesById(exercises).filter(
    (ex) =>
      exerciseMatchesQuery(ex, query) &&
      exerciseMatchesMuscleGroup(ex, muscleGroup) &&
      exerciseMatchesEquipment(ex, equipment)
  );
}
