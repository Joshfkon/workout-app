/**
 * Regression: the Exercise Library screen filters (shared with the add /
 * replace pickers). 390px. Asserts the muscle chip, the text query, their
 * composition, and that there are no duplicate rows.
 *
 * Run (server on :3000): node ux-audit/verify/library-filter.mjs
 */
import { newHarness, json, BASE } from './lib.mjs';

const ex = (id, name, primary_muscle, equipment) => ({
  id, name, primary_muscle, secondary_muscles: [], mechanic: 'compound',
  form_cues: [], common_mistakes: [], equipment_required: [equipment], equipment,
  movement_pattern: 'x', is_bodyweight: false, bodyweight_type: null, assistance_type: null,
  is_custom: false, hypertrophy_tier: 'B', stretch_under_load: 3, resistance_profile: 3,
  progression_ease: 3, demo_gif_url: null, demo_thumbnail_url: null, youtube_video_id: null,
});

const exercises = [
  ex('backext2', 'Back Extension', 'back', 'bodyweight'),
  ex('row', 'Seated Cable Row', 'lats', 'cable'),
  ex('cable', 'Cable Crunch', 'abs', 'cable'),
  ex('glute', 'Glute Drive', 'glutes', 'machine'),
  ex('kelso', 'Kelso Shrug', 'traps', 'cable'),
];

const results = [];
const assert = (cond, msg) => { results.push(!!cond); console.log((cond ? 'PASS: ' : 'FAIL: ') + msg); };

async function run() {
  const { browser, page } = await newHarness();
  await page.route('**/rest/v1/exercises**', (r) => json(r, exercises));

  await page.goto(`${BASE}/dashboard/exercises`, { waitUntil: 'domcontentloaded' });
  await page.locator('text=Back Extension').first().waitFor({ state: 'visible', timeout: 20000 });

  const names = () => page.locator('[data-testid="library-exercise-name"]');
  const visibleNames = async () => names().allInnerTexts();

  // 0. No duplicate rows in the unfiltered list.
  const all = await visibleNames();
  const dups = all.filter((v, i) => all.indexOf(v) !== i);
  assert(dups.length === 0, `no duplicate rows unfiltered (${all.length} rows)`);

  // 1. Muscle chip "back" alone -> only back-group exercises.
  await page.getByRole('button', { name: 'back', exact: true }).click();
  await page.waitForTimeout(200);
  let shown = await visibleNames();
  assert(shown.includes('Back Extension') && shown.includes('Seated Cable Row'), 'back chip shows Back Extension + Seated Cable Row (lats)');
  assert(!shown.includes('Cable Crunch') && !shown.includes('Glute Drive') && !shown.includes('Kelso Shrug'), 'back chip hides off-target muscles');

  // reset
  await page.getByRole('button', { name: 'All', exact: true }).first().click();
  await page.waitForTimeout(150);

  // 2. Query "back" alone -> Back Extension yes, Cable Crunch no.
  const search = page.locator('input[placeholder="Search exercises..."]');
  await search.fill('back');
  await page.waitForTimeout(200);
  shown = await visibleNames();
  assert(shown.includes('Back Extension'), 'query "back" includes Back Extension');
  assert(!shown.includes('Cable Crunch'), 'query "back" excludes Cable Crunch');

  // 3. Query + chip compose.
  await page.getByRole('button', { name: 'back', exact: true }).click();
  await page.waitForTimeout(200);
  shown = await visibleNames();
  assert(shown.includes('Back Extension') && !shown.includes('Cable Crunch'), 'query+chip compose (intersection)');
  assert(shown.every((n) => ['Back Extension', 'Seated Cable Row'].includes(n)), 'query+chip stays within back exercises');

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
