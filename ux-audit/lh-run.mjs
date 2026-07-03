/* Lighthouse mobile-throttled runs across routes, with auth cookies from Playwright state */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.LH_BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'lh-results');
fs.mkdirSync(OUT, { recursive: true });

const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth-state.json'), 'utf8'));
const cookieHeader = state.cookies
  .filter((c) => c.domain.includes('localhost'))
  .map((c) => `${c.name}=${c.value}`)
  .join('; ');

const ROUTES = [
  '/', '/login', '/dashboard', '/dashboard/log', '/dashboard/workout/new',
  '/dashboard/nutrition', '/dashboard/analytics', '/dashboard/history',
  '/dashboard/mesocycle', '/dashboard/settings',
];

const results = [];
const chrome = await launch({
  chromePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  chromeFlags: ['--headless=new'],
});

for (const route of ROUTES) {
  const slug = route === '/' ? 'landing' : route.replace(/^\//, '').replace(/\//g, '_');
  try {
    const rr = await lighthouse(BASE + route, {
      port: chrome.port,
      output: 'json',
      onlyCategories: ['performance'],
      extraHeaders: cookieHeader ? { Cookie: cookieHeader } : undefined,
      // default config = mobile emulation + simulated 4x CPU / slow 4G throttling
    });
    const a = rr.lhr.audits;
    const row = {
      route,
      score: Math.round((rr.lhr.categories.performance.score || 0) * 100),
      FCP_ms: Math.round(a['first-contentful-paint'].numericValue),
      LCP_ms: Math.round(a['largest-contentful-paint'].numericValue),
      TBT_ms: Math.round(a['total-blocking-time'].numericValue),
      CLS: +a['cumulative-layout-shift'].numericValue.toFixed(3),
      SI_ms: Math.round(a['speed-index'].numericValue),
      TTI_ms: Math.round(a['interactive']?.numericValue ?? 0),
      transferKB: Math.round((a['total-byte-weight']?.numericValue ?? 0) / 1024),
      scriptKB: Math.round(
        (a['network-requests']?.details?.items ?? [])
          .filter((i) => i.resourceType === 'Script')
          .reduce((s, i) => s + (i.transferSize || 0), 0) / 1024
      ),
      finalUrl: rr.lhr.finalDisplayedUrl,
    };
    results.push(row);
    fs.writeFileSync(path.join(OUT, slug + '.json'), JSON.stringify(rr.lhr, null, 1));
    console.log(JSON.stringify(row));
  } catch (e) {
    results.push({ route, error: String(e).slice(0, 200) });
    console.log('ERR', route, String(e).slice(0, 200));
  }
}
chrome.kill();
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 2));
console.log('LH DONE');
