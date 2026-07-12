/**
 * Cold-start boot measurement against the production build (localhost:3000)
 * with the mock Supabase (localhost:54321).
 *
 * Simulates a mobile device: 4x CPU throttle + 40ms network RTT / 20Mbps via
 * CDP. Fresh browser context = cold cache (no sessionStorage, no IndexedDB).
 * Captures: boot performance marks, paint timings, per-request network
 * waterfall, and a screenshot filmstrip.
 *
 * Usage: node measure-boot.mjs [runLabel] [--warm]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const CHROME_DIR = fs.readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium') && fs.existsSync(`/opt/pw-browsers/${d}/chrome-linux/chrome`));
const CHROME = `/opt/pw-browsers/${CHROME_DIR}/chrome-linux/chrome`;
const BASE = 'http://localhost:3000';
const OUT = process.env.BOOT_SHOTS_DIR ?? new URL('./boot-shots/', import.meta.url).pathname;
const label = process.argv[2] ?? 'run';
const warm = process.argv.includes('--warm');

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function authCookies() {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'test-user-id', role: 'authenticated', exp })}.sig`;
  const user = { id: 'test-user-id', aud: 'authenticated', role: 'authenticated', email: 'test@test.com' };
  const session = { access_token: jwt, token_type: 'bearer', expires_in: 2592000, expires_at: exp, refresh_token: 'r', user };
  const sessionCookie = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  // Storage key for URL http://localhost:54321 is sb-localhost-auth-token.
  return [
    { name: 'sb-localhost-auth-token', value: sessionCookie, domain: 'localhost', path: '/', httpOnly: false, secure: false },
  ];
}

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  serviceWorkers: 'block',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
});
await context.addCookies(authCookies());
const page = await context.newPage();

// Device simulation: 4x CPU throttle, 40ms RTT, 20/10 Mbps.
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 40,
  downloadThroughput: (20 * 1024 * 1024) / 8,
  uploadThroughput: (10 * 1024 * 1024) / 8,
});

// Network waterfall relative to navigation start.
let navStartMs = null;
const requests = [];
page.on('request', (r) => {
  requests.push({ url: r.url(), method: r.method(), t0: Date.now(), t1: null, status: null });
});
page.on('requestfinished', async (r) => {
  const rec = requests.findLast((x) => x.url === r.url() && x.t1 === null);
  if (rec) {
    rec.t1 = Date.now();
    rec.status = (await r.response())?.status() ?? null;
  }
});
page.on('requestfailed', (r) => {
  const rec = requests.findLast((x) => x.url === r.url() && x.t1 === null);
  if (rec) { rec.t1 = Date.now(); rec.status = 'FAILED:' + (r.failure()?.errorText ?? ''); }
});

// Screenshot filmstrip via CDP screencast — frames carry real capture
// timestamps (interval page.screenshot() calls queue under CPU throttle and
// all resolve late, which lies about what was on screen when).
const tWall0 = Date.now();
let lastFrameSave = -1000;
cdp.on('Page.screencastFrame', (frame) => {
  cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  const t = Math.round(frame.metadata.timestamp * 1000 - tWall0);
  if (t - lastFrameSave < 350) return; // ~3 fps is enough for a filmstrip
  lastFrameSave = t;
  fs.writeFileSync(`${OUT}${label}-${String(Math.max(0, t)).padStart(5, '0')}.png`, Buffer.from(frame.data, 'base64'));
});
await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 390, maxHeight: 844, everyNthFrame: 1 });
const strip = { unref: () => {} };

const navPromise = page.goto(`${BASE}/`, { waitUntil: 'commit' });
navStartMs = Date.now();
await navPromise;

if (warm) {
  // Warm pass: let the first load fully finish (populates IDB + sessionStorage),
  // then reload the entry URL — same document lifecycle as reopening the app
  // with caches populated.
  await page.waitForFunction(() => (window.__BOOT_TRACE__ ?? []).some(([n]) => n === 'boot:home-paint'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__BOOT_TRACE__ = []; performance.clearMarks(); });
  requests.length = 0;
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  navStartMs = Date.now();
}

try {
  await page.waitForFunction(
    () => (window.__BOOT_TRACE__ ?? []).some(([n]) => n === 'boot:home-paint'),
    null,
    { timeout: 30000 }
  );
} catch (e) {
  console.log('TIMEOUT waiting for boot:home-paint — dumping what we have');
}
await cdp.send('Page.stopScreencast').catch(() => {}); void strip;
await page.screenshot({ path: `${OUT}${label}-final.png` });

const data = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paints = performance.getEntriesByType('paint').map((p) => ({ name: p.name, t: Math.round(p.startTime) }));
  return {
    url: location.href,
    marks: window.__BOOT_TRACE__ ?? [],
    paints,
    nav: nav && {
      redirectCount: nav.redirectCount,
      ttfb: Math.round(nav.responseStart),
      responseEnd: Math.round(nav.responseEnd),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
    },
    resources: performance
      .getEntriesByType('resource')
      .filter((r) => r.name.includes('54321') || r.name.includes('/_next/static/chunks/'))
      .map((r) => ({
        name: r.name.replace('http://localhost:3000', '').replace('http://localhost:54321', 'SUPA'),
        start: Math.round(r.startTime),
        end: Math.round(r.responseEnd),
        size: r.transferSize,
      }))
      .sort((a, b) => a.start - b.start),
  };
});

console.log(JSON.stringify({ label, warm, finalUrl: data.url, nav: data.nav, paints: data.paints, marks: data.marks }, null, 2));
console.log('\n--- network waterfall (ms from nav start) ---');
for (const r of data.resources) {
  const bar = ' '.repeat(Math.round(r.start / 50)) + '#'.repeat(Math.max(1, Math.round((r.end - r.start) / 50)));
  console.log(String(r.start).padStart(6) + '-' + String(r.end).padEnd(6) + ' ' + bar.slice(0, 80).padEnd(80) + ' ' + r.name.slice(0, 90));
}
console.log('\n--- doc-level requests (wall clock, ms from nav) ---');
for (const r of requests.filter((x) => !x.url.includes('/_next/static') && !x.url.includes('.png') && !x.url.includes('.svg'))) {
  console.log(
    String(r.t0 - navStartMs).padStart(6) + '-' + String((r.t1 ?? Date.now()) - navStartMs).padEnd(6) +
    ` [${r.status}] ${r.method} ` + r.url.replace('http://localhost:3000', '').replace('http://localhost:54321', 'SUPA').slice(0, 110)
  );
}

await browser.close();
