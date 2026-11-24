/**
 * How the Eat page confirms an add where the eye already is: the new row in
 * its meal stays tinted and labelled for JUST_ADDED_MS, and is scrolled to
 * the middle of the screen when it would otherwise sit under the fixed
 * chrome (header on top; tab bar + toast at the bottom).
 *
 * Panel finding (r20, 4 of 6): "Tapping a quick-add chip gave little visible
 * confirmation that the food was added to the meal." In the screenshots the
 * new row had been scrolled to the bottom edge, under the tab bar and an
 * older toast.
 */

/** How long a just-added row stays highlighted and labelled. */
export const JUST_ADDED_MS = 6000;

/** Fixed header height to keep clear of (px). */
const TOP_CLEARANCE = 72;
/** Tab bar + one toast to keep clear of at the bottom (px). */
const BOTTOM_CLEARANCE = 180;

/**
 * True when a row at `rect` would be hidden or half-hidden by the fixed
 * chrome, so it should be scrolled to the centre. A row already in the clear
 * middle band is left alone (no jump).
 */
export function rowNeedsScroll(rect: { top: number; bottom: number }, viewportHeight: number): boolean {
  return rect.top < TOP_CLEARANCE || rect.bottom > viewportHeight - BOTTOM_CLEARANCE;
}
