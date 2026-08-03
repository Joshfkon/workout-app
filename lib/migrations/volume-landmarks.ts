/**
 * Volume-landmark schema versioning + scalar-field migration.
 *
 * WHY THIS EXISTS
 * ---------------
 * `users.volume_landmarks` is a JSONB map keyed by StandardMuscleGroup. It
 * starts EMPTY at signup, but the settings page writes back the WHOLE merged
 * object on every save (`{...DEFAULT_VOLUME_LANDMARKS[exp], ...stored}`), so a
 * user who has ever opened Settings has all rows persisted. Presence is
 * therefore useless as a "did the user customize this?" signal.
 *
 * The only usable signal is VALUE EQUALITY against the previous defaults. So
 * we freeze the v1 table here and migrate PER SCALAR FIELD: a field still
 * equal to its old default is untouched and moves to the new default; anything
 * else is the user's and is preserved verbatim. Customizing MEV must not pin a
 * row's MRV to a stale value.
 *
 * EXPERIENCE AMBIGUITY (documented, accepted)
 * -------------------------------------------
 * Historical experience level was never versioned alongside the landmarks, and
 * a user can change experience after saving. So a stored scalar is compared
 * against the SAME muscle and SAME field across ALL prior experience-level
 * defaults, not just the user's current level. Unrelated muscles and unrelated
 * fields are never cross-compared.
 *
 * Rare, accepted ambiguity: a hand-entered value that happens to equal another
 * experience level's old default for the same muscle+field is indistinguishable
 * from an untouched default and will migrate. Given the v1 -> v2 delta is two
 * cells of one muscle (triceps_lat_med MRV), the blast radius is negligible.
 */

import {
  DEFAULT_VOLUME_LANDMARKS,
  STANDARD_MUSCLE_GROUPS,
  isStandardMuscle,
  type Experience,
  type StandardMuscleGroup,
  type VolumeLandmarks,
} from '@/types/schema';

/** Current landmark schema version. Bump whenever DEFAULT_VOLUME_LANDMARKS changes. */
export const LANDMARK_VERSION = 2;

/** Where the version lives on the user record (a scalar — NOT inside a muscle row). */
export const LANDMARK_VERSION_PREFERENCE_KEY = 'landmarkVersion';

const EXPERIENCES: readonly Experience[] = ['novice', 'intermediate', 'advanced'];
const LANDMARK_FIELDS = ['mev', 'mav', 'mrv'] as const;
type LandmarkField = (typeof LANDMARK_FIELDS)[number];

/**
 * FROZEN snapshot of the v1 defaults (the table as it stood before the
 * bounded-component compatibility clamp). NEVER EDIT THIS. When
 * DEFAULT_VOLUME_LANDMARKS changes again, add LANDMARKS_V2 and chain the
 * migration; do not retrofit this object, or every user who accepted the v1
 * default silently becomes "customized".
 *
 * Delta v1 -> v2 (the whole of it):
 *   intermediate.triceps_lat_med.mrv 20 -> 18
 *   advanced.triceps_lat_med.mrv     24 -> 22
 */
