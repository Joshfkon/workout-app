/**
 * "The user picked this workout's gym themselves" — per workout session, so
 * automatic gym selection (services/gymAutoSelect) never overrides it.
 *
 * The workout page tracks picks made in its own picker; this covers the
 * choice made BEFORE the page opens (the suggested-workout sheet's gym chips),
 * which only reaches the page as the session's location_id and is otherwise
 * indistinguishable from the default. sessionStorage: it only has to survive
 * the navigation into the workout, and storage failures (private mode) just
 * mean auto-select may run, which the "Change" toast lets the user undo.
 */

const key = (sessionId: string) => `hypertrack:gym-chosen:${sessionId}`;

export function markGymChosen(sessionId: string): void {
  try {
    sessionStorage.setItem(key(sessionId), '1');
  } catch {
    // Storage unavailable: auto-select may run; the toast offers Change.
  }
}

export function wasGymChosen(sessionId: string): boolean {
  try {
    return sessionStorage.getItem(key(sessionId)) === '1';
  } catch {
    return false;
  }
}
