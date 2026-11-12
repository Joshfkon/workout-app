/**
 * Decides whether the adaptive TDEE estimate may rewrite the user's
 * calorie / macro targets. Pure — `lib/actions/tdee.ts` owns the I/O.
 *
 * Targets are only ever rewritten automatically when the user opted in:
 * they have a `macro_settings` row (i.e. applied the macro calculator, which
 * records the goal the targets were computed for) AND
 * `auto_update_enabled` is still true. Hand-entered targets — no
 * `macro_settings` row, or auto-update switched off — are never touched.
 */

export type AdaptiveSyncBlockReason =
  | 'unstable'
  | 'stabilizing'
  | 'manual_targets'
  | 'auto_update_off'
  | 'within_tolerance';

export type AdaptiveSyncDecision =
  | { sync: true }
  | { sync: false; reason: AdaptiveSyncBlockReason; message: string };

/** Adaptive vs formula TDEE must differ by more than this to rewrite targets. */
export const ADAPTIVE_SYNC_MIN_DIFFERENCE_KCAL = 50;

export function decideAdaptiveSync(input: {
  confidence: 'unstable' | 'stabilizing' | 'stable' | null;
  adaptiveTDEE: number;
  formulaTDEE: number;
  /** The user's macro_settings row, or null when they never used the calculator. */
  macroSettings: { auto_update_enabled?: boolean | null } | null;
}): AdaptiveSyncDecision {
  const { confidence, adaptiveTDEE, formulaTDEE, macroSettings } = input;

  if (!confidence || confidence === 'unstable') {
    return {
      sync: false,
      reason: 'unstable',
      message: 'Not enough data yet. Keep logging to unlock personalized targets.',
    };
  }
  if (confidence === 'stabilizing') {
    return {
      sync: false,
      reason: 'stabilizing',
      message: 'Your estimate is stabilizing. A few more days of data needed.',
    };
  }
  if (Math.abs(adaptiveTDEE - formulaTDEE) <= ADAPTIVE_SYNC_MIN_DIFFERENCE_KCAL) {
    return { sync: false, reason: 'within_tolerance', message: 'Targets are already up to date.' };
  }
  if (!macroSettings) {
    return {
      sync: false,
      reason: 'manual_targets',
      message: 'Your targets were set manually, so they were left unchanged.',
    };
  }
  if (macroSettings.auto_update_enabled === false) {
    return {
      sync: false,
      reason: 'auto_update_off',
      message: 'Automatic target updates are off, so your targets were left unchanged.',
    };
  }
  return { sync: true };
}
