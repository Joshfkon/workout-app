/**
 * Scalar-field landmark migration (v1 -> v2).
 *
 * The delta is deliberately tiny (triceps_lat_med MRV at two levels), which
 * makes it a good test subject: everything else in the table must be a no-op,
 * so any accidental broad rewrite shows up immediately.
 */

import {
  LANDMARKS_V1,
  LANDMARK_VERSION,
  LANDMARK_VERSION_PREFERENCE_KEY,
  migrateDefaultField,
  migrateLandmarkRow,
  migrateStoredLandmarks,
  needsLandmarkMigration,
  readLandmarkVersion,
  withDefaultRows,
} from '@/lib/migrations/volume-landmarks';
import {
  DEFAULT_VOLUME_LANDMARKS,
  STANDARD_MUSCLE_GROUPS,
  type Experience,
  type VolumeLandmarks,
} from '@/types/schema';

/** migrateStoredLandmarks returns an untyped JSONB-shaped map by design. */
const row = (value: unknown): VolumeLandmarks => value as VolumeLandmarks;

const EXPERIENCES: Experience[] = ['novice', 'intermediate', 'advanced'];

describe('the frozen v1 snapshot', () => {
  it('differs from the current defaults in EXACTLY the approved cells', () => {
    const diffs: string[] = [];
    for (const exp of EXPERIENCES) {
      for (const muscle of STANDARD_MUSCLE_GROUPS) {
        for (const field of ['mev', 'mav', 'mrv'] as const) {
          const before = LANDMARKS_V1[exp][muscle][field];
          const after = DEFAULT_VOLUME_LANDMARKS[exp][muscle][field];
          if (before !== after) diffs.push(`${exp}.${muscle}.${field}: ${before}->${after}`);
        }
      }
    }
    expect(diffs.sort()).toEqual([
      'advanced.triceps_lat_med.mrv: 24->22',
      'intermediate.triceps_lat_med.mrv: 20->18',
    ]);
  });

  it('is a complete table (no missing rows to fall through)', () => {
    for (const exp of EXPERIENCES) {
      expect(Object.keys(LANDMARKS_V1[exp]).sort()).toEqual([...STANDARD_MUSCLE_GROUPS].sort());
    }
  });
});

describe('migrateDefaultField', () => {
  it('advances a value still equal to the old default', () => {
    expect(migrateDefaultField(24, 24, 22)).toBe(22);
  });

  it('preserves anything else', () => {
    expect(migrateDefaultField(30, 24, 22)).toBe(30);
    expect(migrateDefaultField(22, 24, 22)).toBe(22);
    expect(migrateDefaultField(0, 24, 22)).toBe(0);
  });
});

describe('untouched snapshots migrate', () => {
  it('a full untouched advanced snapshot lands on the new defaults', () => {
    const stored: Record<string, unknown> = {};
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      stored[muscle] = { ...LANDMARKS_V1.advanced[muscle] };
    }
    const { landmarks, migrated } = migrateStoredLandmarks(stored, 'advanced', 1);
    expect(migrated).toBe(true);
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      expect(landmarks[muscle]).toEqual(DEFAULT_VOLUME_LANDMARKS.advanced[muscle]);
    }
  });

  it('only the changed cell actually moves', () => {
    const stored: Record<string, unknown> = {};
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      stored[muscle] = { ...LANDMARKS_V1.advanced[muscle] };
    }
    const { landmarks } = migrateStoredLandmarks(stored, 'advanced', 1);
    const moved = STANDARD_MUSCLE_GROUPS.filter(
      (m) => JSON.stringify(landmarks[m]) !== JSON.stringify(LANDMARKS_V1.advanced[m])
    );
    expect(moved).toEqual(['triceps_lat_med']);
  });
});

describe('customized fields are preserved', () => {
  it('a customized MRV is never overwritten', () => {
    const stored = { triceps_lat_med: { mev: 8, mav: 15, mrv: 30 } };
    const { landmarks, migrated } = migrateStoredLandmarks(stored, 'advanced', 1);
    expect(landmarks.triceps_lat_med).toEqual({ mev: 8, mav: 15, mrv: 30 });
    expect(migrated).toBe(false);
  });

  it('a fully customized row is untouched', () => {
    const stored = { calves: { mev: 3, mav: 7, mrv: 11 } };
    const { landmarks } = migrateStoredLandmarks(stored, 'advanced', 1);
    expect(landmarks.calves).toEqual({ mev: 3, mav: 7, mrv: 11 });
  });
});

