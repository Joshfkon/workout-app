/* Log in through the real login page and refresh auth-state.json with the
 * fresh session cookies (the old static cookie's refresh token is single-use
 * and may be stale). Credentials come from .env.local TEST_USER_*. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FLOW_BASE || 'http://localhost:3001';
const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').trim().replace(/^=+/, '');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500); // hydration wipes early fills (known gotcha)
await page.getByLabel('Email').fill(get('TEST_USER_EMAIL'));
await page.getByLabel('Password').fill(get('TEST_USER_PASSWORD'));
await page.getByRole('button', { name: 'Sign In' }).click();
await page.waitForURL(/\/dashboard/, { timeout: 30000 });
console.log('logged in, at', page.url());

const cookies = (await context.cookies()).filter((c) => c.domain.includes('localhost'));
fs.writeFileSync(
  path.join(__dirname, 'auth-state.json'),
  JSON.stringify({ cookies: cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain })) }, null, 1)
);
console.log('auth-state.json refreshed with', cookies.length, 'cookie(s)');
await browser.close();
console.log('LOGIN REFRESH DONE');
