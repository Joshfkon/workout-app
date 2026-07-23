#!/usr/bin/env node
/**
 * Ratchet check for raw `.reps` reads.
 *
 * Duration-based exercises store SECONDS in the `reps` field (see
 * services/shared/setModality.ts). Any code that reads `set.reps` directly
 * and does rep-shaped math (tonnage, e1RM, rep PRs) is a latent bug for
 * duration sets, so new code must go through the setModality accessors
 * (getSetReps / getSetDuration / getTargetRange) instead.
 *
 * This script counts `.reps` property reads per file and compares against
 * scripts/reps-access-baseline.json. The build fails when any file's count
 * EXCEEDS its baseline — existing reads are grandfathered, new ones are not.
 * Reducing a count is always allowed (run with --update to lock it in).
 *
 *   node scripts/check-reps-access.mjs           # check (CI)
 *   node scripts/check-reps-access.mjs --update  # regenerate the baseline
 *
 * If you legitimately need a new raw read (e.g. inside the accessor module
 * itself, plumbing that round-trips the value untouched, or a test fixture),
 * prefer routing through setModality; only update the baseline when the read
 * is genuinely modality-safe, and say why in the commit message.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'reps-access-baseline.json');

// Directories scanned for raw `.reps` reads.
const INCLUDE_DIRS = ['app', 'components', 'hooks', 'lib', 'services', 'stores', 'types'];

// The sanctioned accessor module (and its tests) may read `.reps` freely.
const EXEMPT = [
  'services/shared/setModality.ts',
];

// Test files are excluded: fixture construction and assertions read `.reps`
// legitimately and ratcheting them adds friction without safety.
const TEST_PATTERN = /(\.test\.|\.spec\.|__tests__|__mocks__|\.snap$)/;

// Property READS of `.reps` — matches `x.reps` / `?.reps` but not
// `.repsInTank`, `.repsLabel`, object keys (`reps:`), or destructuring.
const READ_PATTERN = /\??\.reps\b/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function countReads() {
  const counts = {};
  for (const dir of INCLUDE_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (TEST_PATTERN.test(rel) || EXEMPT.includes(rel)) continue;
      const matches = fs.readFileSync(file, 'utf8').match(READ_PATTERN);
      if (matches && matches.length > 0) counts[rel] = matches.length;
    }
  }
  return counts;
}

const current = countReads();

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + '\n');
  const total = Object.values(sorted).reduce((a, b) => a + b, 0);
  console.log(`reps-access baseline updated: ${Object.keys(sorted).length} files, ${total} raw .reps reads.`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error('Missing scripts/reps-access-baseline.json — run: node scripts/check-reps-access.mjs --update');
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
const violations = [];
for (const [file, count] of Object.entries(current)) {
  const allowed = baseline[file] ?? 0;
  if (count > allowed) violations.push({ file, count, allowed });
}

if (violations.length > 0) {
  console.error('\nNew raw `.reps` reads detected (duration exercises store seconds in this field):\n');
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.count} reads (baseline ${v.allowed})`);
  }
  console.error(
    '\nRoute reads through services/shared/setModality.ts (getSetReps / getSetDuration /\n' +
    'getTargetRange) so the modality branch is explicit. If a raw read is genuinely\n' +
    'modality-safe, regenerate the baseline with:\n' +
    '  node scripts/check-reps-access.mjs --update\n'
  );
  process.exit(1);
}

const total = Object.values(current).reduce((a, b) => a + b, 0);
console.log(`reps-access ratchet OK (${total} grandfathered raw .reps reads).`);
