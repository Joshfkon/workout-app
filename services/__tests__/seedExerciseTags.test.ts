/**
 * Drift guard for the seed-derived exercise tags (shoulders-audit follow-up).
 *
 * The static fallback DB (exerciseService) applies muscle tags DERIVED from
 * the SQL corpus via a checked-in generated module. These tests re-run the
 * SAME parser over the SAME corpus so:
 *   1. a seed/migration change that isn't followed by
 *      `npm run generate:exercise-tags` fails loudly (freshness), and
 *   2. the applied fallback tags provably match the canonical source
 *      (application), with hand-picked ground truths guarding the parser
 *      itself against silently under-parsing the corpus.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SEED_EXERCISE_TAGS } from '../generated/seedExerciseTags';
import { getExercisesSync } from '../exerciseService';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deriveSeedExerciseTags } = require('../../scripts/seedTagParser.js');

function freshParse(): Record<string, { primary: string; secondaries: string[] }> {
  const root = path.join(__dirname, '..', '..');
  const migrationsDir = path.join(root, 'supabase', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      name: `migrations/${f}`,
      sql: fs.readFileSync(path.join(migrationsDir, f), 'utf8'),
    }));
  files.push({
    name: 'seed.sql',
    sql: fs.readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8'),
  });
  return deriveSeedExerciseTags(files).tags;
}

describe('generated seedExerciseTags module', () => {
  it('matches a fresh parse of the SQL corpus (run `npm run generate:exercise-tags` if this fails)', () => {
    expect(SEED_EXERCISE_TAGS).toEqual(freshParse());
  });

  it('parses the whole corpus, not a subset (guards the parser against silent under-parsing)', () => {
    // The stock library is ~140 exercises; a parser regression that drops a
    // statement shape would crater this count long before it hits the floor.
    expect(Object.keys(SEED_EXERCISE_TAGS).length).toBeGreaterThan(120);
  });

  it('carries the audit-critical ground truths from the migrations', () => {
    // 20260702000001: presses/flys credit front delts precisely, vertical
    // pulls are lat-dominant with rear-delt secondaries.
    expect(SEED_EXERCISE_TAGS['Barbell Bench Press']).toEqual({
      primary: 'chest',
      secondaries: ['front_delts', 'triceps'],
    });
    expect(SEED_EXERCISE_TAGS['Cable Fly']).toEqual({
      primary: 'chest',
      secondaries: ['front_delts'],
    });
    expect(SEED_EXERCISE_TAGS['Lat Pulldown']).toEqual({
      primary: 'lats',
      secondaries: ['biceps', 'upper_back', 'rear_delts'],
    });
    expect(SEED_EXERCISE_TAGS['Machine Lateral Raise']).toEqual({
      primary: 'lateral_delts',
      secondaries: [],
    });
    // 20260713000001 (later migration wins): shrugs are upper-trap primaries.
    expect(SEED_EXERCISE_TAGS['Dumbbell Shrug'].primary).toBe('upper_traps');
    // 20260710000001 (last word over 20260702000001): carries are grip-limited.
    expect(SEED_EXERCISE_TAGS["Farmer's Carry"]).toEqual({
      primary: 'forearms',
      secondaries: ['traps', 'abs', 'glutes'],
    });
    // Escaped quotes and parens in names parse correctly.
    expect(SEED_EXERCISE_TAGS['Dips (Chest Focus)'].primary).toBe('chest_lower');
  });
});

describe('static fallback DB applies the seed-derived tags', () => {
  it('every stock exercise the seed knows carries exactly the seed tags', () => {
    const seedNames = new Set(Object.keys(SEED_EXERCISE_TAGS));
    let matched = 0;
    for (const exercise of getExercisesSync()) {
      if (!seedNames.has(exercise.name)) continue;
      matched++;
      expect({
        name: exercise.name,
        primary: exercise.primaryMuscle,
        secondaries: exercise.secondaryMuscles,
      }).toEqual({
        name: exercise.name,
        primary: SEED_EXERCISE_TAGS[exercise.name].primary,
        secondaries: SEED_EXERCISE_TAGS[exercise.name].secondaries,
      });
    }
    // The overlap is the majority of the fallback DB — if this collapses,
    // name matching broke (renames without regeneration).
    expect(matched).toBeGreaterThan(80);
  });

  it('the generator no longer sees coarse press secondaries or secondary-less flys', () => {
    const byName = new Map(getExercisesSync().map((e) => [e.name, e]));
    expect(byName.get('Barbell Bench Press')!.secondaryMuscles).toEqual([
      'front_delts',
      'triceps',
    ]);
    expect(byName.get('Cable Fly')!.secondaryMuscles).toEqual(['front_delts']);
    expect(byName.get('Pec Deck')!.secondaryMuscles).toEqual(['front_delts']);
  });
});
