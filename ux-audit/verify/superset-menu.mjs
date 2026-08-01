/**
 * Regression: the per-row overflow (⋮) menu that replaced the inter-row
 * "Link Superset" pill on the active-workout view.
 *
 * Drives the real workout page at 390×844 with six exercises all in the main
 * list (each seeded with a logged set) and asserts:
 *   1. ⋮ opens the menu; outside tap and Escape both close it.
 *   2. "Link with {next}" clusters both exercises AND persists the link
 *      (PATCH exercise_blocks with superset_group_id).
 *   3. "Unlink from superset" from a member dissolves the cluster.
 *   4. The last row offers "Link with {prev}", not "Link with {next}".
 *   5. A clustered row shows "Unlink", never a link option.
 *   6. "Remove" deletes the row and is unreachable without opening the menu.
 *   7. No "Link Superset" text exists anywhere in the rendered list.
 *   8. Six rows + their ⋮ fit in 390×844 (last trigger on-screen, menu unclipped).
 *
 * Run (server on :3000): node ux-audit/verify/superset-menu.mjs
 */
import { newHarness, json, BASE } from './lib.mjs';

const SID = 'sess-ss';

const EX = [
  { id: 'ex0', name: 'Bench Press', primary_muscle: 'chest' },
  { id: 'ex1', name: 'Incline DB Press', primary_muscle: 'chest' },
  { id: 'ex2', name: 'Cable Fly', primary_muscle: 'chest' },
  { id: 'ex3', name: 'Triceps Pushdown', primary_muscle: 'triceps' },
  { id: 'ex4', name: 'Overhead Press', primary_muscle: 'shoulders' },
  { id: 'ex5', name: 'Lateral Raise', primary_muscle: 'shoulders' },
];

const fullExercise = (o) => ({
  secondary_muscles: [], mechanic: 'compound', default_rep_range: [8, 12], default_rir: 2,
  min_weight_increment_kg: 2.5, form_cues: [], common_mistakes: [], setup_note: '',
  movement_pattern: '', equipment_required: ['barbell'], equipment: 'barbell',
  hypertrophy_tier: 'B', stretch_under_load: 3, resistance_profile: 3, progression_ease: 3,
  is_bodyweight: false, bodyweight_type: null, assistance_type: null,
  demo_gif_url: null, demo_thumbnail_url: null, youtube_video_id: null, exercise_type: null, ...o,
});

const block = (i) => ({
  id: `blk-${i}`, workout_session_id: SID, exercise_id: EX[i].id, order: i,
  superset_group_id: null, superset_order: null,
  target_sets: 3, target_rep_range: [8, 12], target_rir: 2, target_weight_kg: 60,
  target_rest_seconds: 90, progression_type: null, suggestion_reason: '',
  warmup_protocol: null, note: null, dropsets_per_set: null, drop_percentage: null,
  pump: null, workload: null, created_at: new Date(Date.now() - 3600e3).toISOString(),
  skipped_at: null, exercises: fullExercise(EX[i]),
});

// One completed working set per block -> every block lands in the MAIN list
// (isBlockInMainList = current || has-sets), so all six rows render a ⋮.
const setLog = (i) => ({
  id: `set-${i}`, exercise_block_id: `blk-${i}`, set_number: 1, weight_kg: 60, reps: 10, rpe: 8,
  rest_seconds: 90, is_warmup: false, set_type: 'normal', set_role: 'working',
  parent_set_id: null, quality: 'stimulative', quality_reason: '', note: null,
  logged_at: new Date(Date.now() - 600e3).toISOString(), feedback: null, bodyweight_data: null,
});

const session = {
  id: SID, user_id: 'test-user-id', mesocycle_id: null, state: 'in_progress',
  planned_date: new Date().toISOString().slice(0, 10), started_at: new Date(Date.now() - 1800e3).toISOString(),
  completed_at: null, duration_seconds: null, pre_workout_check_in: null, session_rpe: null,
  pump_rating: null, session_notes: null, completion_percent: 0, is_deload: false,
};
const user = { id: 'test-user-id', weight_kg: 80, height_cm: 180, experience: 'intermediate', training_age: 3, goal: 'hypertrophy', preferences: { units: 'kg' } };

