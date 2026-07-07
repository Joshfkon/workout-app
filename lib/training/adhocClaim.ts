// ============================================================
// AD-HOC WORKOUT → PLANNED SESSION MATCHER
//
// Pure logic deciding whether a just-finished ad-hoc (non-mesocycle) workout
// looks like the mesocycle's NEXT pending program session, so the finish flow
// can offer to count it toward the plan (setting workout_sessions.mesocycle_id
// — everything downstream keys off that: session counting, week advancement,
// weekly rollover feedback).
//
// Deliberately conservative: claiming advances mesocycle progression, so a
// wrong match corrupts the plan, while a missed match only costs the user
// doing the planned session normally next time. Silent auto-claiming is out
// of the question for the same reason — callers must put a prompt in front
// of a positive match.
// ============================================================

import { toLegacyMuscleGroup } from '@/types/schema';

export interface LoggedExerciseForMatch {
  name: string;
  primaryMuscle: string;
}

export interface PlannedExerciseForMatch {
  exerciseName: string;
  primaryMuscle: string;
}

export interface AdhocClaimMatch {
  isMatch: boolean;
  /** Fraction of the planned session's muscle groups the workout hit (0-1). */
  muscleCoverage: number;
  /** Planned exercises whose exact name appears in the logged workout. */
  nameMatches: number;
}

/**
 * Muscle-group coverage required to call it the same session. The product
 * spec for freestyle workouts prompts on >= 50% overlap with the pending
 * scheduled session's target muscles.
 */
const MUSCLE_COVERAGE_THRESHOLD = 0.5;

/**
 * Compare at the legacy muscle-group level so taxonomy detail differences
 * (e.g. 'obliques' vs 'abs', extended vs legacy names) don't block a match.
 */
function normalizeMuscle(muscle: string): string {
  return (toLegacyMuscleGroup(muscle) || muscle).toLowerCase();
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Does this ad-hoc workout look like the given planned session?
 *
 * Match when EITHER signal is strong:
 * - muscle coverage: the workout hit >= 50% of the planned session's muscle
 *   groups (a Push day logged with different exercise selections still counts);
 * - exercise names: at least two planned exercises (or all of them, for a
 *   one-exercise session) were performed by exact name — the user clearly ran
 *   the program's exercises even if they skipped a muscle.
 */
export function matchAdhocToPlannedSession(
  logged: LoggedExerciseForMatch[],
  planned: PlannedExerciseForMatch[]
): AdhocClaimMatch {
  if (logged.length === 0 || planned.length === 0) {
    return { isMatch: false, muscleCoverage: 0, nameMatches: 0 };
  }

  const loggedMuscles = new Set(logged.map((e) => normalizeMuscle(e.primaryMuscle)));
  const plannedMuscles = new Set(planned.map((e) => normalizeMuscle(e.primaryMuscle)));

  let covered = 0;
  for (const muscle of Array.from(plannedMuscles)) {
    if (loggedMuscles.has(muscle)) covered++;
  }
  const muscleCoverage = covered / plannedMuscles.size;

  const loggedNames = new Set(logged.map((e) => normalizeName(e.name)));
  let nameMatches = 0;
  for (const exercise of planned) {
    if (loggedNames.has(normalizeName(exercise.exerciseName))) nameMatches++;
  }

  const isMatch =
    muscleCoverage >= MUSCLE_COVERAGE_THRESHOLD ||
    nameMatches >= Math.min(2, planned.length);

  return { isMatch, muscleCoverage, nameMatches };
}
