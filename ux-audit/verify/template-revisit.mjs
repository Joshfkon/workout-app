/**
 * Verifies a template detail page (audit row #5) no longer re-blocks with its
 * full-screen loader on a repeat visit — per-template data is cached by id
 * (React Query + IndexedDB persistence) and seeded on mount.
 *
 * Run (server on :3000): node ux-audit/verify/template-revisit.mjs
 */
import fs from 'node:fs';
import { newHarness, json, assertNoReloadSpinner } from './lib.mjs';

const OUT = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const TID = 'tmpl-123';
const template = { id: TID, user_id: 'test-user-id', name: 'Push Day A', notes: 'Heavy pressing', folder_id: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
const templateExercises = [
  { id: 'te1', template_id: TID, exercise_id: 'x1', exercise_name: 'Bench Press', sort_order: 0, default_sets: 3, default_reps: '8-12', default_weight: null, default_rest_seconds: 90, notes: null },
];

async function run() {
  const { browser, page } = await newHarness();
  await page.route('**/rest/v1/workout_templates**', (r) => json(r, template));
  await page.route('**/rest/v1/workout_template_exercises**', (r) => json(r, templateExercises));
  await page.route('**/rest/v1/workout_folders**', (r) => json(r, []));
  await page.route('**/rest/v1/exercises**', (r) => json(r, []));

  const results = await assertNoReloadSpinner(page, {
    url: `/dashboard/templates/${TID}`,
    awayHref: '/dashboard/nutrition',
    loadedSelector: 'text=Push Day A',
    loadingTestid: 'template-full-loading',
    screenshotPrefix: 'template',
    out: OUT,
  });

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
