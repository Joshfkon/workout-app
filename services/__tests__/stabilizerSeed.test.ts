/**
 * Drift guard: the stock stabilizer seed migrations must track
 * services/shared/stabilizerTags.STABILIZERS_BY_EXERCISE_NAME exactly.
 *
 * SQL cannot import the TypeScript map, so this test parses the migrations
 * (the recoveryMultiplierVocabulary.test.ts pattern) and compares name →
 * stabilizer-array pairs both ways. The map is seeded across MULTIPLE
 * migrations (the original 20260825000002 seed plus each approved audit
 * addition — migrations are immutable once applied, so additions get new
 * files); the UNION of their statements must equal the map, and no name may
 * be seeded twice. It also pins the invariants the seed relies on: values
 * restricted to the tracked vocabulary, stock-rows-only scoping, and that
 * unsure exercises stay unseeded rather than guessed.
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
const STOCK_SEED_MIGRATIONS = [
  '20260825000002_seed_stabilizers.sql',
  '20260913000002_seed_stabilizers_audit_additions.sql',
];

function readMigration(file: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
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

describe('stabilizer seed migrations', () => {
  const perFile = STOCK_SEED_MIGRATIONS.map((file) => {
    const sql = readMigration(file);
    return { file, sql, seeded: parseSeededStabilizers(sql) };
  });
  const seeded = new Map<string, string[]>();
  for (const { seeded: part } of perFile) {
    for (const [name, values] of Array.from(part.entries())) seeded.set(name, values);
  }

  it('union of all seed migrations matches STABILIZERS_BY_EXERCISE_NAME exactly (both directions)', () => {
    expect(Object.fromEntries(seeded)).toEqual(STABILIZERS_BY_EXERCISE_NAME);
  });

  it('no exercise is seeded by more than one migration', () => {
    const total = perFile.reduce((n, { seeded: part }) => n + part.size, 0);
    expect(total).toBe(seeded.size);
  });

  it('every UPDATE in every file was parsed (no statement shape drift)', () => {
    for (const { file, sql, seeded: part } of perFile) {
      const updateCount = (sql.match(/UPDATE exercises SET stabilizers/g) ?? []).length;
      expect({ file, updateCount }).toEqual({ file, updateCount: part.size });
      expect(part.size).toBeGreaterThan(0);
    }
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
    for (const { sql } of perFile) {
      expect(sql).not.toMatch(/\bDELETE\b/i);
      expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    }
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
