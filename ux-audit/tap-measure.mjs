/* Re-measure the P0-4 tap-target table on the production build (390px).
 * Creates a quick workout + one exercise via the app UI, measures the DOM
 * bounding boxes, logs one set (taps-to-log check), measures timer buttons,
 * then discards the workout in-app. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FLOW_BASE || 'http://localhost:3001';
const OUT = path.join(__dirname, 'fixes', 'final-regression-2');
fs.mkdirSync(OUT, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth-state.json'), 'utf8'));

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

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

async function measure(label, locator) {
  try {
    const box = await locator.boundingBox({ timeout: 8000 });
    if (!box) { log(`${label.padEnd(22)} NOT FOUND`); return; }
    const w = Math.round(box.width), h = Math.round(box.height);
    const ok = (w >= 44 && h >= 44) || (label === 'Log set' && h >= 44);
    log(`${label.padEnd(22)} ${w}x${h}  ${ok ? 'PASS' : 'FAIL'}`);
  } catch { log(`${label.padEnd(22)} NOT FOUND`); }
}

try {
  await page.goto(BASE + '/dashboard/workout/quick', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Start workout|Continue workout/ }).click();
  await page.waitForURL(/\/dashboard\/workout\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.waitForTimeout(1500);

  if (!(await page.getByRole('button', { name: 'Log set' }).isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /^Add$|Add Exercise/ }).first().click();
    const search = page.getByPlaceholder('Search exercises...');
    await search.waitFor({ timeout: 10000 });
    await search.fill('curl');
    await page.waitForTimeout(1200);
    await page.locator('button:has-text("curl"), button:has-text("Curl")').first().click();
    await page.getByRole('button', { name: /^Add \(1\)$/ }).click();
    await page.waitForTimeout(2500);
  }
  await page.getByRole('button', { name: 'Log set' }).waitFor({ timeout: 15000 });

  log('=== Set-logger controls (390px viewport, production build) ===');
  await measure('RIR chip 3 (easy)', page.getByLabel(/3 reps in reserve/));
  await measure('RIR chip 2 (good)', page.getByLabel(/2 reps in reserve/));
  await measure('RIR chip 1 (hard)', page.getByLabel(/1 reps in reserve/));
  await measure('RIR chip 0 (maxed)', page.getByLabel(/0 reps in reserve/));
  await measure('Weight - stepper', page.getByLabel('Decrease weight'));
  await measure('Weight + stepper', page.getByLabel('Increase weight'));
  await measure('Reps - stepper', page.getByLabel(/Decrease (reps|seconds)/));
  await measure('Reps + stepper', page.getByLabel(/Increase (reps|seconds)/));
  await measure('Log set', page.getByRole('button', { name: 'Log set' }));
  await measure('Set feedback', page.getByLabel('Add set feedback'));
  await measure('Finish (header)', page.getByRole('button', { name: 'Finish' }).first());
  await measure('Overflow ⋮ (header)', page.getByLabel('More actions'));

  // taps-to-log: exactly one tap
  const before = await page.locator('text=/^Set \\d+ ·/').count();
  await page.getByRole('button', { name: 'Log set' }).click();
  await page.waitForTimeout(2000);
  const after = await page.locator('text=/^Set \\d+ ·/').count();
  log(`Taps to log with accepted suggestion: 1 (rows ${before} -> ${after}) ${after === before + 1 ? 'PASS' : 'FAIL'}`);

  log('=== Rest timer controls ===');
  await measure('+15s (timer)', page.getByRole('button', { name: '+15s' }));
  await measure('Skip (timer)', page.getByRole('button', { name: 'Skip' }));
  await page.screenshot({ path: path.join(OUT, 'tap-measure-logger.png') });

  // cleanup via in-app cancel
  const moreBtn = page.getByLabel('More actions');
  if (await moreBtn.isVisible().catch(() => false)) {
    await moreBtn.click();
    await page.getByRole('menuitem', { name: /Cancel workout/i }).click();
  } else {
    await page.getByRole('button', { name: /Cancel Workout/i }).click();
  }
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^Cancel Workout$/i }).last().click();
  await page.waitForURL(/\/dashboard\/log/, { timeout: 20000 }).catch(() => {});
  log(`Cleanup: session discarded in-app (now at ${page.url()})`);
} catch (e) {
  log('ABORTED: ' + String(e).slice(0, 200));
} finally {
  fs.writeFileSync(path.join(OUT, 'tap-target-table.txt'), lines.join('\n') + '\n');
  await browser.close();
}
console.log('TAP MEASURE DONE');
