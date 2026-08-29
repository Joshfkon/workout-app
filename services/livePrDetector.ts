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
 *  - duration exercises (seconds in the reps field) record max weight, then
 *    max seconds at >= 95% of record weight — never e1RM
 *  - otherwise precedence is e1RM > weight > reps-at->=95%-weight
 *
 * One live-specific addition: the baseline is the stored previous best
 * RAISED by the best earlier qualifying set of the current session, so the
 * celebration fires once per new high-water mark instead of on every set
 * that beats a stale stored record.
 *
 * Reps/seconds are read through the setModality accessors — the modality
 * branch is explicit, per the reps-access ratchet
 * (scripts/check-reps-access.mjs).
 */

import type { FormRating } from '@/types/schema';
import { e1rmValueFromRpe } from '@/services/shared/e1rm';
import {
  getSetDuration,
  getSetReps,
  isDurationExercise,
  type ModalitySource,
} from '@/services/shared/setModality';

/** Structural subset of SetLog — logged sets can be passed as-is. */
export interface LivePrSetInput {
  weightKg: number;
  /** Rep count; SECONDS for duration exercises (the storage convention). */
  reps: number;
  rpe: number;
  /** Either shape marks a warmup (SetLog carries both). */
  isWarmup?: boolean;
  setType?: string | null;
  feedback?: { form?: FormRating } | null;
}

export interface LivePrDetectionInput {
  /** The set that was just logged. */
  set: LivePrSetInput;
  /** Earlier sets logged this session for the SAME exercise block. */
  priorSessionSets: LivePrSetInput[];
  /** Stored all-time best (reps holds seconds for duration exercises), or
   *  null when the exercise has no history. */
  previousBest: { weightKg: number; reps: number; e1rm: number } | null;
  isDeload: boolean;
  /** The block's exercise — decides rep vs duration modality. */
  exercise: ModalitySource | null | undefined;
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

const isWarmupSet = (s: LivePrSetInput): boolean => !!s.isWarmup || s.setType === 'warmup';
const isUglyForm = (s: LivePrSetInput): boolean => s.feedback?.form === 'ugly';

/**
 * Classify a just-logged set against the exercise's record, or return null
 * when it is not a PR (or PRs are suppressed for this set/session).
 */
export function detectLiveSetPr(input: LivePrDetectionInput): LivePr | null {
  const { set, priorSessionSets, previousBest, isDeload, exercise } = input;

  // Same suppressions as the summary: deloads are intentionally light, and
  // a cold-start exercise has no record to beat.
  if (isDeload || !previousBest) return null;
  if (isWarmupSet(set) || isUglyForm(set)) return null;

  const isDuration = isDurationExercise(exercise);
  // A set's count is reps for rep-based exercises, seconds for duration
  // ones; e1RM applies only to rep-based sets (getSetReps is null for
  // duration, and seconds through a rep formula fabricate a 1RM).
  const countOf = (s: LivePrSetInput): number =>
    (isDuration ? getSetDuration(s, exercise) : getSetReps(s, exercise)) ?? 0;
  const e1rmOf = (s: LivePrSetInput): number => {
    const reps = getSetReps(s, exercise);
    return reps === null ? 0 : e1rmValueFromRpe(s.weightKg, reps, s.rpe);
  };

  // Baseline: stored record raised by the best earlier qualifying set this
  // session, so only a new session high-water mark fires (set 2 matching
  // set 1's PR numbers is not a second PR). `bestCount` follows the count
  // convention above (reps or seconds).
  const { weightKg: recordWeight, reps: recordCount, e1rm: recordE1rm } = previousBest;
  let bestWeight = recordWeight;
  let bestCount = recordCount;
  let bestE1rm = recordE1rm;
  for (const prior of priorSessionSets) {
    if (isWarmupSet(prior) || isUglyForm(prior)) continue;
    if (prior.weightKg > bestWeight) bestWeight = prior.weightKg;
    const priorCount = countOf(prior);
    if (priorCount > bestCount) bestCount = priorCount;
    const priorE1rm = e1rmOf(prior);
    if (priorE1rm > bestE1rm) bestE1rm = priorE1rm;
  }

  const setCount = countOf(set);
  const atRecordWeight = set.weightKg >= bestWeight * REPS_PR_WEIGHT_TOLERANCE;

  // Duration exercise: the record is max seconds at (>=) weight — never e1RM.
  if (isDuration) {
    if (set.weightKg > bestWeight) {
      return {
        type: 'weight',
        value: set.weightKg,
        improvement: pctImprovement(set.weightKg, bestWeight),
      };
    }
    if (setCount > bestCount && atRecordWeight) {
      return { type: 'duration', value: setCount, improvement: setCount - bestCount };
    }
    return null;
  }

  // e1RM PR (most meaningful). 0 = no estimate (beyond the estimator's
  // domain) and can never beat a real record.
  const setE1rm = e1rmOf(set);
  if (setE1rm > 0 && setE1rm > bestE1rm) {
    return { type: 'e1rm', value: setE1rm, improvement: pctImprovement(setE1rm, bestE1rm) };
  }
  if (set.weightKg > bestWeight) {
    return {
      type: 'weight',
      value: set.weightKg,
      improvement: pctImprovement(set.weightKg, bestWeight),
    };
  }
  if (setCount > bestCount && atRecordWeight) {
    return { type: 'reps', value: setCount, improvement: setCount - bestCount };
  }
  return null;
}
