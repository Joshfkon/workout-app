/**
 * Delta framing for prescribed loads (Phase 0, INV-4).
 *
 * Live defect (Arnold Press, Jul 27): the set-4 banner read "down 5 lbs" —
 * measured off TODAY's set 3 (47.5) — when position-matched against last
 * session's set 4 (40) the lifter was UP 2.5. Last-set-relative framing told
 * a lifter they were regressing during a session in which they beat every
 * set position.
 *
 * Rule: a load delta in banner copy must compare LIKE TO LIKE — the
 * prescribed set vs the SAME set position last session — or say nothing.
 * The just-completed set is a different position under different fatigue; it
 * is never a valid comparison basis for a delta number.
 *
 * Pure function, display-unit numbers in → copy out.
 */

/**
 * Frame the prescribed load against the same set position last session.
 *
 * @param prescribedDisplay      Prescribed load, in DISPLAY units (post-conversion).
 * @param positionalPrevDisplay  The load the SAME position carried last
 *                               session (display units), or undefined when no
 *                               comparable positional set exists.
 * @param setNumber              1-indexed set position being prescribed.
 * @param unitLabel              'lbs' | 'kg' — appended to the delta.
 * @returns Copy like "up 2.5 lbs vs set 4 last session", or null when there
 *          is no positional reference — in which case the caller must not
 *          render any delta number at all.
 */
export function framePositionalDelta(
  prescribedDisplay: number,
  positionalPrevDisplay: number | undefined,
  setNumber: number,
  unitLabel: string
): string | null {
  if (
    positionalPrevDisplay === undefined ||
    !(positionalPrevDisplay > 0) ||
    !Number.isFinite(prescribedDisplay) ||
    !(prescribedDisplay > 0)
  ) {
    return null;
  }
  const delta = Number((prescribedDisplay - positionalPrevDisplay).toFixed(1));
  if (delta === 0) return `matches set ${setNumber} last session`;
  const magnitude = Math.abs(delta);
  return `${delta > 0 ? 'up' : 'down'} ${magnitude} ${unitLabel} vs set ${setNumber} last session`;
}
