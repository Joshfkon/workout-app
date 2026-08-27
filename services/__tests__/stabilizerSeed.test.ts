/**
 * Drift guard: the stabilizer seed migration must track
 * services/shared/stabilizerTags.STABILIZERS_BY_EXERCISE_NAME exactly.
 *
 * SQL cannot import the TypeScript map, so this test parses the migration
 * (the recoveryMultiplierVocabulary.test.ts pattern) and compares name →
 * stabilizer-array pairs both ways. It also pins the invariants the seed
 * relies on: values restricted to the tracked vocabulary, stock-rows-only
 * scoping, and that unsure exercises stay unseeded rather than guessed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isStandardMuscle, STANDARD_MUSCLE_GROUPS } from '@/types/schema';
import {
  STABILIZERS_BY_EXERCISE_NAME,
  STABILIZER_TRACKED_MUSCLES,
  UNSEEDED_STABILIZER_EXERCISES,
} from '@/services/shared/stabilizerTags';
import { SEED_EXERCISE_TAGS } from '@/services/generated/seedExerciseTags';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const MIGRATION_FILE = '20260825000002_seed_stabilizers.sql';

function readMigration(): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
}

/** Parse every seeding UPDATE into { name, stabilizers } pairs. */
function parseSeededStabilizers(sql: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const statement =
    /UPDATE exercises SET stabilizers = ARRAY\[([^\]]+)\] WHERE name = '((?:[^']|'')+)' AND is_custom IS NOT TRUE;/g;
  for (const match of Array.from(sql.matchAll(statement))) {
    const values = Array.from(match[1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
    const name = match[2].replace(/''/g, "'");
    out.set(name, values);
  }
  return out;
}

describe('stabilizer seed migration', () => {
  const sql = readMigration();
  const seeded = parseSeededStabilizers(sql);

  it('matches STABILIZERS_BY_EXERCISE_NAME exactly (both directions)', () => {
    expect(Object.fromEntries(seeded)).toEqual(STABILIZERS_BY_EXERCISE_NAME);
  });

  it('every UPDATE in the file was parsed (no statement shape drift)', () => {
    const updateCount = (sql.match(/UPDATE exercises SET stabilizers/g) ?? []).length;
    expect(updateCount).toBe(seeded.size);
    expect(updateCount).toBeGreaterThan(0);
  });

  it('uses only the tracked stabilizer vocabulary, all valid standard muscles', () => {
    const tracked = new Set<string>(STABILIZER_TRACKED_MUSCLES);
    for (const [name, values] of Array.from(seeded.entries())) {
      for (const value of values) {
        expect({ name, value, isStandard: isStandardMuscle(value) }).toEqual({
          name,
          value,
          isStandard: true,
        });
        expect(tracked.has(value)).toBe(true);
      }
      expect(new Set(values).size).toBe(values.length); // no duplicate tags
    }
  });

  it('rotator_cuff is a real standard muscle (taxonomy landed with the seed)', () => {
    expect(STANDARD_MUSCLE_GROUPS).toContain('rotator_cuff');
  });

  it('touches stock rows only and deletes nothing', () => {
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    // Every UPDATE is scoped away from user customs (asserted per-statement by
    // the parse regex, which REQUIRES the is_custom guard to match at all).
    expect(seeded.size).toBeGreaterThan(0);
  });

  it('seeds only names the stock library actually contains', () => {
    for (const name of Array.from(seeded.keys())) {
      expect(SEED_EXERCISE_TAGS[name]).toBeDefined();
    }
  });

  it('unsure exercises stay unseeded — listed for review, never guessed', () => {
    for (const { name } of UNSEEDED_STABILIZER_EXERCISES) {
      expect(seeded.has(name)).toBe(false);
      // Unsure entries must still be real stock exercises, or the review list
      // rots into names nobody can act on.
      expect(SEED_EXERCISE_TAGS[name]).toBeDefined();
    }
  });
});
