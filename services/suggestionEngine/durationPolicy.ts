/**
 * Duration-exercise prescription policy — the timed-set analogue of the
 * rep-based recommendSet / recommendSessionStart paths in setRecommender.
 *
 * Duration exercises (exerciseType 'duration_based': planks, carries, hangs,
 * holds) store SECONDS in the reps field. They must NEVER enter the
 * Epley/e1RM curve — a "1RM" derived from a hold time is fiction — so this
 * module implements time-then-load double progression instead:
 *
 *  - Within a session: hold the load; the next-set time target tracks the
 *    last hold minus a fatigue haircut, shifted by the logged effort gap.
 *    Honest seconds: an over-range hold shows its real time (bounded by
 *    DURATION_OVERSHOOT_CEILING_S), never clamped back to the range top.
 *  - Session to session: reaching the top of the seconds range earns a load
 *    bump on LOADED exercises (one increment, time reseeds to the range
 *    floor). Bodyweight holds progress time only — at the ceiling they HOLD
 *    as a stable state: no repeated "add load" nagging, and (by exclusion
 *    from the e1RM/plateau machinery) no false plateau alarms.
 *  - When the policy cannot prescribe sensibly it skips LOUDLY: an explicit
 *    { skipped, reason } result plus a console.warn — never a silent null.
 *
 * The recommendation shape reuses SetRecommendation with `reps` carrying
 * seconds, so the existing duration-aware UI (which renders "Ns" for
 * duration exercises) needs no new plumbing.
 *
 * Pure functions — no DB calls or side effects beyond the warn on skip.
 */

import { clamp, roundToIncrement } from '@/lib/utils';
import type { SetRecommendation, SetRecommenderInput, SessionStartInput } from '../setRecommender';
import {
  DEADBAND_RIR,
  EFFORT_MATCH_TOLERANCE,
  DURATION_HOLD_DROP_RATE,
  DURATION_RIR_SECONDS_FRACTION,
  DURATION_OVERSHOOT_CEILING_S,
  DURATION_OVERSHOOT_S,
  DURATION_PROGRESSION_STEP_S,
} from './constants';

/**
 * Loud-skip result: the engine could not produce a sensible prescription for
 * this duration exercise. Callers must surface `reason` (banner copy), never
 * swallow it.
 */
export interface DurationPrescriptionSkip {
  skipped: true;
  reason: string;
}

export function isDurationSkip(value: unknown): value is DurationPrescriptionSkip {
  return typeof value === 'object' && value !== null && (value as { skipped?: unknown }).skipped === true;
}

/** The one sanctioned way to skip: warns so a skip is never silent. */
export function skipDurationPrescription(context: string, reason: string): DurationPrescriptionSkip {
  console.warn(`[durationPolicy] ${context}: ${reason}`);
  return { skipped: true, reason };
}

function effortVsTarget(dev: number): SetRecommendation['effortVsTarget'] {
  return dev >= EFFORT_MATCH_TOLERANCE ? 'easier' : dev <= -EFFORT_MATCH_TOLERANCE ? 'harder' : 'on_target';
}

/**
 * Within-session next-set recommendation for a duration exercise.
 * `input.lastReps` and the returned `reps` carry SECONDS.
 *
 * `loadable` = the exercise has an external-load lever (dumbbell carries,
 * plate pinches — NOT pure bodyweight holds, whose logged weight is the
 * user's own bodyweight and cannot be prescribed up or down mid-session).
 */
