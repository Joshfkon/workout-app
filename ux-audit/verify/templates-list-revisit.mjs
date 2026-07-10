/**
 * Verifies the Templates list (audit row #6, deferred→now done) no longer
 * re-blocks on a repeat visit — cached in ['templates','list'].
 * Run (server on :3000): node ux-audit/verify/templates-list-revisit.mjs
 */
import fs from 'node:fs';
import { newHarness, json, assertNoReloadSpinner } from './lib.mjs';
const OUT = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

async function run() {
  const { browser, page, user } = await newHarness();
  await page.route('**/rest/v1/workout_folders**', (r) => json(r, [
    { id: 'f1', user_id: user.id, name: 'Upper/Lower', color: '#3b82f6', sort_order: 0 },
  ]));
  await page.route('**/rest/v1/workout_templates**', (r) => json(r, [
    { id: 't1', user_id: user.id, name: 'Upper A', folder_id: 'f1', sort_order: 0 },
    { id: 't2', user_id: user.id, name: 'Lower A', folder_id: null, sort_order: 1 },
  ]));
  await page.route('**/rest/v1/workout_template_exercises**', (r) => json(r, []));

  const results = await assertNoReloadSpinner(page, {
    url: '/dashboard/templates',
    awayHref: '/dashboard/nutrition',
    loadedSelector: 'text=Lower A',
    loadingTestid: 'templates-list-full-loading',
    screenshotPrefix: 'templates-list',
    out: OUT,
  });
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