export const LANDMARKS_V1: Record<Experience, Record<StandardMuscleGroup, VolumeLandmarks>> = Object.freeze({
  novice: {
    chest_upper: { mev: 4, mav: 8, mrv: 12 },
    chest_lower: { mev: 3, mav: 6, mrv: 10 },
    front_delts: { mev: 2, mav: 6, mrv: 10 },
    lateral_delts: { mev: 4, mav: 10, mrv: 16 },
    rear_delts: { mev: 4, mav: 10, mrv: 16 },
    lats: { mev: 6, mav: 10, mrv: 16 },
    upper_back: { mev: 4, mav: 8, mrv: 14 },
    traps: { mev: 3, mav: 8, mrv: 14 },
    upper_traps: { mev: 2, mav: 6, mrv: 10 },
    mid_lower_traps: { mev: 0, mav: 4, mrv: 8 },
    biceps: { mev: 4, mav: 10, mrv: 14 },
    triceps: { mev: 4, mav: 10, mrv: 14 },
    triceps_long: { mev: 3, mav: 7, mrv: 12 },
    triceps_lat_med: { mev: 4, mav: 9, mrv: 14 },
    forearms: { mev: 2, mav: 6, mrv: 12 },
    quads: { mev: 6, mav: 12, mrv: 18 },
    hamstrings: { mev: 4, mav: 10, mrv: 14 },
    glutes: { mev: 4, mav: 10, mrv: 16 },
    glute_med: { mev: 0, mav: 4, mrv: 8 },
    adductors: { mev: 2, mav: 6, mrv: 10 },
    calves: { mev: 6, mav: 12, mrv: 18 },
    gastrocnemius: { mev: 4, mav: 8, mrv: 14 },
    soleus: { mev: 2, mav: 6, mrv: 10 },
    abs: { mev: 3, mav: 8, mrv: 14 },
    obliques: { mev: 0, mav: 4, mrv: 8 },
    erectors: { mev: 2, mav: 6, mrv: 10 },
  },
  intermediate: {
    chest_upper: { mev: 6, mav: 10, mrv: 16 },
    chest_lower: { mev: 4, mav: 8, mrv: 12 },
    front_delts: { mev: 3, mav: 8, mrv: 12 },
    lateral_delts: { mev: 6, mav: 14, mrv: 20 },
    rear_delts: { mev: 6, mav: 12, mrv: 18 },
    lats: { mev: 8, mav: 14, mrv: 20 },
    upper_back: { mev: 6, mav: 10, mrv: 16 },
    traps: { mev: 4, mav: 10, mrv: 16 },
    upper_traps: { mev: 3, mav: 8, mrv: 12 },
    mid_lower_traps: { mev: 0, mav: 6, mrv: 10 },
    biceps: { mev: 6, mav: 12, mrv: 18 },
    triceps: { mev: 6, mav: 12, mrv: 18 },
    triceps_long: { mev: 4, mav: 10, mrv: 18 },
    triceps_lat_med: { mev: 6, mav: 12, mrv: 20 },
    forearms: { mev: 3, mav: 8, mrv: 14 },
    quads: { mev: 8, mav: 14, mrv: 22 },
    hamstrings: { mev: 6, mav: 12, mrv: 18 },
    glutes: { mev: 6, mav: 12, mrv: 20 },
    glute_med: { mev: 0, mav: 6, mrv: 10 },
    adductors: { mev: 3, mav: 8, mrv: 12 },
    calves: { mev: 8, mav: 14, mrv: 22 },
    gastrocnemius: { mev: 6, mav: 10, mrv: 16 },
    soleus: { mev: 3, mav: 8, mrv: 12 },
    abs: { mev: 4, mav: 10, mrv: 18 },
    obliques: { mev: 0, mav: 6, mrv: 10 },
    erectors: { mev: 3, mav: 8, mrv: 12 },
  },
  advanced: {
    chest_upper: { mev: 8, mav: 14, mrv: 20 },
    chest_lower: { mev: 5, mav: 10, mrv: 14 },
    front_delts: { mev: 4, mav: 10, mrv: 14 },
    lateral_delts: { mev: 8, mav: 18, mrv: 26 },
    rear_delts: { mev: 8, mav: 16, mrv: 22 },
    lats: { mev: 10, mav: 18, mrv: 26 },
    upper_back: { mev: 8, mav: 14, mrv: 20 },
    traps: { mev: 6, mav: 12, mrv: 20 },
    upper_traps: { mev: 4, mav: 10, mrv: 14 },
    mid_lower_traps: { mev: 0, mav: 8, mrv: 12 },
    biceps: { mev: 8, mav: 16, mrv: 22 },
    triceps: { mev: 8, mav: 16, mrv: 22 },
    triceps_long: { mev: 6, mav: 13, mrv: 20 },
    triceps_lat_med: { mev: 8, mav: 15, mrv: 24 },
    forearms: { mev: 4, mav: 10, mrv: 16 },
    quads: { mev: 10, mav: 18, mrv: 26 },
    hamstrings: { mev: 8, mav: 14, mrv: 22 },
    glutes: { mev: 8, mav: 16, mrv: 24 },
    glute_med: { mev: 0, mav: 8, mrv: 12 },
    adductors: { mev: 4, mav: 10, mrv: 14 },
    calves: { mev: 10, mav: 18, mrv: 26 },
    gastrocnemius: { mev: 8, mav: 14, mrv: 20 },
    soleus: { mev: 4, mav: 10, mrv: 14 },
    abs: { mev: 6, mav: 14, mrv: 22 },
    obliques: { mev: 0, mav: 8, mrv: 12 },
    erectors: { mev: 4, mav: 10, mrv: 14 },
  },
}) as Record<Experience, Record<StandardMuscleGroup, VolumeLandmarks>>;

/**
 * THE migration primitive: a stored scalar still equal to its old default is
 * untouched and moves forward; anything else is the user's and is preserved.
 */
export function migrateDefaultField(
  stored: number,
  oldDefault: number,
  newDefault: number
): number {
  return stored === oldDefault ? newDefault : stored;
}

