/**
 * The main tabs use Tabler line icons. Emoji rendered as icons next to them
 * look like a different app (and render differently per OS), so these
 * screens must not reintroduce them. Comments are ignored; check marks and
 * the ✕ close glyph are typographic, not pictographic, and stay allowed.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const FILES = [
  'app/(dashboard)/dashboard/analytics/page.tsx',
  'app/(dashboard)/dashboard/nutrition/_components/NutritionScreen.tsx',
  'app/(dashboard)/dashboard/train/page.tsx',
  'app/(dashboard)/dashboard/more/page.tsx',
  'app/(dashboard)/dashboard/DashboardClient.tsx',
  'components/nutrition/StepTracking.tsx',
  'components/nutrition/NutritionTrendGraph.tsx',
  'components/dashboard/BodyMeasurements.tsx',
  'components/body/BodyHubTrends.tsx',
  'components/dashboard/DailyCheckIn.tsx',
  'components/nutrition/MacroCalculatorModal.tsx',
];

// Pictographic emoji (not ✓ ✕ ⚠ arrows or other text symbols).
const PICTOGRAPH = new RegExp('\\p{Extended_Pictographic}', 'u');
const ALLOWED = new Set(['✓', '✕', '✗', '⚠', '♥']);

function offendingLines(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
      return Array.from(line).some((ch) => PICTOGRAPH.test(ch) && !ALLOWED.has(ch));
    })
    .map((line) => line.trim());
}

describe('main tabs use line icons, not emoji', () => {
  it.each(FILES)('%s', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    expect(offendingLines(source)).toEqual([]);
  });
});