export function recommendDurationSet(
  input: SetRecommenderInput,
  loadable: boolean
): SetRecommendation {
  const { lastWeightKg, targetRepRange, targetRir } = input;
  const [secMin, secMax] = targetRepRange;
  const lastSeconds = input.lastReps;
  const inc = input.minIncrementKg && input.minIncrementKg > 0 ? input.minIncrementKg : 2.5;

  // Guard bad inputs: no usable reference hold → target the range floor.
  if (lastSeconds <= 0) {
    return {
      weightKg: Math.max(0, lastWeightKg),
      reps: secMin,
      rir: targetRir,
      rationale: 'maintain',
      effortVsTarget: 'on_target',
    };
  }

  const safeRir = Math.max(0, input.lastRir);
  const dev = safeRir - targetRir; // + = easier than target, − = harder
  const effort = effortVsTarget(dev);

  // Fatigue haircut on hold time (duration analogue of the rep HOLD branch),
  // shifted by the logged effort gap: a hold left easier than target has more
  // seconds in hand; one taken past target has fewer.
  const drop = Math.max(2, Math.round(lastSeconds * DURATION_HOLD_DROP_RATE));
  const rirShift = Math.round(dev * Math.max(2, lastSeconds * DURATION_RIR_SECONDS_FRACTION));
  const heldSeconds = clamp(lastSeconds + rirShift - drop, 5, secMax + DURATION_OVERSHOOT_CEILING_S);

  if (loadable && lastWeightKg > 0) {
    if (lastSeconds > secMax + DURATION_OVERSHOOT_S || (lastSeconds >= secMax && dev >= DEADBAND_RIR)) {
      // Too light: the hold ran well past the range top (or cleared it with
      // plenty in reserve). One conservative increment — there is no capacity
      // curve to derive a bigger step from — and the time target resets to
      // the range floor at the new load.
      return {
        weightKg: roundToIncrement(lastWeightKg + inc, inc),
        reps: secMin,
        rir: targetRir,
        rationale: 'increase_load',
        effortVsTarget: effort,
      };
    }
    if (lastSeconds < secMin && dev <= -DEADBAND_RIR) {
      // Too heavy: failed before the range floor near-failure. One increment
      // down (never below one increment), aim mid-range.
      return {
        weightKg: Math.max(inc, roundToIncrement(lastWeightKg - inc, inc)),
        reps: Math.round((secMin + secMax) / 2),
        rir: targetRir,
        rationale: 'reduce_load',
        effortVsTarget: effort,
      };
    }
  }

  // Default (and the entire bodyweight path): hold the load, target the
  // fatigue-adjusted honest time.
  return {
    weightKg: Math.max(0, lastWeightKg),
    reps: heldSeconds,
    rir: targetRir,
    rationale: 'maintain',
    effortVsTarget: effort,
  };
}

/**
 * Session-START recommendation for a duration exercise — time-then-load
 * double progression off the previous session's corresponding set:
 *
 *  - Previous top hold reached the range top → LOADED: bump one increment,
 *    reseed time at the range floor. BODYWEIGHT: hold at the ceiling as a
 *    stable state (rationale 'maintain', target = range top) — deliberately
 *    no per-session "add load" nag and no synthetic progression demand.
 *  - Not met → same load, ask for +DURATION_PROGRESSION_STEP_S seconds
 *    (capped at the range top; never seed fewer seconds than were held).
 *  - Degenerate reference (no seconds) → hold at the range floor.
 */
export function recommendDurationSessionStart(
  input: SessionStartInput,
  loadable: boolean
): SetRecommendation {
  const [secMin, secMax] = input.targetRepRange;
  const prevSeconds = input.prevReps;
  const inc = input.minIncrementKg && input.minIncrementKg > 0 ? input.minIncrementKg : 2.5;
  const dev = Math.max(0, input.prevRir ?? input.targetRir) - input.targetRir;

  if (prevSeconds <= 0) {
    return {
      weightKg: Math.max(0, input.prevWeightKg),
      reps: secMin,
      rir: input.targetRir,
      rationale: 'maintain',
      effortVsTarget: 'on_target',
    };
  }

  const met = prevSeconds >= secMax;

  if (met && loadable && input.prevWeightKg > 0) {
    return {
      weightKg: roundToIncrement(input.prevWeightKg + inc, inc),
      reps: secMin,
      rir: input.targetRir,
      rationale: 'increase_load',
      effortVsTarget: effortVsTarget(dev),
    };
  }

  if (met) {
    // Bodyweight hold at the ceiling: a STABLE state, not a stall. Re-prescribe
    // the ceiling without nagging; harder variations are a coaching decision,
    // not an auto-prescription.
    return {
      weightKg: Math.max(0, input.prevWeightKg),
      reps: secMax,
      rir: input.targetRir,
      rationale: 'maintain',
      effortVsTarget: effortVsTarget(dev),
    };
  }

  return {
    weightKg: Math.max(0, input.prevWeightKg),
    reps: clamp(Math.max(prevSeconds + DURATION_PROGRESSION_STEP_S, prevSeconds), secMin, secMax),
    rir: input.targetRir,
    rationale: 'maintain',
    effortVsTarget: effortVsTarget(dev),
  };
}