describe('mixed rows migrate untouched scalar fields ONLY', () => {
  it('customizing MEV does not pin the row\'s MRV', () => {
    // The precise failure the whole-triple approach would have caused.
    const stored = { triceps_lat_med: { mev: 12, mav: 15, mrv: 24 } };
    const { landmarks, migrated } = migrateStoredLandmarks(stored, 'advanced', 1);
    expect(landmarks.triceps_lat_med).toEqual({
      mev: 12, // customized -> preserved
      mav: 15, // still the old default -> stays 15 (unchanged in v2)
      mrv: 22, // still the old default -> advances
    });
    expect(migrated).toBe(true);
  });

  it('customizing MRV does not block MEV/MAV from advancing', () => {
    const stored = { triceps_lat_med: { mev: 8, mav: 15, mrv: 40 } };
    const { landmarks } = migrateStoredLandmarks(stored, 'advanced', 1);
    expect(row(landmarks.triceps_lat_med).mrv).toBe(40);
    expect(row(landmarks.triceps_lat_med).mev).toBe(8);
  });
});

describe('users who changed experience level', () => {
  it('a value equal to ANOTHER level\'s old default for the same muscle+field still migrates', () => {
    // Saved as intermediate (MRV 20), later switched to advanced. Read at
    // advanced: 20 is not the advanced v1 default (24) but IS the intermediate
    // v1 default, so it is recognized as untouched and advances.
    const stored = { triceps_lat_med: { mev: 8, mav: 15, mrv: 20 } };
    const { landmarks } = migrateStoredLandmarks(stored, 'advanced', 1);
    expect(row(landmarks.triceps_lat_med).mrv).toBe(22);
  });

  it('cross-level matching never crosses MUSCLES or FIELDS', () => {
    // A value must match THIS muscle and THIS field to count as untouched —
    // and the field's default must have actually moved (see the suite below).
    const stored = { mev: 8, mav: 15, mrv: 20 }; // 20 = intermediate v1 mrv
    expect(migrateLandmarkRow('triceps_lat_med', stored, 'advanced').mrv).toBe(22);
    // 21 is no level's default for this muscle+field -> custom, preserved.
    expect(
      migrateLandmarkRow('triceps_lat_med', { ...stored, mrv: 21 }, 'advanced').mrv
    ).toBe(21);
  });
});

