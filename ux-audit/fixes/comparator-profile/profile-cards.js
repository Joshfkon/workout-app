/* React Profiler: 6-exercise workout. Measures active-card + sibling-card
   re-renders for typing 5 chars / logging a set / scrolling. Reports distinct
   card ids so "did a sibling re-render?" is answerable. Label via argv[2]. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
const LABEL = process.argv[2] || 'run';
const OUTDIR = 'C:/Users/joshu/Desktop/Dec WorkoutApp/ux-audit/fixes/comparator-profile';
const STATE = path.join(__dirname, 'auth-state.json');

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const events = [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: STATE });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[prof]') || t.startsWith('[mark]')) events.push(t);
  });

  await page.goto(BASE + '/dashboard/workout/quick', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.locator('button', { hasText: /Start workout|Continue workout/ }).first().click({ timeout: 90000 });
  await page.waitForURL(/workout\/[0-9a-f-]{36}/, { timeout: 90000 });
  const sessionId = page.url().match(/workout\/([0-9a-f-]{36})/)[1];
  const add = page.locator('button', { hasText: /^\+?\s*Add$/ }).first();
  await add.waitFor({ state: 'visible', timeout: 120000 });
  await add.click();
  const search = page.locator('input[placeholder*="Search exercises"]').first();
  await search.waitFor({ state: 'visible', timeout: 15000 });
  await search.fill('press');
  await page.waitForTimeout(1200);
  const rows = page.locator('button, [role=button]').filter({ hasText: /Press/i });
  const n = Math.min(6, await rows.count());
  for (let i = 0; i < n; i++) { await rows.nth(i).click(); await page.waitForTimeout(150); }
  await page.locator('button', { hasText: /Add \(\d+\)/ }).first().click();
  const logSet = page.locator('button', { hasText: /^Log set$/ }).first();
  await logSet.waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(2500);

  // Log ONE set on exercise 1 (accept suggestion) so its card stays mounted,
  // then make exercise 2 current by tapping its "Up next" row. Result: two
  // mounted ExerciseCards (completed ex1 + active ex2) with minimal modal risk.
  await logSet.click();
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape').catch(() => {}); // dismiss any sanity toast
  await page.waitForTimeout(400);
  // Scroll down to the Up-next list and activate the next exercise
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(500);
  const upNext = page.locator('text=/Up next|up next/i');
  if (await upNext.first().isVisible().catch(() => false)) {
    // click the first up-next exercise row to make it current
    const nextRow = page.locator('[data-block-index]').last();
    await nextRow.click().catch(() => {});
    await page.waitForTimeout(1500);
  }
  await page.mouse.wheel(0, -3000);
  await page.waitForTimeout(1000);
  await page.evaluate(() => console.log('[mark] mounted'));
  await page.waitForTimeout(500);

  const activeLogSet = () => page.locator('button', { hasText: /^Log set$/ }).first();

  // typing 5 chars into the active card's weight value
  await page.evaluate(() => console.log('[mark] typing-start'));
  const wBtn = page.locator('button[aria-label^="Weight:"]').first();
  await wBtn.waitFor({ state: 'visible', timeout: 20000 });
  await wBtn.click();
  const input = page.locator('input[aria-label="Weight"]').first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.pressSequentially('185', { delay: 120 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.evaluate(() => console.log('[mark] typing-end'));
  await page.waitForTimeout(400);

  // log a set
  await page.evaluate(() => console.log('[mark] logset-start'));
  await activeLogSet().click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => console.log('[mark] logset-end'));

  // idle 6s — captures the setSync reconcile poll (every 5s). A regression
  // would show cards re-rendering here with nothing happening.
  await page.evaluate(() => console.log('[mark] idle-start'));
  await page.waitForTimeout(6000);
  await page.evaluate(() => console.log('[mark] idle-end'));

  // scroll
  await page.evaluate(() => console.log('[mark] scroll-start'));
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(150); }
  await page.mouse.wheel(0, -3000);
  await page.waitForTimeout(500);
  await page.evaluate(() => console.log('[mark] scroll-end'));

  fs.writeFileSync(path.join(OUTDIR, `${LABEL}.raw.json`), JSON.stringify(events, null, 1));

  // ---- summarize ----
  const mounts = new Set();
  events.forEach(e => { if (e.startsWith('[prof]') && e.includes(' mount ')) mounts.add(e.split(' ')[1]); });
  const sections = {}; let cur = null;
  for (const e of events) {
    if (e.startsWith('[mark] ')) {
      const m = e.slice(7);
      if (m.endsWith('-start')) { cur = m.replace('-start', ''); sections[cur] = []; }
      else cur = null;
    } else if (cur) sections[cur].push(e);
  }
  const summary = { label: LABEL, cardsMounted: mounts.size, mountedIds: [...mounts].sort(), interactions: {} };
  console.log(`${LABEL}: ${mounts.size} ExerciseCards mounted (${[...mounts].sort().join(',')})`);
  for (const [name, lines] of Object.entries(sections)) {
    const ms = lines.reduce((s, l) => s + parseFloat(l.split(' ').pop()), 0);
    const perCard = {};
    lines.forEach(l => { const id = l.split(' ')[1]; perCard[id] = (perCard[id] || 0) + 1; });
    const siblings = Object.keys(perCard).filter(id => id !== 'card-0');
    summary.interactions[name] = { totalRenders: lines.length, totalMs: +ms.toFixed(1), perCard, siblingCardsReRendered: siblings };
    console.log(`  ${name}: ${lines.length} renders, ${ms.toFixed(1)}ms | per-card ${JSON.stringify(perCard)} | siblings re-rendered: ${siblings.length ? siblings.join(',') : 'NONE'}`);
  }
  fs.writeFileSync(path.join(OUTDIR, `${LABEL}.summary.json`), JSON.stringify(summary, null, 2));

  // cleanup
  await page.mouse.wheel(0, -5000);
  await page.waitForTimeout(400);
  try {
    await page.locator('button[aria-label="More actions"]').first().click({ timeout: 20000 });
    await page.locator('button', { hasText: /Cancel workout/i }).first().click({ timeout: 8000 });
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /^Cancel Workout$/ }).last().click({ timeout: 8000 });
    await page.waitForTimeout(2000);
    console.log('cleanup: discarded', sessionId);
  } catch (e) { console.log('CLEANUP-FAIL session', sessionId, String(e).slice(0, 80)); }
  await browser.close();
})();
