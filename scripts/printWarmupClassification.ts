/**
 * Warmup-engine classification printer — movement_pattern / rom_demands
 * review list.
 *
 * Prints, for every exercise in the seed corpus (migrations chronologically,
 * then seed.sql — the same corpus discipline as scripts/seedTagParser.js):
 *
 *   - the stored movement_pattern and what the engine resolves it to at
 *     runtime today (legacy-token mapping),
 *   - the PROPOSED canonical movement_pattern (name+muscle classification —
 *     the same rules the engine uses for custom exercises),
 *   - the PROPOSED rom_demands tags,
 *
 * plus the SQL UPDATE block that would apply the proposals.
 *
 * REVIEW PROTOCOL (same as progression_model, 20260725000003): this script
 * only PRINTS. Nothing is applied until the list is approved, at which point
 * the printed SQL becomes a migration. Until then the engine derives both
 * fields on read, so runtime behavior does not depend on the backfill.
 *
 * Usage:
 *     npx -y tsx scripts/printWarmupClassification.ts [--sql]
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  canonicalizeMovementPattern,
  deriveRomDemands,
  type WarmupExerciseMeta,
} from '../services/warmupEngine';

const { deriveSeedExerciseTags, stripComments } = require('./seedTagParser');

const root = path.join(__dirname, '..');

function loadCorpus(): Array<{ name: string; sql: string }> {
  const migrationsDir = path.join(root, 'supabase', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, sql: fs.readFileSync(path.join(migrationsDir, f), 'utf8') }));
  files.push({
    name: 'seed.sql',
    sql: fs.readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8'),
  });
  return files;
}

/**
 * Extract each exercise's stored movement_pattern from INSERT statements.
 * (No UPDATE in the corpus rewrites movement_pattern per-exercise — verified
 * against the migrations; last INSERT wins, matching fresh-database state.)
 */
function extractStoredPatterns(corpus: Array<{ name: string; sql: string }>): Map<string, string> {
  const stored = new Map<string, string>();
  const insertRe = /INSERT\s+INTO\s+exercises\s*\(([^)]*)\)\s*VALUES([\s\S]*?);/gi;
  for (const file of corpus) {
    const sql = stripComments(file.sql);
    let m: RegExpExecArray | null;
    while ((m = insertRe.exec(sql)) !== null) {
      const cols = m[1].split(',').map((c) => c.trim().toLowerCase());
      const nameIdx = cols.indexOf('name');
      const patternIdx = cols.indexOf('movement_pattern');
      if (nameIdx === -1 || patternIdx === -1) continue;
      const clauseIdx = m[2].search(/\b(ON\s+CONFLICT|RETURNING)\b/i);
      const section = clauseIdx === -1 ? m[2] : m[2].slice(0, clauseIdx);
      for (const tuple of splitTuples(section)) {
        const values = splitTopLevel(tuple);
        if (values.length !== cols.length) continue;
        const name = unquote(values[nameIdx]);
        const pattern = unquote(values[patternIdx]);
        if (name) stored.set(name, pattern);
      }
    }
  }
  return stored;
}

/** Split "(...),(...)" into tuple bodies, quote-aware. */
function splitTuples(section: string): string[] {
  const tuples: string[] = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (let i = 0; i < section.length; i++) {
    const c = section[i];
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (section[i + 1] === "'") {
          cur += section[++i];
        } else inStr = false;
      }
      continue;
    }
    if (c === "'") {
      inStr = true;
      cur += c;
    } else if (c === '(') {
      depth++;
      if (depth === 1) cur = '';
      else cur += c;
    } else if (c === ')') {
      depth--;
      if (depth === 0) {
        tuples.push(cur);
        cur = '';
      } else cur += c;
    } else if (depth >= 1) cur += c;
  }
  return tuples;
}

/** Split a tuple body on top-level commas, quote/bracket-aware. */
function splitTopLevel(tuple: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (let i = 0; i < tuple.length; i++) {
    const c = tuple[i];
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (tuple[i + 1] === "'") cur += tuple[++i];
        else inStr = false;
      }
      continue;
    }
    if (c === "'") {
      inStr = true;
      cur += c;
    } else if (c === '(' || c === '[') {
      depth++;
      cur += c;
    } else if (c === ')' || c === ']') {
      depth--;
      cur += c;
    } else if (c === ',' && depth === 0) {
      fields.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  fields.push(cur.trim());
  return fields;
}

