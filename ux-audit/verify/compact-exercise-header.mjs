/**
 * Regression: the compact exercise header on the active workout view.
 *
 * The old standalone header row (drag handle · number circle · "Current" pill ·
 * ⋮ · chevron) above each exercise card is gone; its functions live in the
 * card's own title row (expanded) or in a single compact list row (collapsed).
 *
 * Drives the real workout page at 390×844 with six exercises (four with a
 * logged set → main list, two untouched → "Up next") and asserts:
 *   1. No "Current" pill anywhere; exactly one ⋮ per main-list block.
 *   2. Position badges use the "n/total" format and count non-skipped blocks.
 *   3. Drag-to-reorder works from the new grip — from the EXPANDED card's
 *      title row and from a COLLAPSED row — and badges renumber after drop.
 *   4. Collapse (card chevron) → expand (row chevron) round-trips WITHOUT
 *      losing an in-progress, unlogged stepper edit (the card is CSS-hidden,
 *      not unmounted).
 *   5. "Skip today" on an up-next exercise renumbers the badges' total.
 *   6. A long exercise name ("Standing Calf Raise (Dumbbell)") truncates:
 *      no horizontal page overflow and the trailing controls stay on-screen,
 *      at default and enlarged (22px) font size.
 *   7. The ⋮ menu contains the "Exercise info" item (the relocated ⓘ).
 *
 * Run (server on :3000): node ux-audit/verify/compact-exercise-header.mjs
 */
import { newHarness, json, BASE } from './lib.mjs';

const SID = 'sess-compact';

const EX = [
  { id: 'ex0', name: 'Standing Calf Raise (Dumbbell)', primary_muscle: 'calves' },
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
// Blocks 0-3 have a logged set (main list); 4-5 are untouched ("Up next").
const setRows = [0, 1, 2, 3].map((i) => setLog(i));

function route(r) {
  const req = r.request();
  const url = req.url();
  const method = req.method();
  const single = (req.headers()['accept'] || '').includes('pgrst.object');

  if (url.includes('/rest/v1/workout_sessions')) return json(r, single ? session : [session]);
  if (url.includes('/rest/v1/exercise_blocks')) return json(r, method === 'GET' ? blocksRows : []);
  if (url.includes('/rest/v1/set_logs')) return json(r, method === 'GET' ? setRows : []);
  if (url.includes('/rest/v1/exercises')) return json(r, single ? null : EX.map(fullExercise));
  if (url.includes('/rest/v1/users')) return json(r, single ? user : [user]);
  return json(r, single ? null : []);
}

const results = [];
const assert = (cond, msg) => { results.push(!!cond); console.log((cond ? 'PASS: ' : 'FAIL: ') + msg); };

const OUT = new URL('./screens/', import.meta.url).pathname;

/** Long-press drag from (x,y) to targetY with real mouse events. */
async function dragFrom(page, x, y, targetY) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(350); // > 150ms long-press activation
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x, y + ((targetY - y) * i) / 8);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(600);
}