/**
 * Every v1 default this (muscle, field) pair could legitimately be holding —
 * one per experience level, because historical experience was not versioned.
 */
function priorDefaultsFor(muscle: StandardMuscleGroup, field: LandmarkField): number[] {
  return EXPERIENCES.map((exp) => LANDMARKS_V1[exp][muscle][field]);
}

/**
 * Migrate ONE stored triple for one muscle, field by field.
 *
 * `experience` is the level the new defaults are read from. Old-default
 * detection deliberately spans every level (see the module header).
 */
export function migrateLandmarkRow(
  muscle: StandardMuscleGroup,
  stored: VolumeLandmarks,
  experience: Experience
): VolumeLandmarks {
  const nextDefault = DEFAULT_VOLUME_LANDMARKS[experience][muscle];
  const out = { ...stored };
  for (const field of LANDMARK_FIELDS) {
    const value = stored[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const priors = priorDefaultsFor(muscle, field);
    // Untouched iff it matches a v1 default for this muscle+field at ANY level.
    if (priors.includes(value)) {
      out[field] = migrateDefaultField(value, value, nextDefault[field]);
    }
  }
  return out;
}

/**
 * Migrate a stored `users.volume_landmarks` payload from `storedVersion` to
 * LANDMARK_VERSION. Unknown keys, non-object values and incomplete triples are
 * passed through untouched so existing validation (which rejects them
 * downstream) keeps its current behaviour.
 *
 * Idempotent: re-running on an already-migrated payload is a no-op, because a
 * migrated value no longer equals its v1 default (or equals the new default,
 * which maps to itself).
 */
export function migrateStoredLandmarks(
  stored: Record<string, unknown> | null | undefined,
  experience: Experience,
  storedVersion: number | null | undefined
): { landmarks: Record<string, unknown>; migrated: boolean; version: number } {
  const version = typeof storedVersion === 'number' ? storedVersion : 1;
  if (!stored || typeof stored !== 'object') {
    return { landmarks: {}, migrated: false, version: LANDMARK_VERSION };
  }
  if (version >= LANDMARK_VERSION) {
    return { landmarks: stored, migrated: false, version };
  }

  const out: Record<string, unknown> = { ...stored };
  let migrated = false;
  for (const [key, value] of Object.entries(stored)) {
    if (!isStandardMuscle(key) || value === null || typeof value !== 'object') continue;
    const v = value as Partial<VolumeLandmarks>;
    if (
      typeof v.mev !== 'number' ||
      typeof v.mav !== 'number' ||
      typeof v.mrv !== 'number'
    ) {
      continue; // malformed triple — leave it for the existing validation path
    }
    const next = migrateLandmarkRow(
      key as StandardMuscleGroup,
      { mev: v.mev, mav: v.mav, mrv: v.mrv },
      experience
    );
    if (next.mev !== v.mev || next.mav !== v.mav || next.mrv !== v.mrv) migrated = true;
    out[key] = next;
  }
  return { landmarks: out, migrated, version: LANDMARK_VERSION };
}

/** Read the landmark version out of a `users.preferences` blob. */
export function readLandmarkVersion(
  preferences: Record<string, unknown> | null | undefined
): number | null {
  const raw = preferences?.[LANDMARK_VERSION_PREFERENCE_KEY];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Whether a stored payload still needs migrating. Callers use this to decide
 * whether to persist LANDMARK_VERSION on the next save — we never write just
 * to stamp a version, and we never overwrite a customized field to do it.
 */
export function needsLandmarkMigration(
  preferences: Record<string, unknown> | null | undefined
): boolean {
  const version = readLandmarkVersion(preferences);
  return version === null || version < LANDMARK_VERSION;
}

/** All standard muscles, for callers that want to fill missing rows from defaults. */
export function withDefaultRows(
  landmarks: Record<string, unknown>,
  experience: Experience
): Record<StandardMuscleGroup, VolumeLandmarks> {
  const out = { ...DEFAULT_VOLUME_LANDMARKS[experience] } as Record<
    StandardMuscleGroup,
    VolumeLandmarks
  >;
  for (const muscle of STANDARD_MUSCLE_GROUPS) {
    const value = landmarks[muscle];
    if (value === null || typeof value !== 'object') continue;
    const v = value as Partial<VolumeLandmarks>;
    if (
      typeof v.mev === 'number' &&
      typeof v.mav === 'number' &&
      typeof v.mrv === 'number'
    ) {
      out[muscle] = { mev: v.mev, mav: v.mav, mrv: v.mrv };
    }
  }
  return out;
}
