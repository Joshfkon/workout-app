#!/usr/bin/env node
/**
 * Regenerate services/generated/seedExerciseTags.ts from the canonical SQL
 * corpus (supabase/migrations in chronological order, then supabase/seed.sql).
 *
 *   npm run generate:exercise-tags
 *
 * The static fallback exercise DB (services/exerciseService.ts) applies these
 * tags by name, so the generator/swapper fallback can never drift from the
 * seeded database again. services/__tests__/seedExerciseTags.test.ts re-runs
 * the same parser and fails when this file is stale.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { deriveSeedExerciseTags } = require('./seedTagParser');

const root = path.join(__dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');

const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ name: `migrations/${f}`, sql: fs.readFileSync(path.join(migrationsDir, f), 'utf8') }));
files.push({ name: 'seed.sql', sql: fs.readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8') });

const { tags, stats } = deriveSeedExerciseTags(files);

const entries = Object.entries(tags)
  .map(
    ([name, t]) =>
      `  ${JSON.stringify(name)}: { primary: ${JSON.stringify(t.primary)}, secondaries: ${JSON.stringify(t.secondaries)} },`
  )
  .join('\n');

const out = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Canonical stock-exercise muscle tags derived from the SQL corpus
 * (supabase/migrations chronologically, then supabase/seed.sql) by
 * scripts/generate-seed-exercise-tags.js. Regenerate with:
 *
 *   npm run generate:exercise-tags
 *
 * services/exerciseService.ts applies these to its static fallback entries by
 * exercise name, so the fallback DB is DERIVED from the seed source rather
 * than hand-synced (the hand-synced copy is how the generator kept coarse
 * 'shoulders' tags long after the 20260702000001 retag — the shoulders-audit
 * bug class). Drift is caught by services/__tests__/seedExerciseTags.test.ts.
 */

export interface SeedExerciseTags {
  primary: string;
  secondaries: string[];
}

export const SEED_EXERCISE_TAGS: Record<string, SeedExerciseTags> = {
${entries}
};
`;

const outPath = path.join(root, 'services', 'generated', 'seedExerciseTags.ts');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);

console.log(`Wrote ${Object.keys(tags).length} exercise tag entries to ${path.relative(root, outPath)}`);
for (const s of stats) {
  if (s.inserts || s.updates) console.log(`  ${s.file}: ${s.inserts} insert rows, ${s.updates} updates`);
}
