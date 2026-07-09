/**
 * Thin wrapper around the shared intake pacing engine
 * (services/intakePacing) for the Home surfaces. Kept so existing callers
 * (Nutrition glance tile, "Log dinner" meal hero) have a one-line API while
 * the Log page's macro grid calls assessIntakePace directly — one source of
 * truth, so both pages always show the same verdict for the same state.
 */

import {
  assessIntakePace,
  DEFAULT_EATING_WINDOW,
  type EatingWindow,
  type PaceMacro,
  type PaceStatus,
  type PaceVerdict,
  type PacingPhase,
} from '@/services/intakePacing';

export type { PaceStatus, PaceVerdict };

/**
 * Phase-aware pacing verdict for one macro. Defaults to calories on
 * maintenance over the 07:00–21:00 window when the caller has no better
 * context.
 */
export function intakePaceVerdict(
  consumed: number,
  target: number | null | undefined,
  now: Date = new Date(),
  phase: PacingPhase = 'maintenance',
  window: EatingWindow = DEFAULT_EATING_WINDOW,
  macro: PaceMacro = 'calories'
): PaceVerdict {
  return assessIntakePace({ macro, consumed, target, phase, now, window });
}

/** One-word status ('on pace' | 'behind' | 'ahead') from the shared engine. */
export function intakePaceLabel(
  consumed: number,
  target: number,
  now: Date = new Date(),
  phase: PacingPhase = 'maintenance',
  window: EatingWindow = DEFAULT_EATING_WINDOW
): PaceStatus {
  return intakePaceVerdict(consumed, target, now, phase, window).status;
}
