/**
 * Rest prescription — THE working-set rest duration, effort-modulated.
 *
 * Before this module, rest had four copy-pasted call sites in the workout
 * page all reading `targetRestSeconds ?? 180`, and NOTHING anywhere read the
 * effort of the set just performed: a set taken to 0 RIR earned exactly the
 * same rest as one left at 4 (live-session finding). The only RIR↔rest
 * coupling in the app was diagnostic (sanityChecks warns when observed rest
 * disagrees with reported RIR) — this module makes the prescription side
 * agree with what the sanity check already believes.
 *
 * Rules:
 *  - Base = the block's stored rest; a missing/zero/invalid base falls back
 *    to DEFAULT_REST_SECONDS LOUDLY (the fallback is named in the note —
 *    never a silent `?? 180`).
 *  - The last set's resolved RIR vs the effective target:
 *      dev ≤ −DEADBAND_RIR  → +REST_EXTEND_FAILURE_S (at/past the failure
 *                             deadband: the base rest was priced for a
 *                             submaximal set);
 *      dev ≤ −1             → +REST_EXTEND_HARD_S (a full rep hotter than
 *                             target; the half-chip tolerance (RPE-7.5 chip
 *                             → RIR 2.5) is deliberately NOT an extension).
 *  - An EASIER-than-target set never shortens rest: the lever for a too-easy
 *    set is load (the suggestion engine's job), not rushed recovery — and
 *    cutting rest degrades the very next-set quality the engine grades.
 *  - No effort signal (rir undefined — e.g. a dropset finale, which is
 *    to-failure by design and priced by its base rest) → base rest.
 *  - Everything caps at REST_MAX_S (the DB bound).
 *
 * Every adjustment carries a human-readable note the rest bar must render —
 * a modulated timer that looks like the stock one is a silent failure.
 *
 * Pure function — no DB calls or side effects.
 */

import {
  DEFAULT_REST_SECONDS,
  REST_EXTEND_FAILURE_S,
  REST_EXTEND_HARD_S,
  REST_MAX_S,
} from './suggestionEngine/constants';
import { gradeEffort } from './suggestionEngine/effortGrade';

export interface RestPrescriptionInput {
  /** The block's stored rest (target_rest_seconds). Invalid/0 → loud default. */
  baseSeconds: number | null | undefined;
  /**
   * Resolved RIR of the set just completed (resolveLastRir read order:
   * feedback.repsInTank, then rpe→RIR). Omit when the set carries no honest
   * effort signal for rest purposes (e.g. dropset finales).
   */
  lastSetRir?: number;
  /**
   * The EFFECTIVE target RIR for this block — after calibration adjustment
   * and readiness modulation, i.e. the same number the suggestion banner
   * grades effort against. Passing the raw block target when an adjusted one
   * exists would make rest and the banner disagree about "harder than
   * target".
   */
  targetRir: number;
}

export interface RestPrescription {
  /** Seconds to run the rest timer for. */
  seconds: number;
  /** Seconds added by effort modulation (0 = base rest). */
  adjustmentSeconds: number;
  /**
   * Why the number isn't the plain stored rest (effort extension and/or the
   * default-base fallback), for the rest bar. Null = base rest, nothing to
   * explain.
   */
  note: string | null;
}

export function prescribeRestSeconds(input: RestPrescriptionInput): RestPrescription {
  const notes: string[] = [];

  let base = input.baseSeconds ?? 0;
  if (!Number.isFinite(base) || base <= 0) {
    base = DEFAULT_REST_SECONDS;
    notes.push('no stored rest — using 3:00');
  }

  // Graded through the SHARED reading (services/suggestionEngine/effortGrade)
  // — the same object the suggestion engines grade against, so the rest bar
  // and the prescription banner can never describe one set two ways.
  let adjustmentSeconds = 0;
  const effort = gradeEffort(input.lastSetRir, input.targetRir);
  if (effort) {
    if (effort.pastDeadband) {
      adjustmentSeconds = REST_EXTEND_FAILURE_S;
      notes.push(`+${REST_EXTEND_FAILURE_S}s — last set at/near failure`);
    } else if (effort.hotterThanTarget) {
      adjustmentSeconds = REST_EXTEND_HARD_S;
      notes.push(`+${REST_EXTEND_HARD_S}s — last set ran hotter than target`);
    }
  }

  const seconds = Math.min(REST_MAX_S, Math.round(base + adjustmentSeconds));
  return {
    seconds,
    adjustmentSeconds,
    note: notes.length > 0 ? notes.join(' · ') : null,
  };
}
