/**
 * Settings (audit row #7) — cached in ['settings','user'], same pattern as the
 * verified surfaces.
 *
 * NOTE: this spec CANNOT run against the mocked-Supabase harness. `/settings`
 * is a "sensitive route" in lib/supabase/middleware.ts, so middleware always
 * does a server-side `getUser()` (no cookie fast-path) — which, with a
 * placeholder Supabase URL, fails server-side and redirects to /login. There
 * is no way to mock a server-side fetch from Playwright. Settings is therefore
 * verified by typecheck + build + pattern-parity with the five surfaces whose
 * revisit specs DO pass; run this spec only against a real Supabase.
 * Run (real Supabase, server on :3000): node ux-audit/verify/settings-revisit.mjs
 */
import fs from 'node:fs';
import { newHarness, json, assertNoReloadSpinner } from './lib.mjs';
const OUT = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

async function run() {
  const { browser, page, user } = await newHarness();
  await page.route('**/rest/v1/users**', (r) => json(r, {
    id: user.id, goal: 'cut', experience: 'intermediate', height_cm: 180, weight_kg: 85,
    preferences: { units: 'lb', restTimer: 180 }, volume_landmarks: {}, age: 30,
  }));
  await page.route('**/rest/v1/weight_log**', (r) => json(r, { weight: 187, unit: 'lb', logged_at: '2026-07-09' }));

  const results = await assertNoReloadSpinner(page, {
    url: '/dashboard/settings',
    awayHref: '/dashboard/nutrition',
    loadedSelector: 'h1:has-text("Settings")',
    loadingTestid: 'settings-full-loading',
    screenshotPrefix: 'settings',
    out: OUT,
  });
  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
