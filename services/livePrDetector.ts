/**
 * Live PR Detector
 *
 * Pure classification of a just-logged set as a personal record, at the
 * moment it is logged, so the workout screen can celebrate immediately
 * instead of waiting for the session summary.
 *
 * The rules deliberately mirror SessionSummary's `personalRecords` memo
 * (components/workout/SessionSummary.tsx) so a set that gets a live
 * celebration also shows up as a PR on the summary:
 *  - no PRs on a deload session
 *  - warmup sets never count
 *  - ugly-form sets never count
 *  - duration exercises (seconds in `reps`) record max weight, then max
 *    seconds at >= 95% of record weight — never e1RM
 *  - otherwise precedence is e1RM > weight > reps-at->=95%-weight
 *
 * One live-specific addition: the baseline is the stored previous best
 * RAISED by the best earlier qualifying set of the current session, so the
 * celebration fires once per new high-water mark instead of on every set
 * that beats a stale stored record.
 */

import type { FormRating } from '@/types/schema';
import { e1rmValueFromRpe } from '@/services/shared/e1rm';

export interface LivePrSetInput {
  weightKg: number;
  /** Rep count; SECONDS for duration exercises. */
  reps: number;
  rpe: number;
  form?: FormRating | null;
  isWarmup: boolean;
}

export interface LivePrDetectionInput {
  /** The set that was just logged. */
  set: LivePrSetInput;
  /** Earlier sets logged this session for the SAME exercise block. */
  priorSessionSets: LivePrSetInput[];
  /** Stored all-time best, or null when the exercise has no history. */
  previousBest: { weight: number; reps: number; e1rm: number } | null;
  isDeload: boolean;
  isDurationExercise: boolean;
}

export interface LivePr {
  type: 'e1rm' | 'weight' | 'reps' | 'duration';
  /** kg for e1rm/weight; reps for reps; seconds for duration. */
  value: number;
  /** Percent for e1rm/weight; absolute for reps/duration. */
  improvement: number;
}

/** Reps/duration PRs require the weight to be within this fraction of the record weight. */
const REPS_PR_WEIGHT_TOLERANCE = 0.95;

const pctImprovement = (value: number, baseline: number): number =>
  baseline > 0 ? Math.round(((value - baseline) / baseline) * 100) : 0;

/**
 * Stored previous best raised by the best earlier qualifying set of the
 * current session, so only a new session high-water mark fires (set 2
 * matching set 1's PR numbers is not a second PR).
 */
function sessionBaseline(
  previousBest: { weight: number; reps: number; e1rm: number },
  priorSessionSets: LivePrSetInput[],
  isDurationExercise: boolean
): { weight: number; reps: number; e1rm: number } {
  const baseline = { ...previousBest };
  for (const prior of priorSessionSets) {
    if (prior.isWarmup || prior.form === 'ugly') continue;
    if (prior.weightKg > baseline.weight) baseline.weight = prior.weightKg;
    if (prior.reps > baseline.reps) baseline.reps = prior.reps;
    if (!isDurationExercise) {
      const priorE1rm = e1rmValueFromRpe(prior.weightKg, prior.reps, prior.rpe);
      if (priorE1rm > baseline.e1rm) baseline.e1rm = priorE1rm;
    }
  }
  return baseline;
}

/**
 * Classify a just-logged set against the exercise's record, or return null
 * when it is not a PR (or PRs are suppressed for this set/session).
 */
export function detectLiveSetPr(input: LivePrDetectionInput): LivePr | null {
  const { set, priorSessionSets, previousBest, isDeload, isDurationExercise } = input;

  // Same suppressions as the summary: deloads are intentionally light, and
  // a cold-start exercise has no record to beat.
  if (isDeload || !previousBest) return null;
  if (set.isWarmup) return null;
  if (set.form === 'ugly') return null;

  const baseline = sessionBaseline(previousBest, priorSessionSets, isDurationExercise);

  // Duration exercise: record is max seconds at (>=) weight — never e1RM
  // (seconds through a rep formula fabricate a 1RM).
  if (isDurationExercise) {
    if (set.weightKg > baseline.weight) {
      return {
        type: 'weight',
        value: set.weightKg,
        improvement: pctImprovement(set.weightKg, baseline.weight),
      };
    }
    if (set.reps > baseline.reps && set.weightKg >= baseline.weight * REPS_PR_WEIGHT_TOLERANCE) {
      return { type: 'duration', value: set.reps, improvement: set.reps - baseline.reps };
    }
    return null;
  }

  // e1RM PR (most meaningful). 0 = no estimate (beyond the estimator's
  // domain) and can never beat a real record.
  const setE1rm = e1rmValueFromRpe(set.weightKg, set.reps, set.rpe);
  if (setE1rm > 0 && setE1rm > baseline.e1rm) {
    return { type: 'e1rm', value: setE1rm, improvement: pctImprovement(setE1rm, baseline.e1rm) };
  }
  if (set.weightKg > baseline.weight) {
    return {
      type: 'weight',
      value: set.weightKg,
      improvement: pctImprovement(set.weightKg, baseline.weight),
    };
  }
  if (set.reps > baseline.reps && set.weightKg >= baseline.weight * REPS_PR_WEIGHT_TOLERANCE) {
    return { type: 'reps', value: set.reps, improvement: set.reps - baseline.reps };
  }
  return null;
}
