/**
 * muscle-hierarchy.mjs — drives the REAL app on :3000 to verify the unified
 * muscle hierarchy (shared MuscleGroupList) on the volume page, the analytics
 * Muscle Recovery card and the in-workout readiness sheet.
 *
 * Modeled on ux-audit/verify/lib.mjs (forged local-only session cookie that
 * passes the middleware's network-free fast path + intercepted Supabase
 * routes — NO real credentials anywhere), but launches via channel:'chrome'
 * so it runs on this Windows machine.
 *
 * Fixture: side delts maxed 6h ago (Fatigued), front/rear delts light 5 days
 * ago (Fresh) → Shoulders parent must read Fatigued (least-recovered member),
 * auto-expand its members on the recovery card, and count once in the
 * "X of Y ready" headline.
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const OUT = './ux-audit/verify/screens/';

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// Derive the @supabase/ssr cookie name from the PUBLIC url (not a secret).
const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
const urlMatch = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m);
const ref = urlMatch ? new URL(urlMatch[1].trim()).hostname.split('.')[0] : 'localhost';

function authCookies() {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'test-user-id', role: 'authenticated', exp })}.sig`;
  const user = { id: 'test-user-id', aud: 'authenticated', role: 'authenticated', email: 'test@test.com' };
  const session = { access_token: jwt, token_type: 'bearer', expires_in: 2592000, expires_at: exp, refresh_token: 'r', user };
  const sessionCookie = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  const mk = (name) => ({ name, value: sessionCookie, domain: 'localhost', path: '/', httpOnly: false, secure: false });
  return { user, cookies: [mk(`sb-${ref}-auth-token`), mk('sb-localhost-auth-token')] };
}

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

// --- Fixture: the shoulders divergence week --------------------------------
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const sets = (prefix, n, rir, rpe) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, is_warmup: false, rpe, feedback: { repsInTank: rir } }));

const BLOCKS = [
  {
    id: 'blk-side',
    exercises: { id: 'ex-lr', name: 'Lateral Raise', primary_muscle: 'lateral_delts', secondary_muscles: [] },
    workout_sessions: { id: 's-side', completed_at: hoursAgo(6), user_id: 'test-user-id', state: 'completed' },
    set_logs: sets('lr', 8, 0, 10),
  },
  {
    id: 'blk-front',
    exercises: { id: 'ex-fr', name: 'Front Raise', primary_muscle: 'front_delts', secondary_muscles: [] },
    workout_sessions: { id: 's-front', completed_at: hoursAgo(120), user_id: 'test-user-id', state: 'completed' },
    set_logs: sets('fr', 4, 2, 8),
  },
  {
    id: 'blk-rear',
    exercises: { id: 'ex-rf', name: 'Reverse Fly', primary_muscle: 'rear_delts', secondary_muscles: [] },
    workout_sessions: { id: 's-rear', completed_at: hoursAgo(120), user_id: 'test-user-id', state: 'completed' },
    set_logs: sets('rf', 4, 2, 8),
  },
];

const results = [];
const assert = (cond, msg) => { results.push(!!cond); console.log((cond ? 'PASS: ' : 'FAIL: ') + msg); };

async function newPage(context) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.route('**/rest/v1/**', (r) => json(r, []));
  await page.route('**/auth/v1/**', (r) => json(r, authCookies().user));
  await page.route('**/rest/v1/exercise_blocks**', (r) => json(r, BLOCKS));
  return page;
}

const text = (page, testid) => page.getByTestId(testid).first().innerText({ timeout: 15000 });
const visible = (page, testid) => page.getByTestId(testid).first().isVisible().catch(() => false);

async function main() {
  const { cookies } = authCookies();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await context.addCookies(cookies);
  let page = await newPage(context);

  // ===== 1. Analytics (Wellness tab) — Muscle Recovery card =================
  await page.goto(`${BASE}/dashboard/analytics?tab=wellness`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByTestId('muscle-recovery-card').waitFor({ state: 'visible', timeout: 60000 });

  assert((await text(page, 'muscle-recovery-headline')).includes('12 of 13 ready'),
    'headline counts coarse groups only: "12 of 13 ready" (shoulders once)');
  assert((await text(page, 'recovery-status-shoulders')).includes('Fatigued'),
    'Shoulders parent = least-recovered member (Fatigued, never Fresh)');

  // Divergent members self-reveal without any tap, each with its OWN status.
  assert((await text(page, 'recovery-status-lateral_delts')).includes('Fatigued'), 'auto-expanded: Side Delts show own Fatigued');
  assert((await text(page, 'recovery-status-front_delts')).includes('Fresh'), 'auto-expanded: Front Delts show own Fresh');
  assert((await text(page, 'recovery-status-rear_delts')).includes('Fresh'), 'auto-expanded: Rear Delts show own Fresh');

  await page.screenshot({ path: path.join(OUT, 'recovery-card-autoexpand.png') });

  // Explicit collapse overrides auto-expand and persists across a reload.
  await page.getByTestId('recovery-row-toggle-shoulders').click();
  assert(!(await visible(page, 'recovery-status-lateral_delts')), 'user collapse overrides the divergence default');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('muscle-recovery-card').waitFor({ state: 'visible', timeout: 90000 });
  assert(!(await visible(page, 'recovery-status-lateral_delts')), 'collapse persists across reload (app restart)');

  // Re-expand → persists too.
  await page.getByTestId('recovery-row-toggle-shoulders').click();
  await page.getByTestId('recovery-status-lateral_delts').waitFor({ state: 'visible', timeout: 10000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('muscle-recovery-card').waitFor({ state: 'visible', timeout: 90000 });
  assert(await visible(page, 'recovery-status-lateral_delts'), 're-expand persists across reload');
  await page.screenshot({ path: path.join(OUT, 'recovery-card-expanded-reload.png') });

  // ===== 2. Volume page — same hierarchy, separate surface persistence ======
  await page.goto(`${BASE}/dashboard/volume`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByTestId('volume-row-shoulders').waitFor({ state: 'visible', timeout: 60000 });

  const coarseCount = await page.$$eval('[data-testid^="volume-row-"]', (els) =>
    els.filter((el) => !/toggle/.test(el.getAttribute('data-testid'))).length);
  assert(coarseCount >= 13, `full coarse universe renders (${coarseCount} rows incl. never-trained)`);

  // Recovery-card expansion must NOT leak into the volume surface.
  assert(!(await visible(page, 'volume-sets-lateral_delts')), 'expansion state is per-surface (volume starts collapsed)');

  await page.getByTestId('volume-row-toggle-shoulders').click();
  await page.getByTestId('volume-sets-lateral_delts').waitFor({ state: 'visible', timeout: 10000 });
  assert(await visible(page, 'volume-sets-front_delts'), 'chevron expands all fine children on the volume page');
  await page.screenshot({ path: path.join(OUT, 'volume-page-expanded.png') });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('volume-row-shoulders').waitFor({ state: 'visible', timeout: 60000 });
  assert(await visible(page, 'volume-sets-lateral_delts'), 'volume expansion persists across reload');

  // ===== 3. In-workout readiness sheet ======================================
  // NOT driven here: the workout page's session-load contract needs richer
  // fixtures than this spec mocks (see readiness-sheet.mjs, which has drifted
  // for the same reason). The sheet's hierarchy is covered headlessly by
  // components/workout/__tests__/MuscleReadinessSheet.test.tsx (real data hook,
  // shared MuscleGroupList) plus the import-assertion + row-parity Jest tests,
  // which guarantee it renders the same component over the same rows verified
  // on the two surfaces above.

  await browser.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
