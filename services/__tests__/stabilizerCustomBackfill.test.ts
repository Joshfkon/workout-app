/**
 * Drift guard: the custom-exercise stabilizer backfill migration must track
 * services/shared/stabilizerTags.STABILIZERS_BY_EXERCISE_NAME exactly, and
 * the normalized-token-set matching it relies on must be unambiguous.
 *
 * SQL cannot import the TypeScript map, so this test parses the migration's
 * canonical VALUES list (the stabilizerSeed.test.ts pattern) and compares
 * name → stabilizer-array pairs both ways. It also mirrors the migration's
 * SQL tokenizer in TS to pin the two properties the UPDATE depends on:
 *   1. token sets are pairwise UNIQUE across the canonical map, so a custom
 *      row can never match two entries with different tags;
 *   2. the motivating case actually matches — a custom 'Shrug (Dumbbell)'
 *      normalizes to the same token set as the stock 'Dumbbell Shrug'.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isStandardMuscle } from '@/types/schema';
import {
  STABILIZERS_BY_EXERCISE_NAME,
  STABILIZER_TRACKED_MUSCLES,
} from '@/services/shared/stabilizerTags';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const MIGRATION_FILE = '20260913000001_backfill_custom_stabilizers.sql';

function readMigration(): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
}

/** Parse every canonical VALUES row into { name, stabilizers } pairs. */
function parseCanonicalValues(sql: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const row = /\('((?:[^']|'')+)', ARRAY\[([^\]]+)\]\),?/g;
  for (const match of Array.from(sql.matchAll(row))) {
    const name = match[1].replace(/''/g, "'");
    const values = Array.from(match[2].matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
    out.set(name, values);
  }
  return out;
}

/**
 * TS mirror of pg_temp.stabilizer_name_tokens in the migration: lowercase,
 * split on any non-alphanumeric run, deduplicate, sort.
 */
function nameTokens(name: string): string[] {
  return Array.from(
    new Set(
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter(Boolean)
    )
  ).sort();
}

describe('custom-exercise stabilizer backfill migration', () => {
  const sql = readMigration();
  const canonical = parseCanonicalValues(sql);

  it('matches STABILIZERS_BY_EXERCISE_NAME exactly (both directions)', () => {
    expect(Object.fromEntries(canonical)).toEqual(STABILIZERS_BY_EXERCISE_NAME);
  });

  it('every VALUES row in the file was parsed (no row shape drift)', () => {
    // Each canonical row carries exactly one ARRAY literal; the UPDATE itself
    // carries none (it assigns c.stabs), so the counts must agree.
    const arrayLiterals = (sql.match(/ARRAY\['/g) ?? []).length;
    expect(arrayLiterals).toBe(canonical.size);
    expect(canonical.size).toBeGreaterThan(0);
  });

  it('uses only the tracked stabilizer vocabulary, all valid standard muscles', () => {
    const tracked = new Set<string>(STABILIZER_TRACKED_MUSCLES);
    for (const [name, values] of Array.from(canonical.entries())) {
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

  it('canonical token sets are pairwise unique (the match can never be ambiguous)', () => {
    const seen = new Map<string, string>();
    for (const name of Object.keys(STABILIZERS_BY_EXERCISE_NAME)) {
      const key = nameTokens(name).join('|');
      expect({ name, collidesWith: seen.get(key) ?? null }).toEqual({
        name,
        collidesWith: null,
      });
      seen.set(key, name);
    }
  });

  it("matches the motivating case: 'Shrug (Dumbbell)' ↔ 'Dumbbell Shrug'", () => {
    expect(nameTokens('Shrug (Dumbbell)')).toEqual(nameTokens('Dumbbell Shrug'));
    // And equipment stays load-bearing — the barbell variant must NOT match.
    expect(nameTokens('Shrug (Barbell)')).not.toEqual(nameTokens('Dumbbell Shrug'));
    expect(nameTokens('Shrug (Barbell)')).toEqual(nameTokens('Barbell Shrug'));
  });

  it('touches empty custom rows only and deletes nothing', () => {
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    // Custom-only scope — the stock seed owns stock rows.
    expect(sql).toContain('e.is_custom IS TRUE');
    expect(sql).not.toMatch(/is_custom IS NOT TRUE/);
    // Empty-only guard — never overwrite tags a custom row already carries.
    expect(sql).toContain("(e.stabilizers IS NULL OR e.stabilizers = '{}')");
  });
});
