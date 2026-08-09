/**
 * Drift guard: the user_muscle_priorities CHECK vocabulary must track
 * MUSCLE_GROUPS, and the settings form must render every one of them.
 *
 * Twin of recoveryMultiplierVocabulary.test.ts, and written for the same
 * failure: the original CHECK listed the 13 coarse groups of the day, so
 * promoting 'erectors' to a top-level group left a value the app treats as
 * first-class but the table would reject. It surfaced late because the form
 * only persists non-default priorities, so the un-renderable group never
 * reached an upsert — a gap that hides until someone adds the missing control.
 *
 * SQL cannot import the TypeScript vocabulary, so this parses the migration.
 */

import * as fs from 'fs';
import * as path from 'path';
import { MUSCLE_GROUPS } from '@/types/schema';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const MIGRATION_FILE = '20260809000001_muscle_priorities_erectors.sql';
const SETTINGS_FILE = path.join(
  __dirname, '..', '..', 'components', 'settings', 'MusclePrioritySettings.tsx'
);

/** Pull the quoted keys out of the muscle_group CHECK ... IN (...) clause. */
function parseCheckVocabulary(sql: string): string[] {
  const match = sql.match(/CHECK\s*\(\s*muscle_group\s+IN\s*\(([\s\S]*?)\)\s*\)/i);
  if (!match) throw new Error('muscle_group CHECK clause not found in migration');
  return Array.from(match[1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
}

/** Pull the muscle keys out of the component's MUSCLE_GROUPS_BY_REGION map. */
function parseRenderedRegions(source: string): string[] {
  const match = source.match(
    /const MUSCLE_GROUPS_BY_REGION: Record<string, MuscleGroup\[\]> = \{([\s\S]*?)\n\};/
  );
  if (!match) throw new Error('MUSCLE_GROUPS_BY_REGION not found in MusclePrioritySettings');
  return Array.from(match[1].matchAll(/'([a-z_]+)'/g))
    .map((m) => m[1])
    .filter((key) => (MUSCLE_GROUPS as readonly string[]).includes(key));
}

const vocabulary = parseCheckVocabulary(
  fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8')
);
const rendered = parseRenderedRegions(fs.readFileSync(SETTINGS_FILE, 'utf8'));

describe('muscle-priority vocabulary', () => {
  it('the CHECK constraint matches MUSCLE_GROUPS exactly', () => {
    expect([...vocabulary].sort()).toEqual([...MUSCLE_GROUPS].sort());
  });

  it('lists no duplicates', () => {
    expect(new Set(vocabulary).size).toBe(vocabulary.length);
  });

  it('accepts erectors, the group whose promotion the original list predated', () => {
    expect(vocabulary).toContain('erectors');
  });
});

describe('muscle-priority settings form', () => {
  it('renders every muscle group, so none is silently un-prioritizable', () => {
    expect([...rendered].sort()).toEqual([...MUSCLE_GROUPS].sort());
  });

  it('places each group in exactly one region', () => {
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it('every rendered group is one the table will accept', () => {
    for (const muscle of rendered) expect(vocabulary).toContain(muscle);
  });
});
