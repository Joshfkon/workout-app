/**
 * Effort grading — THE single reading of "how did that set go against the
 * effort we asked for?".
 *
 * Before this module the same comparison was written three times, with three
 * subtly different clamps and three different thresholds:
 *
 *   - services/restPrescription.ts      `max(0,rir) − max(0,target)`, extends at ≤ −1
 *   - services/suggestionEngine/repTotalPolicy.ts  `rir − target`, reacts at ≤ −DEADBAND_RIR
 *   - services/setRecommender.ts        `max(0,rir) − target`, reacts at ≤ −DEADBAND_RIR
 *
 * That split is what produced the reported live defect's most confusing
 * symptom: on a set logged at 1 RIR against a 2-RIR target, the rest timer
 * announced "+30s — last set ran hotter than target" while the prescription
 * said nothing and re-served its previous ask. Two consumers, one set, two
 * verdicts — which reads as "the set data isn't reaching the engine" even
 * though it was. See docs/PRESCRIPTION_STALENESS_AUDIT.md §2.
 *
 * Every consumer now grades through `gradeEffort`, so a set is described the
 * same way everywhere it is described at all. Consumers may still ACT at
 * different thresholds — rest extends earlier than the load lever moves, by
 * design — but they read those thresholds off the same graded object, and
 * `hotterThanTarget` / `pastDeadband` are named here rather than re-derived.
 *
 * Pure functions — no DB calls or side effects.
 */

import { DEADBAND_RIR, EFFORT_MATCH_TOLERANCE } from './constants';

export type EffortVsTarget = 'easier' | 'on_target' | 'harder';

export interface EffortGrade {
  /**
   * Resolved RIR minus target RIR. Positive = easier than asked (reps left
   * over), negative = harder. Both sides floored at 0: RIR is non-negative
   * by domain, and a negative one is malformed input, not "past failure".
   */
  dev: number;
  /**
   * Copy grammar for banners. `on_target` is the EFFORT_MATCH_TOLERANCE
   * band — deliberately narrower than any action threshold, so a banner
   * never claims "matched the target" for a set that measurably didn't.
   */
  vsTarget: EffortVsTarget;
  /**
   * A full rep or more hotter than target (dev ≤ −1). The rest timer's
   * extension threshold, and the weakest signal any consumer acts on.
   */
  hotterThanTarget: boolean;
  /**
   * At or past the failure deadband (dev ≤ −DEADBAND_RIR) — e.g. 0 RIR
   * against a 2-RIR target. The load lever's threshold.
   */
  pastDeadband: boolean;
}

/**
 * Grade a completed set's effort against the target reserve.
 *
 * Returns `null` when the set carries NO effort signal (`rir` undefined).
 * That is deliberate and load-bearing: the alternative — treating an unrated
 * set as on-target — is a silent failure, and it is the reason
 * `resolveLastRir`'s target-RIR fallback must never be applied before this
 * call. Callers handle the null case explicitly.
 */
export function gradeEffort(
  rir: number | null | undefined,
  targetRir: number
): EffortGrade | null {
  if (rir === null || rir === undefined || !Number.isFinite(rir)) return null;

  const dev = Math.max(0, rir) - Math.max(0, targetRir);
  return {
    dev,
    vsTarget:
      dev >= EFFORT_MATCH_TOLERANCE
        ? 'easier'
        : dev <= -EFFORT_MATCH_TOLERANCE
          ? 'harder'
          : 'on_target',
    hotterThanTarget: dev <= -1,
    pastDeadband: dev <= -DEADBAND_RIR,
  };
}
