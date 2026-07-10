/**
 * Playwright verification for the Eat page cached-first day-switch flow.
 *
 * The app requires Supabase auth + data, so this harness:
 *  - forges a middleware-passing JWT cookie + a client-parseable base64 session
 *    cookie (see README.md for why two cookies are needed),
 *  - intercepts every Supabase auth/REST call with canned per-date data,
 *  - drives the 390px flow and asserts the full-screen loading testid never
 *    appears during day switches, that per-day data changes, that a quick-add
 *    updates totals immediately, and that a warm reload skips the full loader.
 *
 * Route order matters: Playwright checks routes LAST-registered-first, so the
 * '**\/rest/v1/**' catch-all is registered FIRST and specific routes after it.
 *
 * Run (server on :3000): node ux-audit/verify/nutrition-dayswitch.mjs
 * (uses the `playwright` library — no @playwright/test runner in this repo)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const OUT = new URL('./screens/', import.meta.url).pathname;
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
fs.mkdirSync(OUT, { recursive: true });

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'test-user-id', role: 'authenticated', exp })}.sig`;
const user = { id: 'test-user-id', aud: 'authenticated', role: 'authenticated', email: 'test@test.com' };
const session = { access_token: jwt, token_type: 'bearer', expires_in: 2592000, expires_at: exp, refresh_token: 'refresh-x', user };
const sessionCookie = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');

const localDate = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const TODAY = localDate(0);
const YESTERDAY = localDate(-1);
const DAYBEFORE = localDate(-2);

const foodByDate = {
  [TODAY]: [
    { id: 't1', user_id: user.id, logged_at: TODAY, meal_type: 'breakfast', food_name: 'Oats', serving_size: '1 cup', servings: 1, calories: 300, protein: 10, carbs: 54, fat: 5, source: 'manual', created_at: '2020-01-01T08:00:00Z' },
    { id: 't2', user_id: user.id, logged_at: TODAY, meal_type: 'lunch', food_name: 'Chicken', serving_size: '200g', servings: 1, calories: 330, protein: 62, carbs: 0, fat: 7, source: 'manual', created_at: '2020-01-01T12:00:00Z' },
  ],
  [YESTERDAY]: [
    { id: 'y1', user_id: user.id, logged_at: YESTERDAY, meal_type: 'dinner', food_name: 'Salmon', serving_size: '150g', servings: 1, calories: 280, protein: 39, carbs: 0, fat: 13, source: 'manual', created_at: '2020-01-01T19:00:00Z' },
  ],
  [DAYBEFORE]: [],
};
const targets = { id: 'nt1', user_id: user.id, calories: 2500, protein: 180, carbs: 250, fat: 70, meals_per_day: 4, meal_names: null };

const j = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function run() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await context.addCookies([
    { name: 'aaa-auth-token', value: jwt, domain: 'localhost', path: '/', httpOnly: false, secure: false },
    { name: 'sb-placeholder-auth-token', value: sessionCookie, domain: 'localhost', path: '/', httpOnly: false, secure: false },
  ]);

  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__fullLoadingSeen = false;
    window.__armWatch = () => {
      window.__watchArmed = true;
      new MutationObserver(() => {
        if (window.__watchArmed && document.querySelector('[data-testid="nutrition-full-loading"]')) window.__fullLoadingSeen = true;
      }).observe(document.body, { childList: true, subtree: true });
    };
  });

  // Catch-all FIRST (checked last); specific routes registered after win.
  await page.route('**/rest/v1/**', (r) => j(r, []));
  await page.route('**/auth/v1/**', (r) => j(r, user));
  await page.route('**/rest/v1/nutrition_targets**', (r) => j(r, targets));
  await page.route('**/rest/v1/users**', (r) => j(r, { id: user.id, height_cm: 180, age: 30, sex: 'male', goal: 'maintenance' }));
  await page.route('**/rest/v1/user_preferences**', (r) => j(r, { weight_unit: 'lb' }));
  await page.route('**/rest/v1/user_volume_profiles**', (r) => j(r, { training_age: 'intermediate', is_enhanced: false }));
  await page.route('**/rest/v1/food_log**', (r) => {
    const req = r.request();
    if (req.method() === 'POST') {
      const row = { id: 'new-' + Math.random().toString(36).slice(2), user_id: user.id, logged_at: TODAY, created_at: '2020-01-02T00:00:00Z', ...JSON.parse(req.postData() || '{}') };
      return j(r, row); // insert().select().single() → PostgREST returns a single object
    }
    const m = req.url().match(/logged_at=eq\.([0-9-]+)/);
    if (m) return j(r, foodByDate[m[1]] ?? []);
    // frequent/protein aggregations: repeat foods so times_logged >= 2 (the
    // frequent-chip threshold), across several past dates.
    const freq = [];
    for (let d = 1; d <= 4; d++) {
      freq.push({ ...foodByDate[TODAY][0], id: `f-oat-${d}`, logged_at: localDate(-d) });
      if (d <= 3) freq.push({ ...foodByDate[TODAY][1], id: `f-chk-${d}`, logged_at: localDate(-d) });
    }
    return j(r, freq);
  });

  const results = [];
  const assert = (cond, msg) => { results.push(!!cond); console.log((cond ? 'PASS: ' : 'FAIL: ') + msg); };
  const macroText = () => page.locator('[data-testid="nutrition-macro-summary"]').innerText();
  const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const fullCount = () => page.locator('[data-testid="nutrition-full-loading"]').count();

  // ---- Cold start ----
  await page.goto(`${BASE}/dashboard/nutrition`, { waitUntil: 'domcontentloaded' });
  assert(!page.url().includes('/login'), 'not redirected to /login (auth bypass works)');
  await page.locator('[data-testid="nutrition-macro-summary"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '01-today-coldstart.png' });

  await page.evaluate(() => window.__armWatch());
  assert((await fullCount()) === 0, 'full-screen loading absent after initial load');
  const today = await bodyText();
  assert(today.includes('Oats') && today.includes('Chicken'), 'today shows its food (Oats + Chicken)');
  assert(!today.includes('Salmon'), 'today does NOT show yesterday-only food (Salmon)');
  assert(!today.includes('Get personalized macro targets'), 'targets loaded (macro CTA gone)');

  const prevBtn = page.getByRole('button', { name: 'Previous day' });
  const nextBtn = page.getByRole('button', { name: 'Next day' });

  // ---- today -> yesterday ----
  await prevBtn.click();
  await page.waitForTimeout(450);
  await page.screenshot({ path: OUT + '02-yesterday.png' });
  assert((await fullCount()) === 0, 'no full-screen loading on switch to yesterday');
  // Salmon is yesterday-only (today never showed it) → proves per-day data
  // actually changed on the switch, not just the date header.
  const yday = await bodyText();
  assert(yday.includes('Salmon'), 'yesterday shows its own data (Salmon) after the switch');

  // ---- yesterday -> day before (empty) ----
  await prevBtn.click();
  await page.waitForTimeout(450);
  await page.screenshot({ path: OUT + '03-daybefore.png' });
  assert((await fullCount()) === 0, 'no full-screen loading on switch to day-before');

  // ---- back to today ----
  await nextBtn.click();
  await page.waitForTimeout(250);
  await nextBtn.click();
  await page.waitForTimeout(450);
  await page.screenshot({ path: OUT + '04-back-to-today.png' });
  assert((await fullCount()) === 0, 'no full-screen loading returning to today');
  const backToday = await bodyText();
  assert(backToday.includes('Oats') && backToday.includes('Chicken'), 'today data intact after round-trip');

  assert((await page.evaluate(() => window.__fullLoadingSeen)) === false, 'full-screen loading testid NEVER appeared during any switch (MutationObserver)');

  // ---- Quick-add: frequent chip must update totals immediately ----
  const beforeMacro = await macroText();
  const chip = page.locator('button', { hasText: /^\+ / }).first();
  const hasChip = (await chip.count()) > 0;
  if (hasChip) {
    await chip.click();
    await page.waitForTimeout(500);
    const afterMacro = await macroText();
    assert(afterMacro !== beforeMacro, 'quick-add (frequent chip) updated the macro totals immediately');
    await page.screenshot({ path: OUT + '06-after-quickadd.png' });
  } else {
    assert(false, 'frequent-food chip present for quick-add');
  }

  // ---- Warm reload (persisted IndexedDB cache) ----
  const samples = [];
  await page.reload({ waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 25; i++) {
    samples.push(await fullCount());
    if (await page.locator('[data-testid="nutrition-macro-summary"]').count()) break;
    await page.waitForTimeout(40);
  }
  await page.locator('[data-testid="nutrition-macro-summary"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.screenshot({ path: OUT + '05-warm-reload.png' });
  assert(samples.every((c) => c === 0), 'warm reload rendered without the full-screen loader');

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
