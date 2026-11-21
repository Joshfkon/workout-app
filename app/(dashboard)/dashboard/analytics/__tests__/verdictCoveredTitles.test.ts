/**
 * The Progress page hides recommendations the phase verdict already covers by
 * matching generateCoachingRecommendations titles exactly. A copy pass that
 * re-cases one side silently turns the filter off, so pin every listed title
 * to a title the engine actually emits.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const page = readFileSync(join(process.cwd(), 'app/(dashboard)/dashboard/analytics/page.tsx'), 'utf8');
const engine = readFileSync(join(process.cwd(), 'services/bodyCompEngine.ts'), 'utf8');

function coveredTitles(): string[] {
  const block = page.match(/VERDICT_COVERED_TITLES = new Set\(\[([\s\S]*?)\]\)/);
  if (!block) throw new Error('VERDICT_COVERED_TITLES not found');
  return Array.from(block[1].matchAll(/'([^']+)'/g), (m) => m[1]);
}

describe('VERDICT_COVERED_TITLES', () => {
  it('lists titles', () => {
    expect(coveredTitles().length).toBeGreaterThan(0);
  });

  it.each(coveredTitles())('"%s" is a title bodyCompEngine emits', (title) => {
    expect(engine).toContain(`title: '${title}'`);
  });
});
