/**
 * Band-source import guard (close-out 3b): getEffectiveBand is the ONLY
 * landmark read. No production module may reference RESEARCH_VOLUME_BANDS,
 * MEV_TARGETS, or a local fine-band table directly — card rendering, the
 * allocator clamp, the goal-clamp, and child-band synthesis all resolve
 * through services/volumeBands.getEffectiveBand, so a recovery-profile-aware
 * ceiling can never be bypassed by one stale consumer.
 *
 * Exempt: volumeBands.ts itself (the definition site), __tests__ (fixtures
 * assert against the raw tables on purpose), and generated files.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['services', 'app', 'components', 'hooks', 'lib', 'stores', 'src'];
const BANNED = /\b(RESEARCH_VOLUME_BANDS|MEV_TARGETS|fineChildBand)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === '__typetests__' || entry.name === 'generated') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec|test-d)\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

it('no production module reads the raw band tables — getEffectiveBand is the single source', () => {
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      if (path.relative(ROOT, file) === path.join('services', 'volumeBands.ts')) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (BANNED.test(src)) offenders.push(path.relative(ROOT, file));
    }
  }
  expect(offenders).toEqual([]);
});
