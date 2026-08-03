/**
 * Drift guard: the user_muscle_recovery_multipliers CHECK vocabulary must
 * track STANDARD_MUSCLE_GROUPS.
 *
 * The original constraint listed 20 muscles. Six standard muscles added later
 * (upper_traps, mid_lower_traps, gastrocnemius, soleus, triceps_long,
 * triceps_lat_med) were never added, so every learned-recovery upsert for them
 * failed the constraint and soreness learning was silently dead for those
 * muscles. SQL cannot import the TypeScript registry, so this test parses the
 * migration and compares.
 */

import * as fs from 'fs';
import * as path from 'path';
import { STANDARD_MUSCLE_GROUPS } from '@/types/schema';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const MIGRATION_FILE = '20260802000001_recovery_multiplier_full_muscle_vocabulary.sql';

function readMigration(): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
}

/** Pull the quoted keys out of the muscle_group CHECK ... IN (...) clause. */
function parseCheckVocabulary(sql: string): string[] {
  const match = sql.match(/CHECK\s*\(\s*muscle_group\s+IN\s*\(([\s\S]*?)\)\s*\)/i);
  if (!match) throw new Error('muscle_group CHECK clause not found in migration');
  return Array.from(match[1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
}

describe('recovery-multiplier muscle vocabulary', () => {
  const sql = readMigration();
  const vocabulary = parseCheckVocabulary(sql);

  it('matches STANDARD_MUSCLE_GROUPS exactly', () => {
    expect([...vocabulary].sort()).toEqual([...STANDARD_MUSCLE_GROUPS].sort());
  });

  it('lists no duplicates', () => {
    expect(new Set(vocabulary).size).toBe(vocabulary.length);
  });

  it('includes the six keys the original constraint was missing', () => {
    for (const muscle of [
      'upper_traps',
      'mid_lower_traps',
      'gastrocnemius',
      'soleus',
      'triceps_long',
      'triceps_lat_med',
    ]) {
      expect(vocabulary).toContain(muscle);
    }
  });

  it('preserves the DATABASE numeric range at 0.7-1.5', () => {
    // The application narrowed its own bounds to 0.85-1.35 and migrates by
    // clamping on read. Tightening the DB range here would break older clients
    // that still write the wider range.
    const original = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20260713000003_muscle_recovery_multipliers.sql'),
      'utf8'
    );
    expect(original).toMatch(/recovery_multiplier\s*>=\s*0\.7/);
    expect(original).toMatch(/recovery_multiplier\s*<=\s*1\.5/);
    // The new migration must not touch the numeric CHECK at all.
    expect(sql).not.toMatch(/recovery_multiplier\s*(>=|<=)/);
  });

  it('drops the old constraint before adding the new one (re-runnable)', () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS/i);
    expect(sql).toMatch(/ADD CONSTRAINT/i);
  });

  it('does not delete or rewrite existing rows', () => {
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+user_muscle_recovery_multipliers\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('replaces the stale "20-group vocabulary" comment', () => {
    expect(sql).toMatch(/COMMENT ON TABLE user_muscle_recovery_multipliers/i);
    expect(sql).not.toMatch(/20-group/);
  });
});