const blocksRows = EX.map((_, i) => block(i));
const setRows = EX.map((_, i) => setLog(i));

// Record superset link/unlink writes so we can assert persistence.
const supersetPatches = [];

function route(r) {
  const req = r.request();
  const url = req.url();
  const method = req.method();
  const single = (req.headers()['accept'] || '').includes('pgrst.object');

  if (url.includes('/rest/v1/workout_sessions')) return json(r, single ? session : [session]);
  if (url.includes('/rest/v1/exercise_blocks')) {
    if (method === 'PATCH') {
      const body = req.postData() || '';
      if (body.includes('superset_group_id')) supersetPatches.push(body);
      return json(r, []);
    }
    if (method === 'DELETE') {
      // The delete asks for the removed rows back (return=representation) to
      // detect an RLS-refused 0-row delete — echo the matched id like PostgREST.
      const idMatch = url.match(/[?&]id=eq\.([^&]+)/);
      return json(r, idMatch ? [{ id: decodeURIComponent(idMatch[1]) }] : []);
    }
    return json(r, blocksRows);
  }
  if (url.includes('/rest/v1/set_logs')) return json(r, method === 'GET' ? setRows : []);
  if (url.includes('/rest/v1/exercises')) return json(r, single ? null : EX.map(fullExercise));
  if (url.includes('/rest/v1/users')) return json(r, single ? user : [user]);
  return json(r, single ? null : []);
}

const results = [];
const assert = (cond, msg) => { results.push(!!cond); console.log((cond ? 'PASS: ' : 'FAIL: ') + msg); };

const OUT = new URL('./screens/', import.meta.url).pathname;

