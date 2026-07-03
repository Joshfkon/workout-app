/* Diagnostic: single-route Lighthouse run that dumps every LayoutShift trace
 * event (timestamp + impacted nodes) so the shift source can be identified. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.LH_BASE || 'http://localhost:3001';
// Leading slash is re-applied so Git Bash's MSYS path conversion (which
// turns "/dashboard" into "C:/Program Files/Git/dashboard") can't break it —
// pass LH_ROUTE without a leading slash.
const ROUTE = '/' + (process.env.LH_ROUTE || 'dashboard/mesocycle').replace(/^[/\\]+|^.*:.*?Git[/\\]/i, '');

const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth-state.json'), 'utf8'));
const cookieHeader = state.cookies
  .filter((c) => c.domain.includes('localhost'))
  .map((c) => `${c.name}=${c.value}`)
  .join('; ');

const chrome = await launch({
  chromePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  chromeFlags: ['--headless=new'],
});

// LH_THROTTLE=devtools applies REAL 4x CPU + slow-4G throttling and reports
// observed paints, vs the default 'simulate' (Lantern) which models them —
// Lantern folds all JS finishing before the observed LCP into the LCP graph,
// overestimating LCP on fast localhost + heavy-JS pages.
const throttlingMethod = process.env.LH_THROTTLE === 'devtools' ? 'devtools' : 'simulate';
const rr = await lighthouse(BASE + ROUTE, {
  port: chrome.port,
  output: 'json',
  onlyCategories: ['performance'],
  throttlingMethod,
  extraHeaders: cookieHeader ? { Cookie: cookieHeader } : undefined,
});
chrome.kill();

const a = rr.lhr.audits;
console.log('finalUrl:', rr.lhr.finalDisplayedUrl);
console.log('LCP:', Math.round(a['largest-contentful-paint'].numericValue), 'ms');
console.log('CLS:', +a['cumulative-layout-shift'].numericValue.toFixed(4));

// Pull raw LayoutShift events from the trace with timestamps
const trace = rr.artifacts?.Trace || rr.artifacts?.traces?.defaultPass;
const events = (trace?.traceEvents || []).filter((e) => e.name === 'LayoutShift' && e.args?.data);
const nav = (trace?.traceEvents || []).find((e) => e.name === 'navigationStart');
const t0 = nav?.ts ?? (events[0]?.ts ?? 0);
console.log('\nLayoutShift events:', events.length);
for (const e of events) {
  const d = e.args.data;
  if (!d.is_main_frame) continue;
  console.log('---');
  console.log('t+ms:', Math.round((e.ts - t0) / 1000), 'score:', +(d.score || 0).toFixed(4), 'hadRecentInput:', d.had_recent_input);
  for (const n of d.impacted_nodes || []) {
    console.log('  node', n.node_id, 'old_rect:', JSON.stringify(n.old_rect), '-> new_rect:', JSON.stringify(n.new_rect));
  }
}
fs.writeFileSync(path.join(__dirname, 'lh-results', 'mesocycle-cls-diag.json'), JSON.stringify(rr.lhr, null, 1));
console.log('DIAG DONE');
