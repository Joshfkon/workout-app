/**
 * gymAutoSelect — when to switch a workout to the gym the phone is in, and
 * when to learn a gym's position (pure).
 *
 * gymProximity ranks gyms for the picker's "Near you" badge, where a wrong
 * guess costs nothing. Switching the session's gym automatically files every
 * machine lift under that gym's calibration track, so these rules are
 * stricter than the badge's:
 *  - a tighter radius and an accurate fix,
 *  - no guess when two known gyms are both close,
 *  - never override a gym the user picked, never move once sets are logged.
 *
 * Learning: a gym's coordinates used to be stamped only from the picker, so a
 * gym trained at for months could have none and could never be auto-picked.
 * Logging a set at a gym with no position, with an accurate fix and no other
 * known gym nearby, is strong enough evidence to save its position.
 *
 * Pure functions only; the caller owns geolocation I/O (lib/geo) and writes.
 */

import { haversineMeters, type LocatedGym } from './gymProximity';

/** Auto-select only within this distance of a gym's saved position. */
export const AUTO_SELECT_RADIUS_M = 200;
/** Fixes less accurate than this never move a session or teach a position. */
export const AUTO_SELECT_MAX_ACCURACY_M = 100;
/**
 * When the closest two known gyms are both in range and this close to each
 * other's distance, the fix can't tell them apart: don't guess.
 */
export const AUTO_SELECT_AMBIGUITY_MARGIN_M = 75;

export interface AutoSelectFix {
  latitude: number;
  longitude: number;
  accuracyM: number;
}

export interface ChooseAutoGymInput {
  gyms: LocatedGym[];
  position: AutoSelectFix | null;
  /** The session's current gym (null when none is set). */
  currentGymId: string | null;
  /** The user picked the gym for this workout themselves. */
  chosenManually: boolean;
  /** Any set already logged in this workout. */
  hasLoggedSets: boolean;
}

const hasCoordinates = (g: LocatedGym): g is LocatedGym & { latitude: number; longitude: number } =>
  typeof g.latitude === 'number' && typeof g.longitude === 'number';

const distancesFrom = (gyms: LocatedGym[], position: AutoSelectFix) =>
  gyms
    .filter(hasCoordinates)
    .map((g) => ({ id: g.id, distanceM: haversineMeters(position, g) }))
    .sort((a, b) => a.distanceM - b.distanceM);

/**
 * The gym to switch this workout to, or null to leave it alone (already
 * right, user chose, sets logged, no accurate fix, nothing close, or two
 * gyms too close to call).
 */
export function chooseAutoGym(input: ChooseAutoGymInput): string | null {
  const { gyms, position, currentGymId, chosenManually, hasLoggedSets } = input;
  if (chosenManually || hasLoggedSets) return null;
  if (!position || position.accuracyM > AUTO_SELECT_MAX_ACCURACY_M) return null;

  const inRange = distancesFrom(gyms, position).filter((d) => d.distanceM <= AUTO_SELECT_RADIUS_M);
  if (inRange.length === 0) return null;
  const [closest, runnerUp] = inRange;
  if (runnerUp && runnerUp.distanceM - closest.distanceM < AUTO_SELECT_AMBIGUITY_MARGIN_M) {
    return null;
  }
  return closest.id === currentGymId ? null : closest.id;
}

/**
 * Whether to save `fix` as the position of the gym a set was just logged at:
 * the gym has no position yet, the fix is accurate, and no OTHER known gym is
 * in range (then the user is more likely at that gym and forgot to switch).
 */
export function shouldLearnGymPosition(input: {
  gymId: string | null;
  gyms: LocatedGym[];
  position: AutoSelectFix | null;
}): boolean {
  const { gymId, gyms, position } = input;
  if (!gymId || !position || position.accuracyM > AUTO_SELECT_MAX_ACCURACY_M) return false;
  const gym = gyms.find((g) => g.id === gymId);
  if (!gym || hasCoordinates(gym)) return false;
  return !distancesFrom(gyms, position).some(
    (d) => d.id !== gymId && d.distanceM <= AUTO_SELECT_RADIUS_M
  );
}
