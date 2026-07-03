/* Cleanup: resume the leftover in-progress ad-hoc workout via the resume
 * pill / quick page and discard it through the app's own Cancel Workout UI. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FLOW_BASE || 'http://localhost:3001';
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth-state.json'), 'utf8'));

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

await page.goto(BASE + '/dashboard/workout/quick', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const btn = page.getByRole('button', { name: /Continue workout|Start workout/ });
const label = await btn.textContent();
console.log('quick CTA:', label?.trim());
if (!/Continue/.test(label || '')) {
  console.log('No leftover in-progress workout to clean. DONE');
  await browser.close();
  process.exit(0);
}
await btn.click();
await page.waitForURL(/\/dashboard\/workout\/[0-9a-f-]{36}/, { timeout: 20000 });
await page.waitForTimeout(2000);

const moreBtn = page.getByLabel('More actions');
if (await moreBtn.isVisible().catch(() => false)) {
  await moreBtn.click();
  await page.getByRole('menuitem', { name: /Cancel workout/i }).click();
} else {
  await page.getByRole('button', { name: /Cancel Workout/i }).click();
}
await page.waitForTimeout(500);
await page.getByRole('button', { name: /^Cancel Workout$/i }).last().click();
await page.waitForURL(/\/dashboard\/log/, { timeout: 20000 });
console.log('discarded; now at', page.url());

// verify: quick page shows Start again (no in-progress leftover)
await page.goto(BASE + '/dashboard/workout/quick', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
console.log('quick CTA after cleanup:', (await page.getByRole('button', { name: /Continue workout|Start workout/ }).textContent())?.trim());
await browser.close();
console.log('CLEANUP DONE');
