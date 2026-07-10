/**
 * Verifies Analytics (audit row #3) no longer re-blocks with its full-screen
 * loader on a repeat visit — the main bundle (profile, DEXA, photos, coaching)
 * is cached (React Query + IndexedDB persistence) and seeded on mount.
 *
 * Run (server on :3000): node ux-audit/verify/analytics-revisit.mjs
 */
import fs from 'node:fs';
import { newHarness, json, assertNoReloadSpinner } from './lib.mjs';

const OUT = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

async function run() {
  const { browser, page, user } = await newHarness();
  await page.route('**/rest/v1/users**', (r) => json(r, { id: user.id, height_cm: 180, goal: 'cut', experience: 'intermediate', target_body_fat_percent: 12, target_weight_kg: 82, sex: 'male' }));
  await page.route('**/rest/v1/dexa_scans**', (r) => json(r, [
    { id: 'd1', user_id: user.id, scan_date: '2026-06-01', weight_kg: 85, lean_mass_kg: 70, fat_mass_kg: 15, body_fat_percent: 17.6, bone_mass_kg: 3, regional_data: null, notes: null, created_at: '2026-06-01T00:00:00Z' },
  ]));
  await page.route('**/rest/v1/progress_photos**', (r) => json(r, []));
  await page.route('**/rest/v1/coaching_sessions**', (r) => json(r, []));

  const results = await assertNoReloadSpinner(page, {
    url: '/dashboard/analytics',
    awayHref: '/dashboard/nutrition',
    loadedSelector: '[data-testid="analytics-content"]',
    loadingTestid: 'analytics-full-loading',
    screenshotPrefix: 'analytics',
    out: OUT,
  });

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
