/* Crown-jewels flow regression against the production build (:3001).
 * Mirrors ux-audit/fixes/final-regression: quick-confirm, 1-tap logging,
 * sticky timer, undo toast, sync glyph, minimize/resume pill, persistence,
 * reload recovery, in-app discard. Mobile viewport 390x844, system Chrome. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FLOW_BASE || 'http://localhost:3001';
const OUT = path.join(__dirname, 'fixes', 'final-regression-2');
fs.mkdirSync(OUT, { recursive: true });

const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth-state.json'), 'utf8'));
const results = [];
const pass = (name) => { results.push(`${name}: PASS`); console.log(`${name}: PASS`); };
const fail = (name, why) => { results.push(`${name}: FAIL (${why})`); console.log(`${name}: FAIL (${why})`); };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  storageState: {
    cookies: state.cookies.map((c) => ({
      name: c.name, value: c.value, domain: 'localhost', path: '/',
      expires: -1, httpOnly: false, secure: false, sameSite: 'Lax',
    })),
    origins: [],
  },
});
const page = await context.newPage();

try {
  // A. quick page shows confirm, no auto-create
  await page.goto(BASE + '/dashboard/workout/quick', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const startBtn = page.getByRole('button', { name: /Start workout|Continue workout/ });
  if (page.url().includes('/workout/quick') && await startBtn.isVisible()) {
    pass('quick page shows confirm (no auto-create)');
  } else {
    fail('quick page shows confirm (no auto-create)', `url=${page.url()}`);
  }

  // B. start -> workout page
  await startBtn.click();
  await page.waitForURL(/\/dashboard\/workout\/[0-9a-f-]{36}/, { timeout: 20000 });
  const workoutUrl = page.url();
  await page.waitForTimeout(1500);

  // C. add an exercise if the workout is empty
  const logSetVisible = await page.getByRole('button', { name: 'Log set' }).isVisible().catch(() => false);
  if (!logSetVisible) {
    await page.getByRole('button', { name: /^Add$|Add Exercise/ }).first().click();
    const search = page.getByPlaceholder('Search exercises...');
    await search.waitFor({ timeout: 10000 });
    await search.fill('curl');
    await page.waitForTimeout(1200);
    // First exercise row under the list (buttons with muscle subtitle)
    await page.locator('button:has-text("curl"), button:has-text("Curl")').first().click();
    await page.getByRole('button', { name: /^Add \(1\)$/ }).click();
    await page.waitForTimeout(2500);
  }

  // D. one-tap logging
  const logBtn = page.getByRole('button', { name: 'Log set' });
  await logBtn.waitFor({ timeout: 15000 });
  const setRowsBefore = await page.locator('text=/^Set \\d+ ·/').count();
  await logBtn.click(); // THE one tap
  await page.waitForTimeout(2000);
  const setRowsAfter = await page.locator('text=/^Set \\d+ ·/').count();
  if (setRowsAfter === setRowsBefore + 1) pass('1-tap set logging');
  else fail('1-tap set logging', `rows ${setRowsBefore} -> ${setRowsAfter}`);

  // E. undo toast
  if (await page.getByText('Undo', { exact: false }).first().isVisible().catch(() => false)) {
    pass('undo toast');
  } else fail('undo toast', 'not visible after log');

  // F. sticky rest timer (fixed bar with Skip / +15s)
  const skipBtn = page.getByRole('button', { name: 'Skip' });
  if (await skipBtn.isVisible().catch(() => false)) {
    const isFixed = await skipBtn.evaluate((el) => {
      for (let n = el; n; n = n.parentElement) {
        if (getComputedStyle(n).position === 'fixed') return true;
      }
      return false;
    });
    if (isFixed) pass('sticky rest timer visible (fixed)');
    else fail('sticky rest timer visible (fixed)', 'not position:fixed');
  } else fail('sticky rest timer visible (fixed)', 'Skip button not visible');

  // G. sync glyph: set row shows saved state (no "queued" while online)
  const queued = await page.locator('text=queued').count();
  if (queued === 0) pass('saved glyph (no queued state online)');
  else fail('saved glyph (no queued state online)', `${queued} queued`);
  await page.screenshot({ path: path.join(OUT, 'logger-after-1tap.png') });

  // H. minimize -> resume pill on another tab
  await page.getByLabel('Minimize workout').click();
  await page.waitForURL(/\/dashboard\/log/, { timeout: 15000 });
  await page.goto(BASE + '/dashboard/nutrition', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const pill = page.getByLabel('Resume workout');
  if (await pill.isVisible().catch(() => false)) pass('resume pill on nutrition');
  else fail('resume pill on nutrition', 'pill not visible');
  await page.screenshot({ path: path.join(OUT, 'nutrition-resume-pill.png') });

  // I. nutrition quick-add present (untouched code, presence check).
  // domcontentloaded fires before the client fetch paints — poll up to 12s.
  const nutritionOk = await page
    .waitForFunction(() => /add|log|food|meal/i.test(document.querySelector('main')?.textContent || ''), null, { timeout: 12000 })
    .then(() => true).catch(() => false);
  if (nutritionOk) pass('nutrition quick-add surface present');
  else fail('nutrition quick-add surface present', 'no add/log affordance text after 12s');

  // J. resume restores state
  await pill.click();
  await page.waitForURL(/\/dashboard\/workout\/[0-9a-f-]{36}/, { timeout: 15000 });
  await page.waitForTimeout(2000);
  if ((await page.locator('text=/^Set \\d+ ·/').count()) >= 1) pass('resume restores set');
  else fail('resume restores set', 'set row missing');

  // K. reload recovery (per-set persistence)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  if ((await page.locator('text=/^Set \\d+ ·/').count()) >= 1) pass('reload keeps set (per-set persistence)');
  else fail('reload keeps set (per-set persistence)', 'set row missing after reload');

  // L. in-app discard (cleanup through the app's own UI)
  const moreBtn = page.getByLabel('More actions');
  if (await moreBtn.isVisible().catch(() => false)) {
    await moreBtn.click();
    await page.getByRole('menuitem', { name: /Cancel workout/i }).click();
  } else {
    await page.getByRole('button', { name: /Cancel Workout/i }).click();
  }
  // confirm inside modal (heading "Cancel Workout?")
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^Cancel Workout$|Cancelling/i }).last().click();
  await page.waitForURL(/\/dashboard\/log/, { timeout: 20000 }).catch(() => {});
  if (!page.url().includes('/workout/')) pass('in-app discard');
  else fail('in-app discard', `still on ${page.url()}`);

  // M. Home hero card evidence (task-3 copy fix regression)
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const hero = await page.locator('main').textContent().catch(() => '');
  if (/0 exercises · 0\/0 sets/.test(hero || '')) fail('home hero copy', 'still shows 0 exercises · 0/0 sets');
  else pass('home hero copy (no "0 exercises · 0/0 sets")');
  await page.screenshot({ path: path.join(OUT, 'home-hero.png') });

  console.log('WORKOUT URL WAS:', workoutUrl);
} catch (e) {
  fail('flow aborted', String(e).slice(0, 300));
  await page.screenshot({ path: path.join(OUT, 'failure-state.png') }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, 'verification-log.txt'), results.join('\n') + '\n');
  await browser.close();
}
console.log('FLOW DONE');
