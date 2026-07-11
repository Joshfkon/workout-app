/**
 * Playwright verification for the Eat -> Insights "Nutrition Trends" chart
 * (and the Macros view + Weight sub-tab chart) x-axis date labels.
 *
 * Verifies at 7D/14D/30D/90D on a 390px-wide viewport that:
 *  - date tick labels are short ("Jul 4", no year within a single year),
 *  - visible tick labels never horizontally overlap,
 *  - no tick label is clipped at the plot edges,
 *  - the dashed "Target" line label renders fully (not clipped at the right).
 *
 * Mirrors the auth/route-mock approach of nutrition-dayswitch.mjs.
 *
 * Run (server on :3000): node ux-audit/verify/nutrition-trend-axis.mjs
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

// 100 days of daily food-log rows so the trend graph has a point per day at
// every range (7/14/30/90). One row per date is enough (the graph aggregates).
const foodSeries = [];
for (let i = 100; i >= 0; i--) {
  const wave = Math.sin(i / 4);
  foodSeries.push({
    logged_at: localDate(-i),
    calories: 2200 + Math.round(wave * 300),
    protein: 160 + Math.round(wave * 25),
    carbs: 220 + Math.round(wave * 30),
    fat: 65 + Math.round(wave * 10),
  });
}

// Weight rows for the Weight sub-tab chart (last ~30 days).
const weightSeries = [];
for (let i = 30; i >= 0; i--) {
  weightSeries.push({
    id: `w-${i}`,
    user_id: user.id,
    logged_at: localDate(-i),
    weight: 180 - i * 0.1,
    unit: 'lb',
    created_at: '2020-01-01T08:00:00Z',
  });
}

const targets = { id: 'nt1', user_id: user.id, calories: 2500, protein: 180, carbs: 250, fat: 70, meals_per_day: 4, meal_names: null };

const j = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

const results = [];
const assert = (cond, msg) => { results.push(!!cond); console.log((cond ? 'PASS: ' : 'FAIL: ') + msg); };

const ANGLE_RAD = (35 * Math.PI) / 180; // x-axis labels are rotated -35deg

/** Read the visible x-axis tick labels: text, anchor point, rendered bbox. */
async function tickBoxes(page) {
  return page.$$eval('.recharts-xAxis .recharts-cartesian-axis-tick-value', (nodes) =>
    nodes
      .map((n) => {
        const r = n.getBoundingClientRect();
        return {
          text: (n.textContent || '').trim(),
          // anchor point (tick position) in CSS px — the SVG maps 1:1 to CSS px
          ax: Number(n.getAttribute('x')),
          ay: Number(n.getAttribute('y')),
          left: r.x,
          right: r.x + r.width,
          top: r.y,
          bottom: r.y + r.height,
        };
      })
      .filter((b) => b.text.length > 0)
  );
}

/** Assert labels are non-overlapping, short (no year), and unclipped. */
async function checkAxis(page, tag) {
  const boxes = await tickBoxes(page);
  assert(boxes.length >= 2, `${tag}: has at least first+last labels (${boxes.length})`);

  // Labels are rotated -35deg and anchored at the tick, so they form parallel
  // diagonal strips. Two strips collide only if their perpendicular separation
  // is smaller than the label's line height. Perp separation between anchors
  // spaced `s` px apart horizontally is s*sin(35deg). Require it to clear the
  // ~11px line height with a small margin.
  const sorted = [...boxes].sort((a, b) => a.ax - b.ax);
  let minPerp = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const perp = (sorted[i].ax - sorted[i - 1].ax) * Math.sin(ANGLE_RAD);
    minPerp = Math.min(minPerp, perp);
  }
  assert(minPerp >= 10, `${tag}: no overlapping labels (min perpendicular gap ${minPerp.toFixed(1)}px)`);

  // Short format: within a single calendar year there should be no year digits.
  const hasYear = boxes.some((b) => /\b20\d{2}\b/.test(b.text));
  assert(!hasYear, `${tag}: labels omit the year within a single year (e.g. "${boxes[0]?.text}")`);

  // Not clipped by the viewport edges (390px wide).
  const clipped = boxes.some((b) => b.left < 0 || b.right > 390);
  assert(!clipped, `${tag}: no label clipped at the 390px viewport edges`);
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await context.addCookies([
    { name: 'aaa-auth-token', value: jwt, domain: 'localhost', path: '/', httpOnly: false, secure: false },
    { name: 'sb-placeholder-auth-token', value: sessionCookie, domain: 'localhost', path: '/', httpOnly: false, secure: false },
  ]);

  const page = await context.newPage();
  await page.route('**/rest/v1/**', (r) => j(r, []));
  await page.route('**/auth/v1/**', (r) => j(r, user));
  await page.route('**/rest/v1/nutrition_targets**', (r) => j(r, targets));
  await page.route('**/rest/v1/users**', (r) => j(r, { id: user.id, height_cm: 180, age: 30, sex: 'male', goal: 'maintenance' }));
  await page.route('**/rest/v1/user_preferences**', (r) => j(r, { weight_unit: 'lb' }));
  await page.route('**/rest/v1/user_volume_profiles**', (r) => j(r, { training_age: 'intermediate', is_enhanced: false }));
  await page.route('**/rest/v1/weight_log**', (r) => j(r, weightSeries));
  await page.route('**/rest/v1/food_log**', (r) => {
    const req = r.request();
    const url = req.url();
    // Day view (Log tab) uses logged_at=eq.<date>; the trend graph uses gte.
    const m = url.match(/logged_at=eq\.([0-9-]+)/);
    if (m) return j(r, foodSeries.filter((f) => f.logged_at === m[1]));
    return j(r, foodSeries);
  });

  // ---- Insights tab: Nutrition Trends ----
  await page.goto(`${BASE}/dashboard/nutrition?tab=insights`, { waitUntil: 'domcontentloaded' });
  assert(!page.url().includes('/login'), 'not redirected to /login (auth bypass works)');
  await page.getByText('Nutrition Trends').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(800);

  for (const range of ['7D', '14D', '30D', '90D']) {
    await page.getByRole('button', { name: range, exact: true }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}trend-calories-${range}.png` });
    await checkAxis(page, `Calories ${range}`);

    // Target line label must render fully (present + inside the 390px width).
    const targetLabel = await page.$$eval('.recharts-reference-line text', (nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { text: (n.textContent || '').trim(), x: r.x, right: r.x + r.width };
      })
    );
    const tgt = targetLabel.find((t) => /Target/.test(t.text));
    assert(!!tgt, `Calories ${range}: Target line label present`);
    if (tgt) assert(tgt.x >= 0 && tgt.right <= 390, `Calories ${range}: Target label not clipped (x=${tgt.x.toFixed(0)}, right=${tgt.right.toFixed(0)})`);
  }

  // ---- Macros view (same component) ----
  await page.getByRole('button', { name: 'Macros', exact: true }).click();
  await page.waitForTimeout(400);
  for (const range of ['7D', '14D', '30D', '90D']) {
    await page.getByRole('button', { name: range, exact: true }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}trend-macros-${range}.png` });
    await checkAxis(page, `Macros ${range}`);
  }

  // ---- Weight sub-tab chart ----
  await page.goto(`${BASE}/dashboard/nutrition?tab=weight`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Weight Trend').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('.recharts-xAxis .recharts-cartesian-axis-tick-value').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}weight-chart.png` });
  await checkAxis(page, 'Weight');

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} assertions passed.`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
