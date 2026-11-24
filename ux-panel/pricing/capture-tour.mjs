#!/usr/bin/env node
/**
 * Capture the pricing tour's screenshots from the CURRENT local build.
 *
 *   node ux-panel/pricing/capture-tour.mjs [--base-url=http://localhost:3100] [--persona=hevy-switcher-sam] [--headed]
 *
 * Creates one synthetic account on the LOCAL Supabase (same rules as the
 * panel: @synthetic-panel.test, user_metadata.synthetic_panel, refuses any
 * non-local URL), seeds it as a returning persona on Pro (so the program
 * builder isn't behind the paywall), signs in through the app's own form at
 * 390×844, and saves each TOUR screen to ux-panel/pricing/tour/ plus
 * tour.json with the key visible text of each. The account is removed at
 * the end (pass --keep to inspect it).
 *
 * The workout screen repeats the seeded history's last session from Home, so
 * the suggestion strip shows the weight and its reason ("Last time … → …").
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { adminClient, assertLocalSupabase, createAccount, newCredentials, seedReturningUser, cleanupSynthetic } from '../lib/accounts.mjs';
import { TOUR, TOUR_DIR } from './tour.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const baseUrl = flag('base-url', 'http://localhost:3100');
const personaId = flag('persona', 'hevy-switcher-sam');
const outDir = path.resolve(flag('out', TOUR_DIR));

for (const line of existsSync(path.join(REPO, '.env.local')) ? readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n') : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const VISIBLE_CHARS = 700;

async function visibleText(page) {
  const text = await page.locator('main').first().innerText({ timeout: 5000 }).catch(() => page.locator('body').innerText());
  return text.replace(/\s+/g, ' ').trim().slice(0, VISIBLE_CHARS);
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

/** Close whatever first-visit sheet or tip is on top, so the screen itself shows. */
async function dismissOverlays(page) {
  for (let i = 0; i < 3; i++) {
    const dialog = page.locator('[role="dialog"]:visible').last();
    if (!(await dialog.count())) return;
    const close = dialog.getByRole('button', { name: /close|dismiss|got it|not now|skip|later|×/i }).first();
    if (await close.count()) await close.click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function openWorkout(page) {
  await page.goto(new URL('/dashboard', baseUrl).toString(), { waitUntil: 'load', timeout: 90000 });
  await settle(page);
  await dismissOverlays(page);
  const repeat = page.getByRole('button', { name: /^Repeat/i }).first();
  const start = page.getByRole('button', { name: /^(Start|Continue)( today.s)? workout/i }).first();
  const target = (await repeat.count()) ? repeat : start;
  await target.click({ timeout: 10000 });
  await page.waitForURL(/\/dashboard\/workout\/(?!new)[^/]+/, { timeout: 60000 }).catch(() => {});
  await settle(page, 2500);
  await dismissOverlays(page);
  // Bring the suggestion strip ("Why this weight?") into view when present.
  const why = page.getByText(/why this weight/i).first();
  if (await why.count()) await why.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  return /\/dashboard\/workout\//.test(page.url());
}

async function main() {
  const host = new URL(baseUrl).hostname;
  if (!['localhost', '127.0.0.1'].includes(host)) throw new Error(`--base-url ${baseUrl} is not local; the tour is captured from the local build only.`);
  assertLocalSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://missing');
  const { personas } = JSON.parse(readFileSync(path.join(HERE, '..', 'personas.json'), 'utf8'));
  const base = personas.find((p) => p.id === personaId);
  if (!base) throw new Error(`unknown --persona=${personaId}`);
  const persona = { ...base, account: { ...base.account, tier: 'pro' } };

  const runId = `tour${Date.now().toString(36)}`;
  const admin = adminClient();
  const creds = newCredentials(persona.id, runId, 'tour');
  const userId = await createAccount(admin, creds, runId);
  await seedReturningUser(admin, userId, persona);

  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: !flag('headed') });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'en-US', timezoneId: 'America/New_York' });
  await context.addInitScript(() => {
    const hide = () => {
      const st = document.createElement('style');
      st.textContent = 'nextjs-portal{display:none!important}';
      document.head.appendChild(st);
    };
    if (document.head) hide();
    else document.addEventListener('DOMContentLoaded', hide);
  });
  const page = await context.newPage();
  const capture = { capturedAt: new Date().toISOString(), baseUrl, persona: persona.id, screens: {} };
  try {
    await page.goto(new URL('/login', baseUrl).toString(), { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(500);
    await page.getByLabel('Email').fill(creds.email);
    await page.getByLabel('Password', { exact: true }).fill(creds.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90000, waitUntil: 'commit' });

    // The workout goes last: once a session is open, every other screen shows
    // a "Resume workout" bar over its bottom.
    for (const screen of [...TOUR.filter((s) => s.id !== 'workout'), ...TOUR.filter((s) => s.id === 'workout')]) {
      let ok = true;
      if (screen.id === 'workout') ok = await openWorkout(page);
      else {
        await page.goto(new URL(screen.path, baseUrl).toString(), { waitUntil: 'load', timeout: 90000 });
        await settle(page);
        await dismissOverlays(page);
      }
      const file = path.join(outDir, path.basename(screen.image));
      await page.screenshot({ path: file, type: 'jpeg', quality: 70 });
      capture.screens[screen.id] = { url: new URL(page.url()).pathname, text: await visibleText(page), ok };
      console.log(`  ${ok ? 'saved' : 'CHECK'}  ${screen.id.padEnd(9)} ${new URL(page.url()).pathname} → ${path.relative(process.cwd(), file)}`);
    }
  } finally {
    await browser.close();
    if (!flag('keep')) await cleanupSynthetic(admin, { runId }).catch((e) => console.log(`cleanup failed: ${e.message} (node ux-panel/cleanup.mjs --run=${runId})`));
  }
  await writeFile(path.join(outDir, 'tour.json'), JSON.stringify(capture, null, 1));
  console.log(`Tour captured to ${path.relative(process.cwd(), outDir)}. Look at the images before a paid run: a sheet or error over a screen is what every persona will see.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
