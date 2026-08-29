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
 *  - all weights compare at storage precision (services/shared/weightPrecision)
 *    — the stored record comes back DECIMAL(6,2)-rounded while a just-logged
 *    set carries the full-precision lb→kg conversion, and without quantizing,
 *    repeating last session's top weight "beats" it by a milligram and fires
 *    a 0%-improvement weight PR
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
import { storageWeightKg } from '@/services/shared/weightPrecision';
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
  // Every weight read (comparison AND e1RM input) goes through storage
  // precision so a fresh in-memory set is commensurable with the
  // DECIMAL(6,2)-rounded record — see the module doc.
  const weightOf = (s: LivePrSetInput): number => storageWeightKg(s.weightKg);
  const e1rmOf = (s: LivePrSetInput): number => {
    const reps = getSetReps(s, exercise);
    return reps === null ? 0 : e1rmValueFromRpe(weightOf(s), reps, s.rpe);
  };

  // Baseline: stored record raised by the best earlier qualifying set this
  // session, so only a new session high-water mark fires (set 2 matching
  // set 1's PR numbers is not a second PR). `bestCount` follows the count
  // convention above (reps or seconds).
  const { reps: recordCount, e1rm: recordE1rm } = previousBest;
  let bestWeight = storageWeightKg(previousBest.weightKg);
  let bestCount = recordCount;
  let bestE1rm = recordE1rm;
  for (const prior of priorSessionSets) {
    if (isWarmupSet(prior) || isUglyForm(prior)) continue;
    const priorWeight = weightOf(prior);
    if (priorWeight > bestWeight) bestWeight = priorWeight;
    const priorCount = countOf(prior);
    if (priorCount > bestCount) bestCount = priorCount;
    const priorE1rm = e1rmOf(prior);
    if (priorE1rm > bestE1rm) bestE1rm = priorE1rm;
  }

  const setWeight = weightOf(set);
  const setCount = countOf(set);
  const atRecordWeight = setWeight >= bestWeight * REPS_PR_WEIGHT_TOLERANCE;

  // Duration exercise: the record is max seconds at (>=) weight — never e1RM.
  if (isDuration) {
    if (setWeight > bestWeight) {
      return {
        type: 'weight',
        value: setWeight,
        improvement: pctImprovement(setWeight, bestWeight),
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
  if (setWeight > bestWeight) {
    return {
      type: 'weight',
      value: setWeight,
      improvement: pctImprovement(setWeight, bestWeight),
    };
  }
  if (setCount > bestCount && atRecordWeight) {
    return { type: 'reps', value: setCount, improvement: setCount - bestCount };
  }
  return null;
}