async function run() {
  const { browser, page } = await newHarness();
  await page.route('**/rest/v1/**', route);

  await page.goto(`${BASE}/dashboard/workout/${SID}`, { waitUntil: 'domcontentloaded' });
  await page.locator('text=Bench Press').first().waitFor({ state: 'visible', timeout: 20000 });

  const triggers = () => page.locator('[data-testid="row-menu-trigger"]');
  const menu = () => page.locator('[data-testid="row-menu"]');
  const menuItem = (key) => page.locator(`[data-testid="row-menu-item-${key}"]`);

  // Collapse all rows so the six compact headers (and their ⋮) share one screen.
  await page.locator('button[aria-label="More actions"]').first().click();
  await page.getByRole('menuitem', { name: 'Collapse all' }).click();
  await page.waitForTimeout(300);

  assert((await triggers().count()) === 6, 'all six rows render a ⋮ trigger');

  // --- 7. No "Link Superset" text anywhere. -------------------------------
  assert(!(await page.getByText('Link Superset').count()), 'no "Link Superset" pill text in the list');

  // --- 6a. Remove is not reachable without opening a menu. ----------------
  assert((await menuItem('remove').count()) === 0, 'Remove is not in the DOM until a menu opens');

  // --- 1. Open / outside-tap / Escape. ------------------------------------
  await triggers().nth(0).click();
  await menu().waitFor({ state: 'visible', timeout: 5000 });
  assert(await menu().isVisible(), '⋮ opens the popover menu');
  assert(await triggers().nth(0).getAttribute('aria-expanded') === 'true', 'trigger reports aria-expanded=true');
  // Outside tap closes.
  await page.mouse.click(5, 400);
  await page.waitForTimeout(150);
  assert(!(await menu().count()), 'outside tap closes the menu');
  // Escape closes.
  await triggers().nth(0).click();
  await menu().waitFor({ state: 'visible', timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  assert(!(await menu().count()), 'Escape closes the menu');

  // --- 2. Link with {next} clusters + persists. ---------------------------
  await triggers().nth(0).click();
  await menu().waitFor({ state: 'visible' });
  assert(await menuItem('link-next').isVisible(), 'row 0 offers "Link with next"');
  assert((await menuItem('link-next').innerText()).includes('Incline DB Press'), 'link label names the next exercise');
  const patchesBefore = supersetPatches.length;
  await menuItem('link-next').click();
  await page.waitForTimeout(400);
  const row0 = page.locator('[data-block-index="0"]');
  const row1 = page.locator('[data-block-index="1"]');
  assert(await row0.getAttribute('data-superset-clustered') === 'true', 'row 0 is now clustered');
  assert(await row1.getAttribute('data-superset-clustered') === 'true', 'row 1 is now clustered');
  assert(await page.locator('[data-testid="superset-eyebrow"]').first().isVisible(), 'SUPERSET eyebrow renders');
  const slots = await page.locator('[data-testid="superset-slot"]').allInnerTexts();
  assert(slots.slice(0, 2).join('') === 'AB', 'members show A then B slot letters (got ' + JSON.stringify(slots) + ')');
  assert(supersetPatches.length > patchesBefore, 'link persisted a superset_group_id PATCH to exercise_blocks');
  await page.screenshot({ path: `${OUT}superset-linked.png` });

  // --- 5. A clustered row shows Unlink, never a link option. --------------
  await triggers().nth(0).click();
  await menu().waitFor({ state: 'visible' });
  assert(await menuItem('unlink').isVisible(), 'clustered row shows "Unlink from superset"');
  assert((await menuItem('link-next').count()) === 0 && (await menuItem('link-prev').count()) === 0, 'clustered row shows no link option');

  // --- 3. Unlink dissolves the cluster. -----------------------------------
  await menuItem('unlink').click();
  await page.waitForTimeout(400);
  assert(await row0.getAttribute('data-superset-clustered') === null, 'row 0 no longer clustered after unlink');
  assert(await row1.getAttribute('data-superset-clustered') === null, 'row 1 no longer clustered after unlink');
  assert((await page.locator('[data-testid="superset-eyebrow"]').count()) === 0, 'cluster chrome gone after unlink');

  // --- 4. Last row offers Link-with-prev, not Link-with-next. --------------
  await triggers().nth(5).scrollIntoViewIfNeeded();
  await triggers().nth(5).click();
  await menu().waitFor({ state: 'visible' });
  assert((await menuItem('link-next').count()) === 0, 'last row offers no "Link with next"');
  assert(await menuItem('link-prev').isVisible(), 'last row offers "Link with prev"');
  assert((await menuItem('link-prev').innerText()).includes('Overhead Press'), 'prev-link label names the previous exercise');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // --- 8. Six rows + ⋮ fit 390×844; the last menu is unclipped. -----------
  const lastBox = await triggers().nth(5).boundingBox();
  assert(!!lastBox && lastBox.y + lastBox.height <= 844, `last row's ⋮ is on-screen (bottom=${lastBox ? Math.round(lastBox.y + lastBox.height) : 'n/a'} ≤ 844)`);
  await triggers().nth(5).click();
  await menu().waitFor({ state: 'visible' });
  const menuBox = await menu().boundingBox();
  assert(!!menuBox && menuBox.y >= 0 && menuBox.y + menuBox.height <= 844, 'last row menu is fully within the viewport (flipped/clamped, not clipped)');
  await page.screenshot({ path: `${OUT}superset-lastrow-menu.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // --- 6b. Remove deletes the row (via the menu-only destructive action). --
  const countBefore = await triggers().count();
  await triggers().nth(2).click();
  await menu().waitFor({ state: 'visible' });
  await menuItem('remove').click();
  // ConfirmModal (title "Remove Exercise", confirm button "Remove").
  await page.getByRole('heading', { name: 'Remove Exercise' }).waitFor({ state: 'visible', timeout: 5000 });
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.waitForTimeout(400);
  assert((await triggers().count()) === countBefore - 1, 'Remove deletes exactly one row');

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