async function run() {
  const { browser, page } = await newHarness();
  await page.route('**/rest/v1/**', route);

  await page.goto(`${BASE}/dashboard/workout/${SID}`, { waitUntil: 'domcontentloaded' });
  await page.locator('text=Standing Calf Raise').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(500);

  const badge = (i) => page.locator(`[data-block-index="${i}"] [data-testid="position-badge"]`);
  const cardHeader = (i) => page.locator(`[data-block-index="${i}"] div.sticky`);

  // --- 1. Old header chrome is gone. --------------------------------------
  assert((await page.getByText('Current', { exact: true }).count()) === 0, 'no "Current" pill anywhere');
  // Focus mode: block 0 expanded (card ⋮), blocks 1-3 collapsed rows (row ⋮) → 4 total, one per main-list block.
  assert((await page.locator('[data-testid="row-menu-trigger"]').count()) === 4, 'exactly one ⋮ per main-list block (4)');

  // --- 2. Position badges are n/total (skipped excluded). ------------------
  assert((await badge(0).innerText()) === '1/6', `expanded card badge reads 1/6 (got ${await badge(0).innerText()})`);
  assert((await badge(1).innerText()) === '2/6', 'first collapsed row badge reads 2/6');
  await page.screenshot({ path: `${OUT}compact-header-initial.png` });

  // --- 7. ⋮ menu carries the relocated ⓘ as "Exercise info". ---------------
  await page.locator('[data-testid="row-menu-trigger"]').first().click();
  await page.locator('[data-testid="row-menu"]').waitFor({ state: 'visible', timeout: 5000 });
  assert(await page.locator('[data-testid="row-menu-item-info"]').isVisible(), '⋮ menu has an "Exercise info" item');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // --- 6. Long-name truncation, default and enlarged font. -----------------
  const nameBtn = cardHeader(0).locator('button', { hasText: 'Standing Calf Raise' }).first();
  const fits = async () => {
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const chev = await page.locator('[data-block-index="0"] [aria-label="Collapse exercise"]').boundingBox();
    return pageOverflow && !!chev && chev.x + chev.width <= 390;
  };
  assert(await fits(), 'long name: no horizontal overflow, controls on-screen (default font)');
  await nameBtn.evaluate((el) => { el.style.fontSize = '22px'; });
  await page.waitForTimeout(100);
  assert(await fits(), 'long name: no horizontal overflow, controls on-screen (22px font)');
  const truncated = await nameBtn.evaluate((el) => el.scrollWidth > el.clientWidth);
  assert(truncated, 'enlarged long name shows ellipsis truncation (scrollWidth > clientWidth)');
  await nameBtn.evaluate((el) => { el.style.fontSize = ''; });

  // --- 4. Collapse/expand round-trip keeps unlogged stepper input. ---------
  await page.locator('[data-block-index="0"] [aria-label="Increase weight"]').first().click();
  const editedWeight = await page.locator('[data-block-index="0"] button[aria-label^="Weight:"]').first().innerText();
  await page.locator('[data-block-index="0"] [aria-label="Collapse exercise"]').click();
  await page.waitForTimeout(200);
  assert(
    await page.locator('[data-block-index="0"] [aria-label="Expand exercise"]').isVisible(),
    'card chevron collapses block 0 to a single list row'
  );
  await page.screenshot({ path: `${OUT}compact-header-collapsed-row.png` });
  await page.locator('[data-block-index="0"] [aria-label="Expand exercise"]').click();
  await page.waitForTimeout(200);
  const weightAfter = await page.locator('[data-block-index="0"] button[aria-label^="Weight:"]').first().innerText();
  assert(
    weightAfter === editedWeight,
    `in-progress stepper edit survives collapse/expand (${editedWeight} → ${weightAfter})`
  );

  // --- 3a. Drag-to-reorder from the EXPANDED card's grip. ------------------
  const grip0 = await page.locator('[data-block-index="0"] [data-drag-handle]').first().boundingBox();
  assert(!!grip0 && grip0.width >= 40 && grip0.height >= 44, `expanded grip hit area ≥ 40×44 (got ${Math.round(grip0?.width)}×${Math.round(grip0?.height)})`);
  // Drop below the next TWO rows → Standing Calf Raise should land at index 2.
  const row2Before = await page.locator('[data-block-index="2"]').boundingBox();
  await dragFrom(page, grip0.x + grip0.width / 2, grip0.y + grip0.height / 2, row2Before.y + row2Before.height + 20);
  const nameAt0 = await page.locator('[data-block-index="0"]').innerText();
  assert(!nameAt0.includes('Standing Calf Raise'), 'expanded-grip drag moved the exercise out of slot 0');
  const calfIdx = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-block-index]')];
    const hit = nodes.find((n) => n.innerText.includes('Standing Calf Raise'));
    return hit ? Number(hit.dataset.blockIndex) : -1;
  });
  assert(calfIdx > 0, `dragged exercise re-inserted lower in the list (index ${calfIdx})`);
  const calfBadge = await page.locator(`[data-block-index="${calfIdx}"] [data-testid="position-badge"]`).first().innerText();
  assert(calfBadge === `${calfIdx + 1}/6`, `position badge renumbered after reorder (${calfBadge})`);
  assert((await badge(0).first().innerText()) === '1/6', 'slot 0 badge is 1/6 after reorder');

  // --- 3b. Drag-to-reorder from a COLLAPSED row's grip. --------------------
  const nameAt0Before = (await page.locator('[data-block-index="0"]').innerText()).split('\n').find((s) => s.length > 3);
  const gripC = await page.locator(`[data-block-index="${calfIdx}"] [data-drag-handle]`).first().boundingBox();
  assert(!!gripC && gripC.height >= 40, `collapsed grip hit area tall enough (got ${Math.round(gripC?.height)})`);
  const row0Box = await page.locator('[data-block-index="0"]').boundingBox();
  await dragFrom(page, gripC.x + gripC.width / 2, gripC.y + gripC.height / 2, row0Box.y - 10);
  const topAfter = await page.locator('[data-block-index="0"]').innerText();
  assert(topAfter.includes('Standing Calf Raise'), 'collapsed-grip drag moved the exercise back to the top');
  assert((await badge(0).first().innerText()) === '1/6', 'badge at slot 0 reads 1/6 after second reorder');

  // --- 5. Skipping an up-next exercise renumbers the total. ----------------
  await page.getByText('Lateral Raise').first().scrollIntoViewIfNeeded();
  await page.locator('button', { hasText: 'Skip today' }).last().click();
  await page.waitForTimeout(400);
  assert((await badge(0).first().innerText()) === '1/5', `badge total drops after skip (got ${await badge(0).first().innerText()})`);
  await page.screenshot({ path: `${OUT}compact-header-after-skip.png` });

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
