/**
 * What a new user said they're here for, captured at sign-up.
 *
 * The register form's "Do you lift weights?" question has a "No, food
 * tracking" answer; it is stored in the auth user's metadata as
 * `tracking_focus: 'food'`. Home reads it so a brand-new food tracker (no
 * food or weigh-ins logged yet, so nothing for homeFocus to go on) lands on
 * food first instead of "Ready to train?". Anything else — a skipped
 * question, an OAuth sign-up, a lifter — is null and changes nothing.
 */
export const TRACKING_FOCUS_METADATA_KEY = 'tracking_focus';

export type StatedTrackingFocus = 'food';

export function statedTrackingFocus(userMetadata: unknown): StatedTrackingFocus | null {
  if (!userMetadata || typeof userMetadata !== 'object') return null;
  const value = (userMetadata as Record<string, unknown>)[TRACKING_FOCUS_METADATA_KEY];
  return value === 'food' ? 'food' : null;
}
