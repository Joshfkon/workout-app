/* Does the dashboard's LCP content paint WITHOUT JavaScript?
 * If yes -> hydration isn't required for the paint, and Render Delay must
 * come from something JS does (hide/replace). If no -> the SSR/streamed HTML
 * itself doesn't render the card and server output is the problem. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FLOW_BASE || 'http://localhost:3001';
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth-state.json'), 'utf8'));

const browser = await chromium.launch({ channel: 'chrome', headless: true });

for (const js of [false, true]) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    javaScriptEnabled: js,
    storageState: {
      cookies: state.cookies.map((c) => ({
        name: c.name, value: c.value, domain: 'localhost', path: '/',
        expires: -1, httpOnly: false, secure: false, sameSite: 'Lax',
      })),
      origins: [],
    },
  });
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(js ? 4000 : 2500);
  const info = await page.evaluate(() => {
    const main = document.querySelector('main');
    const text = (main?.textContent || '').slice(0, 400);
    // find candidate LCP-ish elements and their visibility
    const vis = [];
    for (const el of main ? main.querySelectorAll('p, h1, h2, div') : []) {
      const t = (el.textContent || '').trim();
      if (t.length > 40 && el.children.length === 0) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        vis.push({ text: t.slice(0, 60), top: Math.round(r.top), visible: r.width > 0 && cs.opacity !== '0' && cs.visibility !== 'hidden' });
        if (vis.length >= 4) break;
      }
    }
    return { textLen: (main?.textContent || '').length, sample: text.slice(0, 150), vis };
  });
  console.log(`=== JS ${js ? 'ENABLED' : 'DISABLED'} (t=${Date.now() - t0}ms)`);
  console.log('main text length:', info.textLen);
  console.log('sample:', JSON.stringify(info.sample));
  info.vis.forEach(v => console.log('  el:', JSON.stringify(v)));
  await page.screenshot({ path: path.join(__dirname, 'fixes', `nojs-${js ? 'on' : 'off'}.png`) });
  await context.close();
}
await browser.close();
console.log('NOJS TEST DONE');