function unquote(token: string): string {
  const t = token.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

function sqlQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// ---- main ----

const corpus = loadCorpus();
const { tags } = deriveSeedExerciseTags(corpus) as {
  tags: Record<string, { primary: string; secondaries: string[] }>;
};
const storedPatterns = extractStoredPatterns(corpus);

interface Row {
  name: string;
  primary: string;
  stored: string;
  runtimeNow: string;
  proposedPattern: string;
  proposedDemands: string[];
  changed: boolean;
}

const rows: Row[] = [];
for (const name of Object.keys(tags).sort()) {
  const { primary, secondaries } = tags[name];
  const stored = storedPatterns.get(name) ?? '';
  const meta: WarmupExerciseMeta = {
    id: name,
    name,
    primaryMuscle: primary,
    secondaryMuscles: secondaries,
    movementPattern: stored,
  };
  // What the engine resolves TODAY from the stored value (legacy mapping,
  // then name rules)
  const runtimeNow = canonicalizeMovementPattern(meta) ?? '(unclassified)';
  // Proposal: name+muscle classification first (it corrects miscategorized
  // stored tokens like Close Grip Bench Press = 'elbow_extension'); fall back
  // to the stored value's canonical form.
  const nameBased = canonicalizeMovementPattern({ ...meta, movementPattern: '' });
  const proposedPattern = nameBased ?? runtimeNow;
  const proposedDemands = deriveRomDemands({ ...meta, movementPattern: proposedPattern, romDemands: [] });
  rows.push({
    name,
    primary,
    stored,
    runtimeNow,
    proposedPattern,
    proposedDemands,
    changed: proposedPattern !== stored,
  });
}

// Custom exercises live only in the user's DB (is_custom / AI-completed) and
// can't be enumerated from the seed corpus. The engine classifies them at
// runtime with the same name rules; the known ones from the defect report are
// shown here so the review list covers them explicitly.
const KNOWN_CUSTOMS: Array<{ name: string; primary: string; secondaries: string[] }> = [
  { name: 'Arnold Press', primary: 'front_delts', secondaries: ['lateral_delts', 'triceps'] },
  { name: 'Iso-Lateral Incline Press', primary: 'chest_upper', secondaries: ['front_delts', 'triceps'] },
];
const customRows: Row[] = KNOWN_CUSTOMS.filter((c) => !tags[c.name]).map((c) => {
  const meta: WarmupExerciseMeta = {
    id: c.name,
    name: c.name,
    primaryMuscle: c.primary,
    secondaryMuscles: c.secondaries,
    movementPattern: '',
  };
  const pattern = canonicalizeMovementPattern(meta) ?? '(unclassified)';
  return {
    name: c.name,
    primary: c.primary,
    stored: '(custom — not in seed corpus)',
    runtimeNow: pattern,
    proposedPattern: pattern,
    proposedDemands: deriveRomDemands({ ...meta, movementPattern: pattern }),
    changed: true,
  };
});

const asSql = process.argv.includes('--sql');

if (!asSql) {
  console.log('# Warmup engine classification — REVIEW LIST (nothing applied)');
  console.log('');
  console.log(`${rows.length} exercises. "runtime now" = what the engine resolves today from the stored value; "proposed" = the reviewed assignment that would be written by the backfill SQL (run with --sql to print it).`);
  console.log('');
  console.log('| Exercise | Primary | Stored pattern | Runtime now | PROPOSED pattern | PROPOSED rom_demands |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) {
    const mark = r.changed ? ' ⚠' : '';
    console.log(
      `| ${r.name}${mark} | ${r.primary} | ${r.stored || '—'} | ${r.runtimeNow} | ${r.proposedPattern} | ${r.proposedDemands.join(', ') || '—'} |`
    );
  }
  console.log('');
  console.log(`⚠ = proposed pattern differs from the stored value (${rows.filter((r) => r.changed).length} rows).`);
  if (customRows.length > 0) {
    console.log('');
    console.log('## Known custom exercises (runtime name-rule classification — not in seed corpus)');
    console.log('');
    console.log('| Exercise | Primary | Pattern (runtime) | rom_demands (runtime) |');
    console.log('|---|---|---|---|');
    for (const r of customRows) {
      console.log(`| ${r.name} | ${r.primary} | ${r.proposedPattern} | ${r.proposedDemands.join(', ') || '—'} |`);
    }
  }
} else {
  console.log('-- PROPOSED warmup-engine backfill — DO NOT APPLY WITHOUT REVIEW');
  console.log('-- Generated by scripts/printWarmupClassification.ts');
  for (const r of rows) {
    if (r.proposedPattern === '(unclassified)') {
      console.log(`-- SKIPPED (unclassifiable, needs manual review): ${r.name}`);
      continue;
    }
    const demands = r.proposedDemands.length
      ? `ARRAY[${r.proposedDemands.map(sqlQuote).join(', ')}]`
      : `'{}'::TEXT[]`;
    console.log(
      `UPDATE exercises SET movement_pattern = ${sqlQuote(r.proposedPattern)}, rom_demands = ${demands} WHERE name = ${sqlQuote(r.name)};`
    );
  }
}
