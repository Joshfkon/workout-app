/**
 * Canonical e1RM estimator — THE single source of truth.
 *
 * Every e1RM shown, stored, or used as a capacity anchor anywhere in the app
 * must come from this function (directly or through a delegating wrapper).
 * History: five divergent implementations produced a 91 lb disagreement on the
 * same set (engine 284 vs history card 193) — see
 * docs/E1RM_PRESCRIPTION_AUDIT_FINDINGS.md and
 * docs/CALIBRATION_BIAS_AUDIT_FINDINGS.md.
 *
 * Model (per the approved Phase 1 spec):
 *  - effective reps = reps + RIR
 *  - effective reps ≤ 12  → compute, confidence 'high'
 *  - 12 < effective reps ≤ 15 → compute AT THE CAP (clamped to 12),
 *    confidence 'medium' — the estimate is a floor, not an extrapolation
 *  - effective reps > 15 → **null**. No formula is valid out there; a null
 *    that renders as "no estimate" is correct, 284 lbs is not.
 *
 * Formula: Brzycki, weight × 36/(37 − effectiveReps), one formula for the
 * whole domain:
 *  - it is what the history-anchor path already used at ≤ 12 effective reps,
 *    so estimates in the sane range are unchanged;
 *  - a single formula plus a flat clamp is trivially C0-continuous and
 *    monotone non-decreasing in reps (gaining a rep can never lower the
 *    estimate — the old Brzycki→linear-Epley handoff at 12 dropped 2.8%);
 *  - at reps 1 / RIR 0 it returns exactly the weight (36/36) with no special
 *    case.
 *
 * NOTE the deliberate non-consumer: services/setRecommender's internal
 * weight↔reps curve (Epley and its inverse in `prescribe`) is a prescription
 * curve, not an estimator display — unifying it is the Phase 4 single-anchor
 * work, tracked separately.
 *
 * Units: unit-agnostic (pounds in → pounds out). Pure, no side effects.
 */

import { rpeToRir } from '@/types/schema';

export type E1RMConfidence = 'high' | 'medium';

export interface E1RMEstimate {
  value: number;
  confidence: E1RMConfidence;
}

/** Effective-rep bound for a full-confidence estimate. */
export const E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS = 12;

/** Effective-rep bound beyond which NO estimate is produced. */
export const E1RM_MAX_EFFECTIVE_REPS = 15;

function brzycki(weight: number, effectiveReps: number): number {
  return weight * (36 / (37 - effectiveReps));
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Estimate a 1RM from a performed set.
 *
 * @param weight  Load lifted (any unit; result is in the same unit).
 * @param reps    Reps performed (> 0).
 * @param rir     Reps in reserve on the set (≥ 0; negatives are clamped to 0
 *                — "past failure" carries no extra information the formula
 *                can use). Defaults to 0 (taken to failure).
 * @returns The estimate with its confidence, or null when no valid estimate
 *          exists (bad inputs, or effective reps beyond the formula's domain).
 */
export function estimateE1RM(
  weight: number,
  reps: number,
  rir: number = 0
): E1RMEstimate | null {
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps <= 0) {
    return null;
  }
  const effectiveReps = reps + Math.max(0, Number.isFinite(rir) ? rir : 0);

  if (effectiveReps > E1RM_MAX_EFFECTIVE_REPS) return null;

  if (effectiveReps > E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS) {
    return {
      value: round1(brzycki(weight, E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS)),
      confidence: 'medium',
    };
  }
  return { value: round1(brzycki(weight, effectiveReps)), confidence: 'high' };
}

/**
 * RPE-input convenience wrapper. THE single RPE→RIR conversion for e1RM
 * purposes is the bucketed `rpeToRir` from types/schema — the same one the
 * suggestion engine reads sets with. (The raw `10 − rpe` and
 * `Math.round(10 − rpe)` variants disagree with it at RPE 7.5 and are being
 * retired.) An absent RPE is treated as taken to failure (RIR 0), matching
 * every prior implementation's default.
 */
export function estimateE1RMFromRpe(
  weight: number,
  reps: number,
  rpe?: number | null
): E1RMEstimate | null {
  const rir = rpe != null && rpe > 0 ? Math.max(0, rpeToRir(rpe)) : 0;
  return estimateE1RM(weight, reps, rir);
}

/**
 * Numeric compatibility helpers for AGGREGATION contexts (max/avg/sort) where
 * a missing estimate must simply never win: 0 means "no estimate".
 *
 * DISPLAY surfaces must NOT print the 0 — they gate on > 0 (or use the
 * nullable form) and render "no estimate" instead. Per no-silent-failures,
 * never let the 0 reach the user as a value.
 */
export function e1rmValue(weight: number, reps: number, rir: number = 0): number {
  return estimateE1RM(weight, reps, rir)?.value ?? 0;
}

export function e1rmValueFromRpe(weight: number, reps: number, rpe?: number | null): number {
  return estimateE1RMFromRpe(weight, reps, rpe)?.value ?? 0;
}

/**
 * PRESCRIPTION-SPACE implied e1RM — the canonical estimator's value with the
 * beyond-domain null lifted to its flat floor. Same Brzycki formula, same
 * 12-effective-rep clamp; the ONLY difference from `estimateE1RM` is that
 * effective reps past 15 return the eff-12 floor value instead of null.
 *
 * WHY IT EXISTS: cap/floor comparisons in the prescription pipeline need a
 * TOTAL function. A high-rep ask (e.g. 65×15 @2 RIR = 17 effective reps) has
 * no valid point ESTIMATE — but its true capacity is provably AT LEAST the
 * flat floor (the estimator is monotone non-decreasing in reps), so for
 * "does this ask exceed the session cap?" the floor is the honest, canonical
 * answer. Comparing raw rep counts across different loads instead is the
 * unit error that produced the 2026-07-29 pushdown defect (a 72.5-load rep
 * count capping a 65-load ask).
 *
 * NEVER for display: surfaces must keep using `estimateE1RM` and render
 * "no estimate" beyond the domain. Ordering caveat: within the flat region
 * (eff ≥ 12 at one load) all rep counts compare EQUAL — callers needing
 * strict progression there must move the load, not the reps.
 *
 * Returns null only for invalid inputs (non-finite / non-positive).
 */
export function impliedE1RMFloor(
  weight: number,
  reps: number,
  rir: number = 0
): number | null {
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps <= 0) {
    return null;
  }
  const effectiveReps = reps + Math.max(0, Number.isFinite(rir) ? rir : 0);
  return round1(
    brzycki(weight, Math.min(effectiveReps, E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS))
  );
}
