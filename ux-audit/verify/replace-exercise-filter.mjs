/**
 * Regression: the Replace/Swap exercise picker's filters + de-dupe.
 *
 * Drives the real active-workout page at 390px, opens the swap modal for
 * "Machine Back Extension", and on the Browse All tab asserts:
 *   - the unfiltered list has NO duplicate rows (was: Hip Adduction Machine x2)
 *   - the "back" chip alone shows only back-group exercises
 *   - the query "back" alone shows Back Extension but not Cable Crunch
 *   - query + chip compose (intersection)
 *   - a proper empty state (not the default list) when nothing matches
 *   - replacing an exercise still works end-to-end via the existing action
 *
 * Run (server on :3000): node ux-audit/verify/replace-exercise-filter.mjs
 */
import { newHarness, json, BASE } from './lib.mjs';

const SID = 'sess-1';

const full = (o) => ({
  secondary_muscles: [], default_rep_range: [8, 12], default_rir: 2, min_weight_increment_kg: 2.5,
  form_cues: [], common_mistakes: [], setup_note: '',
  equipment: (o.equipment_required && o.equipment_required[0]) || 'machine',
  hypertrophy_tier: 'B', stretch_under_load: 3, resistance_profile: 3, progression_ease: 3,
  is_bodyweight: false, bodyweight_type: null, assistance_type: null,
  demo_gif_url: null, demo_thumbnail_url: null, youtube_video_id: null, exercise_type: null, ...o,
});

const backExt = full({ id: 'ex-backext', name: 'Machine Back Extension', primary_muscle: 'back', mechanic: 'isolation', movement_pattern: 'hip_hinge', equipment_required: ['machine'] });
const hipAdd = full({ id: 'ex-hipadd', name: 'Hip Adduction Machine', primary_muscle: 'adductors', mechanic: 'isolation', movement_pattern: 'isolation', equipment_required: ['machine'] });

// The library the page fetches. Note ex-backext and ex-hipadd are ALSO in the
// workout (blocks), so the page's blocks.concat(library) contains them twice —
// the de-dupe must collapse each to a single row.
const lib = [
  { id: 'ex-backext', name: 'Machine Back Extension', primary_muscle: 'back', mechanic: 'isolation', equipment_required: ['machine'], default_rep_range: [8, 12], default_rir: 2, is_bodyweight: false, hypertrophy_tier: 'B' },
  { id: 'ex-backext2', name: 'Back Extension', primary_muscle: 'back', mechanic: 'isolation', equipment_required: ['bodyweight'], default_rep_range: [8, 15], default_rir: 2, is_bodyweight: true, hypertrophy_tier: 'B' },
  { id: 'ex-row', name: 'Seated Cable Row', primary_muscle: 'lats', mechanic: 'compound', equipment_required: ['cable'], default_rep_range: [8, 12], default_rir: 2, is_bodyweight: false, hypertrophy_tier: 'A' },
  { id: 'ex-hipadd', name: 'Hip Adduction Machine', primary_muscle: 'adductors', mechanic: 'isolation', equipment_required: ['machine'], default_rep_range: [10, 15], default_rir: 2, is_bodyweight: false, hypertrophy_tier: 'C' },
  { id: 'ex-cable', name: 'Cable Crunch', primary_muscle: 'abs', mechanic: 'isolation', equipment_required: ['cable'], default_rep_range: [10, 15], default_rir: 2, is_bodyweight: false, hypertrophy_tier: 'B' },
  { id: 'ex-glute', name: 'Glute Drive', primary_muscle: 'glutes', mechanic: 'compound', equipment_required: ['machine'], default_rep_range: [8, 12], default_rir: 2, is_bodyweight: false, hypertrophy_tier: 'A' },
  { id: 'ex-kelso', name: 'Kelso Shrug', primary_muscle: 'traps', mechanic: 'isolation', equipment_required: ['cable'], default_rep_range: [12, 20], default_rir: 2, is_bodyweight: false, hypertrophy_tier: 'B' },
];

const block = (id, order, ex) => ({
  id, workout_session_id: SID, exercise_id: ex.id, order, superset_group_id: null, superset_order: null,
  target_sets: 3, target_rep_range: [8, 12], target_rir: 2, target_weight_kg: 50, target_rest_seconds: 120,
  progression_type: null, suggestion_reason: '', warmup_protocol: null, note: null,
  dropsets_per_set: null, drop_percentage: null, created_at: new Date(Date.now() - 3600e3).toISOString(),
  skipped_at: null, exercises: ex,
});

const session = {
  id: SID, user_id: 'test-user-id', mesocycle_id: null, state: 'in_progress',
  planned_date: new Date().toISOString().slice(0, 10), started_at: new Date(Date.now() - 1800e3).toISOString(),
  completed_at: null, pre_workout_check_in: null, session_rpe: null, pump_rating: null,
  session_notes: null, completion_percent: 0,
};
const user = { id: 'test-user-id', weight_kg: 80, height_cm: 180, experience: 'intermediate', training_age: 3, goal: 'hypertrophy', preferences: { units: 'kg' } };