describe('UNCHANGED fields are never touched (regression: cross-tier corruption)', () => {
  // The bug this guards: without gating on "did this field's default actually
  // change?", cross-tier matching reached every field in the table, so any
  // stored value equal to another tier's old default was rewritten to the
  // current tier's default — then persisted and stamped v2 on the next save.
  it("an advanced user's deliberate calves.mrv of 22 survives (it is the INTERMEDIATE default)", () => {
    expect(LANDMARKS_V1.intermediate.calves.mrv).toBe(22);
    expect(DEFAULT_VOLUME_LANDMARKS.advanced.calves.mrv).toBe(26);
    // calves.mrv default did NOT change in v1 -> v2, so nothing may touch it.
    const { landmarks, migrated } = migrateStoredLandmarks(
      { calves: { mev: 10, mav: 18, mrv: 22 } },
      'advanced',
      1
    );
    expect(row(landmarks.calves).mrv).toBe(22);
    expect(migrated).toBe(false);
  });

  it('no field of any UNCHANGED cell is rewritten, at any experience level', () => {
    // Exhaustive: for every muscle/field/level whose default did not move,
    // feed every other level's v1 default as a stored value and require it
    // to come back untouched.
    const violations: string[] = [];
    for (const experience of EXPERIENCES) {
      for (const muscle of STANDARD_MUSCLE_GROUPS) {
        for (const field of ['mev', 'mav', 'mrv'] as const) {
          const changed =
            LANDMARKS_V1[experience][muscle][field] !==
            DEFAULT_VOLUME_LANDMARKS[experience][muscle][field];
          if (changed) continue;
          for (const other of EXPERIENCES) {
            const candidate = LANDMARKS_V1[other][muscle][field];
            const stored = { ...LANDMARKS_V1[experience][muscle], [field]: candidate };
            const result = migrateLandmarkRow(muscle, stored, experience);
            if (result[field] !== candidate) {
              violations.push(
                `${experience}.${muscle}.${field}: ${candidate} -> ${result[field]}`
              );
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('only triceps_lat_med.mrv is eligible to migrate at all', () => {
    const eligible: string[] = [];
    for (const experience of EXPERIENCES) {
      for (const muscle of STANDARD_MUSCLE_GROUPS) {
        for (const field of ['mev', 'mav', 'mrv'] as const) {
          if (
            LANDMARKS_V1[experience][muscle][field] !==
            DEFAULT_VOLUME_LANDMARKS[experience][muscle][field]
          ) {
            eligible.push(`${experience}.${muscle}.${field}`);
          }
        }
      }
    }
    expect(eligible.sort()).toEqual([
      'advanced.triceps_lat_med.mrv',
      'intermediate.triceps_lat_med.mrv',
    ]);
  });
});

describe('missing rows, malformed rows, version handling', () => {
  it('missing rows inherit the new defaults via withDefaultRows', () => {
    const filled = withDefaultRows({ calves: { mev: 3, mav: 7, mrv: 11 } }, 'advanced');
    expect(filled.calves).toEqual({ mev: 3, mav: 7, mrv: 11 });
    expect(filled.triceps_lat_med).toEqual(DEFAULT_VOLUME_LANDMARKS.advanced.triceps_lat_med);
    expect(Object.keys(filled).sort()).toEqual([...STANDARD_MUSCLE_GROUPS].sort());
  });

  it('malformed triples pass through untouched for existing validation to reject', () => {
    const stored = {
      triceps_lat_med: { mev: 8, mav: 15 }, // no mrv
      calves: null,
      soleus: 'nonsense',
      not_a_muscle: { mev: 1, mav: 2, mrv: 3 },
    };
    const { landmarks } = migrateStoredLandmarks(stored as Record<string, unknown>, 'advanced', 1);
    expect(landmarks.triceps_lat_med).toEqual({ mev: 8, mav: 15 });
    expect(landmarks.calves).toBeNull();
    expect(landmarks.soleus).toBe('nonsense');
    expect(landmarks.not_a_muscle).toEqual({ mev: 1, mav: 2, mrv: 3 });
  });

  it('an empty or absent payload yields an empty result', () => {
    expect(migrateStoredLandmarks(null, 'advanced', 1).landmarks).toEqual({});
    expect(migrateStoredLandmarks(undefined, 'advanced', null).landmarks).toEqual({});
  });

  it('is idempotent', () => {
    const stored: Record<string, unknown> = {};
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      stored[muscle] = { ...LANDMARKS_V1.advanced[muscle] };
    }
    const once = migrateStoredLandmarks(stored, 'advanced', 1);
    const twice = migrateStoredLandmarks(once.landmarks, 'advanced', 1);
    expect(twice.landmarks).toEqual(once.landmarks);
    // Re-running at the CURRENT version short-circuits entirely.
    const third = migrateStoredLandmarks(once.landmarks, 'advanced', LANDMARK_VERSION);
    expect(third.migrated).toBe(false);
    expect(third.landmarks).toEqual(once.landmarks);
  });

  it('version completion prevents repeated migration of a customized-back value', () => {
    // A user who deliberately sets MRV back to 24 AFTER migrating must not
    // have it silently re-migrated on the next read.
    const stored = { triceps_lat_med: { mev: 8, mav: 15, mrv: 24 } };
    const stamped = migrateStoredLandmarks(stored, 'advanced', LANDMARK_VERSION);
    expect(stamped.landmarks.triceps_lat_med).toEqual({ mev: 8, mav: 15, mrv: 24 });
    expect(stamped.migrated).toBe(false);
  });

  it('an unversioned payload is treated as v1', () => {
    const stored = { triceps_lat_med: { ...LANDMARKS_V1.advanced.triceps_lat_med } };
    expect(migrateStoredLandmarks(stored, 'advanced', null).landmarks.triceps_lat_med).toEqual(
      DEFAULT_VOLUME_LANDMARKS.advanced.triceps_lat_med
    );
  });
});

describe('version bookkeeping', () => {
  it('reads the version out of preferences', () => {
    expect(readLandmarkVersion({ [LANDMARK_VERSION_PREFERENCE_KEY]: 2 })).toBe(2);
    expect(readLandmarkVersion({})).toBeNull();
    expect(readLandmarkVersion(null)).toBeNull();
    expect(readLandmarkVersion({ [LANDMARK_VERSION_PREFERENCE_KEY]: 'x' })).toBeNull();
  });

  it('needsLandmarkMigration is true until the current version is stamped', () => {
    expect(needsLandmarkMigration(null)).toBe(true);
    expect(needsLandmarkMigration({})).toBe(true);
    expect(needsLandmarkMigration({ [LANDMARK_VERSION_PREFERENCE_KEY]: 1 })).toBe(true);
    expect(needsLandmarkMigration({ [LANDMARK_VERSION_PREFERENCE_KEY]: LANDMARK_VERSION })).toBe(
      false
    );
  });
});
