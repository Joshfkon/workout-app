/**
 * locationTracks — splitting DISPLAYED history by gym (pure).
 *
 * services/progressionScope decides which history feeds a machine lift's
 * SUGGESTION. The graphs never went through it: every chart and trend drew one
 * line across every gym, so a session on a lighter-reading machine plotted as a
 * 35% "regression" and tripped the trend verdicts. This module is the display
 * half of the same idea — for a `local`-scope exercise, each gym is its own
 * track and trends are only ever computed within one.
 *
 * Deliberately different from the suggestion path in one respect: legacy
 * null-location sessions are NOT attributed to the most-used gym here. A graph
 * is a statement about where you lifted, so unknown stays unknown ("No gym
 * recorded") and the user can re-file it from History or Settings.
 *
 * Nothing here converts loads between gyms — there is no such math anywhere in
 * the app, by design (see progressionScope).
 */

import type { ProgressionScope } from './progressionScope';

/** Track key for sessions with no recorded location (legacy / unknown). */
export const UNASSIGNED_TRACK_KEY = 'unassigned';

/** Label for the unassigned track. */
export const UNASSIGNED_TRACK_LABEL = 'No gym recorded';

/** Stable key for a location id (null/undefined → the unassigned track). */
export function trackKeyFor(locationId: string | null | undefined): string {
  return locationId ?? UNASSIGNED_TRACK_KEY;
}

/** Inverse of trackKeyFor. */
export function locationIdForTrack(key: string): string | null {
  return key === UNASSIGNED_TRACK_KEY ? null : key;
}

/**
 * Display name for a track. A location whose name we don't have (deleted gym
 * rows cascade to NULL, so this is mostly a not-yet-loaded name) falls back to
 * a neutral label rather than an id.
 */
export function trackLabel(
  locationId: string | null | undefined,
  names: Record<string, string> = {}
): string {
  if (!locationId) return UNASSIGNED_TRACK_LABEL;
  return names[locationId] ?? 'Unnamed gym';
}

export interface LocationTrack {
  key: string;
  locationId: string | null;
  label: string;
  /** Items (sessions) on this track. */
  count: number;
  /** Latest item date on this track (ISO or YYYY-MM-DD; compared as strings). */
  latestDate: string;
}

/**
 * Group items into location tracks, most recently used first (ties → more
 * items first, then key, so the order is deterministic). Dates are compared as
 * strings, so callers must pass one consistent format.
 */
export function buildLocationTracks<T>(
  items: readonly T[],
  getLocationId: (item: T) => string | null | undefined,
  getDate: (item: T) => string,
  names: Record<string, string> = {}
): LocationTrack[] {
  const byKey = new Map<string, LocationTrack>();
  for (const item of items) {
    const locationId = getLocationId(item) ?? null;
    const key = trackKeyFor(locationId);
    const date = getDate(item);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      if (date > existing.latestDate) existing.latestDate = date;
    } else {
      byKey.set(key, {
        key,
        locationId,
        label: trackLabel(locationId, names),
        count: 1,
        latestDate: date,
      });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) =>
      b.latestDate.localeCompare(a.latestDate) ||
      b.count - a.count ||
      a.key.localeCompare(b.key)
  );
}

/**
 * Whether a history should be shown per gym: only machine-class (`local`)
 * exercises, and only when there is more than one track to separate. A
 * barbell is a barbell anywhere; a single-gym history needs no selector.
 */
export function shouldSplitByLocation(
  scope: ProgressionScope | null | undefined,
  tracks: readonly LocationTrack[]
): boolean {
  return scope === 'local' && tracks.length > 1;
}

/**
 * Pick the track a view should open on: the preferred location's track when it
 * exists (e.g. the gym you are standing in), else the most recently used one.
 * Returns null when there are no tracks.
 */
export function defaultTrackKey(
  tracks: readonly LocationTrack[],
  preferredLocationId?: string | null
): string | null {
  if (tracks.length === 0) return null;
  if (preferredLocationId !== undefined) {
    const preferredKey = trackKeyFor(preferredLocationId);
    if (tracks.some((t) => t.key === preferredKey)) return preferredKey;
  }
  return tracks[0].key;
}