function route(r) {
  const url = r.request().url();
  const single = (r.request().headers()['accept'] || '').includes('pgrst.object');
  if (url.includes('/rest/v1/workout_sessions')) return json(r, single ? session : [session]);
  if (url.includes('/rest/v1/exercise_blocks')) return json(r, [block('blk-1', 0, backExt), block('blk-2', 1, hipAdd)]);
  if (url.includes('/rest/v1/exercises')) {
    // handleExerciseSwap fetches the replacement by id with .single()
    const m = decodeURIComponent(url).match(/id=eq\.([^&]+)/);
    if (single && m) return json(r, lib.find((e) => e.id === m[1]) ?? null);
    return json(r, lib);
  }
  if (url.includes('/rest/v1/users')) return json(r, single ? user : [user]);
  if (url.includes('/rest/v1/set_logs')) return json(r, []);
  return json(r, single ? null : []);
}

const results = [];
const assert = (cond, msg) => { results.push(!!cond); console.log((cond ? 'PASS: ' : 'FAIL: ') + msg); };

async function run() {
  const { browser, page } = await newHarness();
  await page.route('**/rest/v1/**', route);

  await page.goto(`${BASE}/dashboard/workout/${SID}`, { waitUntil: 'domcontentloaded' });
  await page.locator('text=Machine Back Extension').first().waitFor({ state: 'visible', timeout: 20000 });

  // Open the swap modal for the active exercise.
  await page.locator('button[title="More"]').first().click();
  await page.locator('button[role="menuitem"]:has-text("Swap exercise")').first().click();
  await page.getByRole('button', { name: 'Browse All', exact: true }).click();
  await page.waitForTimeout(250);

  const rows = () => page.locator('[data-testid="swap-browse-row"]');
  const ids = async () => rows().evaluateAll((els) => els.map((e) => e.getAttribute('data-exercise-id')));
  const names = async () => rows().locator('p.font-medium').allInnerTexts();

  // 1. Unfiltered list has no duplicates (Hip Adduction Machine used to appear x2).
  const baseIds = await ids();
  const dupBase = baseIds.filter((v, i) => baseIds.indexOf(v) !== i);
  assert(dupBase.length === 0, `unfiltered browse list has no duplicate rows (got ${baseIds.length} rows, dups: ${JSON.stringify(dupBase)})`);
  const baseNames = await names();
  assert(baseNames.filter((n) => n === 'Hip Adduction Machine').length === 1, 'Hip Adduction Machine appears exactly once');

  // 2. "back" chip alone -> only back-group exercises.
  await page.getByRole('button', { name: 'back', exact: true }).click();
  await page.waitForTimeout(200);
  const chipIds = await ids();
  assert(chipIds.length > 0, 'back chip yields at least one exercise');
  assert(chipIds.includes('ex-backext2') && chipIds.includes('ex-row'), 'back chip includes Back Extension + Seated Cable Row (lats)');
  assert(!chipIds.some((id) => ['ex-cable', 'ex-glute', 'ex-kelso', 'ex-hipadd'].includes(id)), 'back chip excludes abs/glutes/traps/adductors');

  // reset chip
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.waitForTimeout(150);

  // 3. query "back" alone -> Back Extension yes, Cable Crunch no.
  const search = page.locator('input[placeholder="Search exercises..."]');
  await search.fill('back');
  await page.waitForTimeout(200);
  const qIds = await ids();
  assert(qIds.includes('ex-backext2'), 'query "back" includes Back Extension');
  assert(!qIds.includes('ex-cable'), 'query "back" excludes Cable Crunch');

  // 4. query + chip compose (intersection).
  await page.getByRole('button', { name: 'back', exact: true }).click();
  await page.waitForTimeout(200);
  const bothIds = await ids();
  assert(bothIds.includes('ex-backext2'), 'query+chip still includes Back Extension');
  assert(!bothIds.includes('ex-cable') && !bothIds.includes('ex-glute'), 'query+chip excludes off-target');
  assert(bothIds.every((id) => ['ex-backext2', 'ex-row'].includes(id)), 'query+chip is a subset of back exercises');

  // 5. Proper empty state (not the default list) when nothing matches.
  await search.fill('zzzznomatch');
  await page.waitForTimeout(200);
  assert((await ids()).length === 0, 'no rows shown when query matches nothing');
  assert(await page.locator('[data-testid="swap-browse-empty"]').isVisible(), 'empty state shown (not the default list)');

  // 6. Replace end-to-end via the existing action.
  await search.fill('back');
  await page.getByRole('button', { name: 'back', exact: true }).click();
  await page.waitForTimeout(200);
  await page.locator('[data-exercise-id="ex-backext2"]').click();
  await page.waitForTimeout(400);
  const swapModalGone = !(await page.getByText('Swap Exercise', { exact: true }).isVisible().catch(() => false));
  assert(swapModalGone, 'swap modal closed after choosing a replacement');
  assert(await page.locator('text=Back Extension').first().isVisible(), 'block now shows the swapped-in exercise (Back Extension)');

  await page.screenshot({ path: new URL('./screens/replace-filter.png', import.meta.url).pathname });
  await browser.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
