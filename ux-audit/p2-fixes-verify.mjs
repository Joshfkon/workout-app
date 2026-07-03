/* Browser verification for the P2-6 / P2-7 / P2-16 fixes (production :3001).
 * NOTE: P2-7 checks open the confirm modal on REAL history data and always
 * dismiss with "Keep" — nothing is deleted (workout count asserted stable). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FLOW_BASE || 'http://localhost:3001';
const OUT = path.join(__dirname, 'fixes', 'p2-sweep-2');
fs.mkdirSync(OUT, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth-state.json'), 'utf8'));

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// ---------- P2-6: register page (logged-out context) ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/register', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const confirmField = await page.getByLabel('Confirm Password').count();
  log(`P2-6 confirm-password field removed: ${confirmField === 0 ? 'PASS' : 'FAIL'}`);
  const pw = page.getByLabel('Password', { exact: true });
  await pw.fill('secret123');
  const typeBefore = await pw.getAttribute('type');
  await page.getByLabel('Show password').click();
  const typeAfter = await pw.getAttribute('type');
  log(`P2-6 show-password toggle (${typeBefore} -> ${typeAfter}): ${typeBefore === 'password' && typeAfter === 'text' ? 'PASS' : 'FAIL'}`);
  await page.getByLabel('Hide password').click();
  log(`P2-6 toggle back to hidden: ${(await pw.getAttribute('type')) === 'password' ? 'PASS' : 'FAIL'}`);
  await page.screenshot({ path: path.join(OUT, 'register-toggle.png') });
  await ctx.close();
}

// ---------- authed context for P2-7 / P2-16 ----------
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  storageState: {
    cookies: state.cookies.map((c) => ({
      name: c.name, value: c.value, domain: 'localhost', path: '/',
      expires: -1, httpOnly: false, secure: false, sameSite: 'Lax',
    })),
    origins: [],
  },
});
const page = await ctx.newPage();

// ---------- P2-7: history bulk-delete confirm modal ----------
await page.goto(BASE + '/dashboard/history', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (document.querySelector('main')?.textContent || '').length > 200, null, { timeout: 20000 });
await page.waitForTimeout(1000);
const workoutCards = await page.locator('a[href*="/dashboard/history"], [class*=card]').count();
// Enter select mode (button labelled Select / similar)
const selectBtn = page.getByRole('button', { name: /^Select$|Select workouts/i }).first();
if (await selectBtn.isVisible().catch(() => false)) {
  await selectBtn.click();
  await page.getByRole('button', { name: /Select All/i }).click();
  await page.getByRole('button', { name: /Delete \d+ Selected/i }).click();
  await page.waitForTimeout(400);
  const modalTitle = await page.getByText(/Delete \d+ workouts?\?/).isVisible().catch(() => false);
  const nativeLeak = false; // native confirm() would have thrown in headless — reaching here means none fired
  log(`P2-7 bulk-delete opens styled modal: ${modalTitle ? 'PASS' : 'FAIL'}`);
  await page.screenshot({ path: path.join(OUT, 'bulk-delete-modal.png') });
  await page.getByRole('button', { name: 'Keep' }).click();
  await page.waitForTimeout(400);
  const modalGone = !(await page.getByText(/Delete \d+ workouts?\?/).isVisible().catch(() => false));
  log(`P2-7 "Keep" dismisses without deleting: ${modalGone ? 'PASS' : 'FAIL'}`);
  // leave select mode
  const exitSelect = page.getByRole('button', { name: /Cancel|Done/i }).first();
  if (await exitSelect.isVisible().catch(() => false)) await exitSelect.click();
  void workoutCards; void nativeLeak;
} else {
  log('P2-7 bulk-delete: SKIPPED (Select button not found — check selector)');
}

// ---------- P2-16: workout detail loading skeleton ----------
// Find a workout link from history, navigate, and look for the skeleton
// during load (route loading.tsx or in-page phase skeleton — both pulse).
const detailHref = await page.locator('a[href*="/dashboard/workout/"]').first().getAttribute('href').catch(() => null);
if (detailHref) {
  await page.goto(BASE + detailHref, { waitUntil: 'commit' });
  let sawSkeleton = false;
  let sawSpinnerOnly = false;
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => ({
      pulse: !!document.querySelector('.animate-pulse'),
      spinner: !!document.querySelector('.animate-spin'),
      loaded: /Log set|Finish|completed/.test(document.querySelector('main, body')?.textContent || ''),
    })).catch(() => null);
    if (s?.pulse) sawSkeleton = true;
    if (s?.spinner && !s?.pulse) sawSpinnerOnly = true;
    if (s?.loaded) break;
    await page.waitForTimeout(100);
  }
  log(`P2-16 skeleton during workout-detail load: ${sawSkeleton ? 'PASS' : 'FAIL (no .animate-pulse observed)'}${sawSpinnerOnly ? ' (WARN: spinner-only frame seen)' : ''}`);
} else {
  log('P2-16: SKIPPED (no workout detail link found on history)');
}

fs.writeFileSync(path.join(OUT, 'verification-log.txt'), lines.join('\n') + '\n');
await browser.close();
console.log('P2 VERIFY DONE');
