/**
 * plannedFrequency.ts — PLANNED per-muscle weekly training frequency, derived
 * from the active mesocycle's stored plan.
 *
 * WHY PLANNED, NEVER OBSERVED
 * ---------------------------
 * The recovery dose model divides a muscle's MRV by its weekly frequency to get
 * a per-session capacity. That denominator must describe the PLAN, not what has
 * happened so far this week. If it were derived from trailing completed
 * sessions it would climb as the week fills, and the SAME completed session
 * would be re-interpreted as a progressively lighter dose every time another
 * workout was logged — the muscle's recovery window would shrink retroactively
 * for reasons that have nothing to do with that session. Reading the plan is
 * stable: it is the same number on Monday and on Sunday.
 *
 * Pure: no Supabase, no React, no clock. Callers pass the week's planned
 * sessions (see services/mesocycleHelpers.getWeekSessionsFromProgramData).
 */

import {
  boundedComponentsOf,
  capacityOwnerFor,
  resolveMuscleToStandard,
  type StandardMuscleGroup,
} from '@/types/schema';

/** The minimum a planned session list can imply for a muscle it contains. */
const MIN_PLANNED_SESSIONS = 1;

/** Just enough of an ExtractedSession for this derivation. */
export interface PlannedSessionLike {
  exercises: Array<{
    primaryMuscle?: string | null;
    secondaryMuscles?: string[] | null;
  }>;
}

/**
 * How many PLANNED sessions in the week touch each standard muscle.
 *
 * A muscle is counted at most once per session however many exercises hit it —
 * this is session FREQUENCY, not exercise count. Secondary tags count: a muscle
 * that only ever appears as a secondary is still being trained on that day, and
 * the dose model already credits secondary work.
 *
 * Muscles absent from the plan are omitted rather than defaulted, so the caller
 * can tell "not in the plan" apart from "planned once" and report the fallback
 * honestly.
 *
 * FAMILY EXPANSION. A session counts for a whole groupCapacity ↔
 * boundedComponent family (traps/upper_traps/mid_lower_traps,
 * calves/gastrocnemius/soleus, triceps/triceps_long/triceps_lat_med), matching
 * the family flow in muscleRecovery.involvementFactor. This is not cosmetic:
 * `sessionCapacityFor` divides the CAPACITY OWNER's MRV (the parent's) by this
 * frequency, so looking the frequency up on the exact child row mixed a
 * parent's MRV with a child's schedule. A plan that tags its pulls coarsely
 * ('traps' three times a week) gave the parent 16/3 and the child the 16/2
 * fallback — the same sets normalized against two different schedules, so the
 * child's window came out shorter and its Train-page row went Fresh before the
 * group's. Siblings still never merge: the edge is parent↔child only, so a
 * shrug-only plan never implies a mid/lower trap session.
 */
export function plannedSessionsPerWeekByMuscle(
  sessions: readonly PlannedSessionLike[]
): Partial<Record<StandardMuscleGroup, number>> {
  const counts: Partial<Record<StandardMuscleGroup, number>> = {};

  for (const session of sessions) {
    // Per SESSION, not per exercise — a muscle hit by four exercises on one day
    // was still trained once that day.
    const touched = new Set<StandardMuscleGroup>();
    for (const exercise of session.exercises ?? []) {
      const tokens = [
        exercise.primaryMuscle,
        ...(exercise.secondaryMuscles ?? []),
      ];
      for (const token of tokens) {
        if (!token) continue;
        for (const standard of resolveMuscleToStandard(token)) {
          touched.add(standard);
          // Parent↔child only — no recursion, so siblings stay independent.
          touched.add(capacityOwnerFor(standard));
          for (const component of boundedComponentsOf(standard)) touched.add(component);
        }
      }
    }
    for (const muscle of Array.from(touched)) {
      counts[muscle] = (counts[muscle] ?? 0) + 1;
    }
  }

  // A muscle that appears at all is planned at least once.
  for (const muscle of Object.keys(counts) as StandardMuscleGroup[]) {
    counts[muscle] = Math.max(MIN_PLANNED_SESSIONS, counts[muscle]!);
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Frequency-source observability
// ---------------------------------------------------------------------------

/**
 * Where a resolved planned frequency came from. Mirrors the resolution order
 * in muscleRecovery.sessionCapacityFor.
 *
 *  - 'perMuscle': derived from the active plan for THIS muscle (best).
 *  - 'program':   a program-wide planned frequency, no per-muscle detail.
 *  - 'fallback':  DEFAULT_PLANNED_SESSIONS_PER_WEEK — no plan available.
 */
export type PlannedFrequencySource = 'perMuscle' | 'program' | 'fallback';

export interface FrequencySourceCounts {
  perMuscle: number;
  program: number;
  fallback: number;
}

const sourceCounts: FrequencySourceCounts = { perMuscle: 0, program: 0, fallback: 0 };

/**
 * Record one resolved frequency. Called from the recovery engine on every dose
 * evaluation so production can answer "what fraction of recovery windows are
 * running on the fallback?" — the question that decides whether the fallback is
 * a policy or a bug.
 */
export function recordFrequencySource(source: PlannedFrequencySource): void {
  sourceCounts[source] += 1;
}

/** Snapshot of frequency-source usage, with shares. */
export function getFrequencySourceMetrics(): FrequencySourceCounts & {
  total: number;
  perMuscleShare: number;
  programShare: number;
  fallbackShare: number;
} {
  const total = sourceCounts.perMuscle + sourceCounts.program + sourceCounts.fallback;
  const share = (n: number) => (total > 0 ? n / total : 0);
  return {
    ...sourceCounts,
    total,
    perMuscleShare: share(sourceCounts.perMuscle),
    programShare: share(sourceCounts.program),
    fallbackShare: share(sourceCounts.fallback),
  };
}

/** Reset the counters (tests, and any per-session reset). */
export function resetFrequencySourceMetrics(): void {
  sourceCounts.perMuscle = 0;
  sourceCounts.program = 0;
  sourceCounts.fallback = 0;
}
