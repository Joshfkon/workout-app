/**
 * gymProximity — which saved gym the phone is probably standing in (pure).
 *
 * The location-scoped calibration feature is only as good as the session's
 * location being RIGHT, and the failure mode is silent: a scheduled workout
 * adopts the last-used gym, the user is somewhere else, and every machine
 * lift files under the wrong track. A phone position fix plus each gym's
 * learned coordinates (gym_locations.latitude/longitude, stamped the first
 * time the user picks that gym with a fix available) lets the picker rank
 * gyms by distance and badge the one the user is most likely inside.
 *
 * Pure functions only — the caller owns geolocation I/O (lib/geo) and the
 * gym rows. Distances are haversine great-circle metres; at gym scales the
 * spherical-earth error is centimetres and irrelevant.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** The minimal gym shape proximity needs; coordinates may be absent. */
export interface LocatedGym {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * A gym only counts as "you're probably here" within this radius. GPS inside
 * a big-box gym is easily 50–100 m off and parking lots add more, so this is
 * deliberately generous — but still far smaller than the distance between
 * two different gyms.
 */
export const NEARBY_GYM_RADIUS_M = 400;

const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in metres between two points. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GymProximityResult {
  /** Metres from the fix to each gym that has stored coordinates. */
  distancesM: Record<string, number>;
  /**
   * The closest gym within NEARBY_GYM_RADIUS_M, or null when none qualifies.
   * Never guesses: two gyms inside the radius resolve to the closer one, but
   * a gym without coordinates can never be suggested (or ruled out).
   */
  suggestedGymId: string | null;
}

/**
 * Rank gyms by distance from a position fix. Gyms without coordinates get no
 * distance entry — absence of data reads as "unknown", not "far away".
 */
export function rankGymsByDistance(
  gyms: readonly LocatedGym[],
  position: GeoPoint,
  nearbyRadiusM: number = NEARBY_GYM_RADIUS_M
): GymProximityResult {
  const distancesM: Record<string, number> = {};
  let suggestedGymId: string | null = null;
  let best = Infinity;

  for (const gym of gyms) {
    if (gym.latitude == null || gym.longitude == null) continue;
    const d = haversineMeters(position, {
      latitude: gym.latitude,
      longitude: gym.longitude,
    });
    distancesM[gym.id] = d;
    if (d <= nearbyRadiusM && d < best) {
      best = d;
      suggestedGymId = gym.id;
    }
  }

  return { distancesM, suggestedGymId };
}

/** "~120 m away" / "~2.3 km away" — the picker's distance subtitle. */
export function formatDistanceM(distanceM: number): string {
  if (distanceM < 950) return `~${Math.max(10, Math.round(distanceM / 10) * 10)} m away`;
  return `~${(distanceM / 1000).toFixed(distanceM < 9500 ? 1 : 0)} km away`;
}
