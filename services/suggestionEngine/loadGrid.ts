/**
 * Loading grid (Phase D) — the achievable-load model for prescriptions.
 *
 * An exercise's loading reality is often a SET of increments, not one number:
 * a 10 lb stack machine with 2.5 lb hand-loaded add-ons can produce 182.5,
 * 185, 187.5 … — every multiple of the SMALLEST increment — even though the
 * stack itself only moves in 10s. The legacy single `minWeightIncrementKg`
 * carried the stack step alone, so the engine rounded real prescriptions off
 * the grid the lifter actually loads (187.5 → 182.5, twice, in the reference
 * session: a prescribed increase rendered as last session's load).
 *
 * Model: the achievable-load grid is multiples of the smallest available
 * increment. This deliberately does NOT model stack-position combinatorics
 * (10k, 10k + 2.5, …): with add-ons stackable and micro-plates placeable in
 * multiples, real-world loads land on the fine grid (182.5 / 192.5 / 195 all
 * exist on a 2.5 grid), and the fine grid never prescribes a load the lifter
 * can't build from stack + add-ons.
 *
 * Rules this module enforces (single source of truth for prescription
 * rounding against a reference load):
 *  1. Rounding uses the smallest available increment; the legacy single
 *     increment is the fallback when no set is recorded.
 *  2. NEVER round a prescription that is genuinely above the reference load
 *     down TO (or below) the reference — if the grid ties, round UP. A
 *     prescribed increase must never render as last session's load.
 *     (Mirror rule for reductions.)
 *  3. A prescription within HALF an increment of the reference is not a
 *     decision — hold the reference VERBATIM and say `noMeaningfulChange`,
 *     never render a no-op as a prescription.
 *
 * Pure functions — no DB calls, unit-agnostic numbers.
 */

import { roundToIncrement } from '@/lib/utils';

/** Engine-wide default when neither an increment set nor a legacy increment exists. */
export const DEFAULT_INCREMENT_KG = 2.5;

/**
 * The smallest loadable step for an exercise: the minimum of the available
 * increment set when one is recorded, else the legacy single increment, else
 * the engine default. Invalid entries (non-finite / non-positive) are ignored
 * rather than thrown — a malformed row must not break prescriptions.
 */
export function smallestIncrement(
  availableIncrementsKg?: number[] | null,
  fallbackIncrementKg?: number
): number {
  const valid = (availableIncrementsKg ?? []).filter(
    (x) => Number.isFinite(x) && x > 0
  );
  if (valid.length > 0) return Math.min(...valid);
  if (fallbackIncrementKg && Number.isFinite(fallbackIncrementKg) && fallbackIncrementKg > 0) {
    return fallbackIncrementKg;
  }
  return DEFAULT_INCREMENT_KG;
}

/**
 * Like smallestIncrement, but returns undefined when NO increment is
 * explicitly recorded — for consumers that must never act on a guessed step
 * (e.g. the light-load rep-ceiling extension, which only applies to a KNOWN
 * equipment step).
 */
export function smallestKnownIncrement(
  availableIncrementsKg?: number[] | null,
  fallbackIncrementKg?: number
): number | undefined {
  const valid = (availableIncrementsKg ?? []).filter(
    (x) => Number.isFinite(x) && x > 0
  );
  if (valid.length > 0) return Math.min(...valid);
  if (fallbackIncrementKg && Number.isFinite(fallbackIncrementKg) && fallbackIncrementKg > 0) {
    return fallbackIncrementKg;
  }
  return undefined;
}

export interface RoundPrescribedLoadResult {
  weightKg: number;
  /**
   * True when the raw prescription sat within half an increment of the
   * reference load: no meaningful change is available at this increment, the
   * reference is held VERBATIM (not re-rounded), and the UI must say so
   * instead of rendering the hold as a decision.
   */
  noMeaningfulChange: boolean;
  /** True when rule 2 fired (grid tie on an intended change → forced off the reference). */
  forcedOffReference: boolean;
}

/**
 * Round a raw prescribed load onto the achievable grid, honoring the
 * reference-load rules above. `referenceKg` is the load the prescription is
 * a decision AGAINST (last session's load, the recent working weight, the
 * just-completed set) — omit it for prescriptions with no reference (cold
 * start), which round plainly.
 */
export function roundPrescribedLoad(
  rawKg: number,
  opts: {
    availableIncrementsKg?: number[] | null;
    minIncrementKg?: number;
    referenceKg?: number;
  }
): RoundPrescribedLoadResult {
  const step = smallestIncrement(opts.availableIncrementsKg, opts.minIncrementKg);
  const reference = opts.referenceKg;

  if (reference !== undefined && reference > 0) {
    // Rule 3: within half an increment of the reference → hold verbatim.
    if (Math.abs(rawKg - reference) < step / 2) {
      return { weightKg: reference, noMeaningfulChange: true, forcedOffReference: false };
    }
    let rounded = roundToIncrement(rawKg, step);
    // Rule 2: an intended change must never render as the reference load
    // (the reference may sit off the grid — e.g. 182.5 on a 10-grid — so a
    // plain round can cross it). Ties round in the direction of the intent.
    if (rawKg > reference && rounded <= reference) {
      return {
        weightKg: reference + step,
        noMeaningfulChange: false,
        forcedOffReference: true,
      };
    }
    if (rawKg < reference && rounded >= reference) {
      return {
        weightKg: Math.max(step, reference - step),
        noMeaningfulChange: false,
        forcedOffReference: true,
      };
    }
    return { weightKg: rounded, noMeaningfulChange: false, forcedOffReference: false };
  }

  return {
    weightKg: roundToIncrement(rawKg, step),
    noMeaningfulChange: false,
    forcedOffReference: false,
  };
}
