/**
 * Validation for user-editable volume landmarks.
 *
 * Lives outside the settings page because a Next.js page may only export the
 * page component — and because the bounded-component rule is domain logic, not
 * a UI detail.
 */

import {
  MUSCLE_VOLUME_AUTHORITY,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type StandardMuscleGroup,
  type VolumeLandmarks,
} from '@/types/schema';

/**
 * Ordering + bounded-component validation for one editable landmark row.
 * Returns a user-facing message, or null when the row is valid.
 *
 * This WARNS rather than blocking. Bounded component rows stay EDITABLE: their
 * values still drive local status and per-muscle progression, so making them
 * read-only would hide numbers that are behaviourally active. Customizations
 * that predate the bounded-component rule must also keep loading and saving —
 * silently rewriting a user's number would be worse than telling them it
 * conflicts with the group it sits inside.
 */
export function validateLandmarkRow(
  landmarks: Pick<VolumeLandmarks, 'mev' | 'mav' | 'mrv'>,
  parentMrv: number | null
): string | null {
  const { mev, mav, mrv } = landmarks;
  if (!(mev >= 0)) return 'MEV cannot be negative.';
  if (mev > mav) return 'MEV must be at or below MAV.';
  if (mav > mrv) return 'MAV must be at or below MRV.';
  if (parentMrv !== null && mrv > parentMrv) {
    return (
      `MRV ${mrv} exceeds the parent group's MRV of ${parentMrv}. A subtarget ` +
      `cannot claim more recoverable volume than the group it sits inside.`
    );
  }
  return null;
}

/**
 * The parent-group MRV that bounds `muscle`, or null when the muscle owns its
 * own capacity. Reads the caller's CURRENT landmark values so validation
 * tracks a user who has also edited the parent.
 */
export function parentMrvFor(
  muscle: StandardMuscleGroup,
  landmarks: Record<string, Pick<VolumeLandmarks, 'mrv'> | undefined>,
  fallback: Record<string, Pick<VolumeLandmarks, 'mrv'>>
): number | null {
  const parent = MUSCLE_VOLUME_AUTHORITY[muscle].parent;
  if (!parent) return null;
  return (landmarks[parent] ?? fallback[parent]).mrv;
}

/** "Counts within the overall calf volume limit" — the subtarget explainer. */
export function boundedComponentHint(
  muscle: StandardMuscleGroup,
  parentMrv: number | null
): string | null {
  const parent = MUSCLE_VOLUME_AUTHORITY[muscle].parent;
  if (!parent) return null;
  const parentName = STANDARD_MUSCLE_DISPLAY_NAMES[parent].toLowerCase();
  const limit = parentMrv !== null ? ` (MRV ${parentMrv})` : '';
  return (
    `Counts within the overall ${parentName} volume limit${limit} — this is a ` +
    `local subtarget, not extra capacity on top of it.`
  );
}
