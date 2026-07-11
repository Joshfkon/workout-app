/**
 * Regression: the Add-Exercise picker filters (shared with library / replace).
 * 390px, opened from an active workout. Asserts the muscle chip, the text
 * query, their composition, and no duplicate rows.
 *
 * Run (server on :3000): node ux-audit/verify/add-exercise-filter.mjs
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
const bench = full({ id: 'ex-bench', name: 'Barbell Bench Press', primary_muscle: 'chest', mechanic: 'compound', movement_pattern: 'horizontal_press', equipment_required: ['barbell'] });

const lib = [
  { id: 'ex-bench', name: 'Barbell Bench Press', primary_muscle: 'chest', mechanic: 'compound', equipment_required: ['barbell'], default_rep_range: [6, 10], default_rir: 2, is_bodyweight: false, hypertrophy_tier: 'S' },
  { id: 'ex-backext2', name: 'Back Extension', primary_muscle: 'back', mechanic: 'isolation', equipment_required: ['bodyweight'], default_rep_range: [8, 15], default_rir: 2, is_bodyweight: true, hypertrophy_tier: 'B' },
  { id: 'ex-row', name: 'Seated Cable Row', primary_muscle: 'lats', mechanic: 'compound', equipment_required: ['cable'], default_rep_range: [8, 12], default_rir: 2, is_bodyweight: false, hypertrophy_tier: 'A' },
  { id: 'ex-cable', name: 'Cable Crunch', primary_muscle: 'abs', mechanic: 'isolation', equipment_required: ['cable'], default_rep_range: [10, 15], default_rir: 2, is_bodyweight: false, hypertrophy_tier: 'B' },
  { id: 'ex-glute', name: 'Glute Drive', primary_muscle: 'glutes', mechanic: 'compound', equipment_required: ['machine'], default_rep_range: [8, 12], default_rir: 2, is_bodyweight: false, hypertrophy_tier: 'A' },
];

const block = { id: 'blk-1', workout_session_id: SID, exercise_id: 'ex-bench', order: 0, superset_group_id: null, superset_order: null, target_sets: 3, target_rep_range: [6, 10], target_rir: 2, target_weight_kg: 60, target_rest_seconds: 120, progression_type: null, suggestion_reason: '', warmup_protocol: null, note: null, dropsets_per_set: null, drop_percentage: null, created_at: new Date(Date.now() - 3600e3).toISOString(), skipped_at: null, exercises: bench };
const session = { id: SID, user_id: 'test-user-id', mesocycle_id: null, state: 'in_progress', planned_date: new Date().toISOString().slice(0, 10), started_at: new Date(Date.now() - 1800e3).toISOString(), completed_at: null, pre_workout_check_in: null, session_rpe: null, pump_rating: null, session_notes: null, completion_percent: 0 };
const user = { id: 'test-user-id', weight_kg: 80, height_cm: 180, experience: 'intermediate', training_age: 3, goal: 'hypertrophy', preferences: { units: 'kg' } };

function route(r) {
  const url = r.request().url();
  const single = (r.request().headers()['accept'] || '').includes('pgrst.object');
  if (url.includes('/rest/v1/workout_sessions')) return json(r, single ? session : [session]);
  if (url.includes('/rest/v1/exercise_blocks')) return json(r, [block]);
  if (url.includes('/rest/v1/exercises')) return json(r, lib);
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
  await page.locator('text=Barbell Bench Press').first().waitFor({ state: 'visible', timeout: 20000 });

  // Open the Add-Exercise picker.
  await page.getByRole('button', { name: '+ Add Exercise' }).click();
  await page.locator('input[placeholder="Search exercises..."]').waitFor({ state: 'visible', timeout: 5000 });

  const rows = () => page.locator('[data-testid="add-exercise-row"]');
  const ids = async () => rows().evaluateAll((els) => els.map((e) => e.getAttribute('data-exercise-id')));

  // 1. Query "back" alone -> Back Extension yes, Cable Crunch no.
  const search = page.locator('input[placeholder="Search exercises..."]');
  await search.fill('back');
  await page.waitForTimeout(250);
  let shown = await ids();
  assert(shown.includes('ex-backext2'), 'query "back" includes Back Extension');
  assert(!shown.includes('ex-cable'), 'query "back" excludes Cable Crunch');
  const dups = shown.filter((v, i) => shown.indexOf(v) !== i);
  assert(dups.length === 0, 'no duplicate rows in the query results');

  // 2. Muscle chip "Back" alone. The add-picker's default view curates a
  // "Suggested" subset; expanding "Browse all" shows the full group-aware pool,
  // which must include the sub-muscle (lats) row and exclude off-target muscles.
  await search.fill('');
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.waitForTimeout(200);
  const browseAll = page.getByRole('button', { name: /Browse all \d+ exercises/ });
  if (await browseAll.count()) { await browseAll.click(); await page.waitForTimeout(200); }
  shown = await ids();
  assert(shown.includes('ex-backext2') && shown.includes('ex-row'), 'Back chip (browse all) shows Back Extension + Seated Cable Row (lats)');
  assert(!shown.some((id) => ['ex-cable', 'ex-glute', 'ex-bench'].includes(id)), 'Back chip hides off-target muscles');

  // 2b. A PRECISE chip ("Lats") must NOT widen to generic back rows.
  await page.getByRole('button', { name: 'Lats', exact: true }).click();
  await page.waitForTimeout(200);
  const browseAll2 = page.getByRole('button', { name: /Browse all \d+ exercises/ });
  if (await browseAll2.count()) { await browseAll2.click(); await page.waitForTimeout(200); }
  shown = await ids();
  assert(shown.includes('ex-row'), 'Lats chip shows Seated Cable Row');
  assert(!shown.includes('ex-backext2'), 'Lats chip does NOT widen to the generic Back Extension');

  // back to Back chip for the compose check
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.waitForTimeout(200);

  // 3. Chip + query compose.
  await search.fill('extension');
  await page.waitForTimeout(250);
  shown = await ids();
  assert(shown.includes('ex-backext2') && !shown.includes('ex-row'), 'chip+query compose (Back + "extension" -> only Back Extension)');

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
