#!/usr/bin/env node
/**
 * Environment check for the panel's local stack: signs in a throwaway seeded
 * persona, visits the main screens, and lists every Supabase "missing column /
 * missing table" error (PostgREST 42703 / PGRST205 / 42P01). Personas would
 * otherwise report those as app bugs. Fix them in fixups.sql and re-run until
 * this prints nothing. Deletes its throwaway account afterwards.
 *
 *   node ux-panel/local-db/check-env.mjs [--base-url=http://localhost:3100]
 */
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminClient, createAccount, seedReturningUser, cleanupSynthetic } from '../lib/accounts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = path.join(HERE, '..', '..', '.env.local');
if (existsSync(env)) for (const l of readFileSync(env, 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const BASE = process.argv.find((a) => a.startsWith('--base-url='))?.split('=')[1] ?? 'http://localhost:3100';
const ROUTES = ['/dashboard', '/dashboard/train', '/dashboard/workout/new', '/dashboard/workout/quick', '/dashboard/nutrition', '/dashboard/analytics', '/dashboard/history', '/dashboard/templates', '/dashboard/more', '/dashboard/settings', '/dashboard/body-composition', '/dashboard/mesocycle'];
const SCHEMA_CODES = new Set(['42703', 'PGRST205', '42P01', 'PGRST200', 'PGRST204']);

const admin = adminClient();
const { personas } = JSON.parse(readFileSync(path.join(HERE, '..', 'personas.json'), 'utf8'));
const runId = `envcheck${Date.now()}`;
const creds = { email: `uxpanel+envcheck-${Date.now()}@synthetic-panel.test`, password: 'Px9-envcheck-aA' };
const id = await createAccount(admin, creds, runId);
await seedReturningUser(admin, id, personas.find((p) => p.account.history === 'regular'));

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
const problems = new Map();
let current = '';
page.on('response', async (r) => {
  if (r.status() < 400 || !/\/(rest|auth)\/v1\//.test(r.url())) return;
  const body = await r.json().catch(() => null);
  if (!body || !SCHEMA_CODES.has(body.code)) return;
  const key = body.message;
  if (!problems.has(key)) problems.set(key, new Set());
  problems.get(key).add(current);
});
await page.goto(`${BASE}/login`);
await page.getByLabel('Email').fill(creds.email);
await page.getByLabel('Password', { exact: true }).fill(creds.password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90000, waitUntil: 'commit' });
for (const route of ROUTES) {
  current = route;
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(5000);
}
await browser.close();
await cleanupSynthetic(admin, { runId });
if (!problems.size) console.log('No schema errors on', ROUTES.length, 'screens.');
for (const [msg, routes] of problems) console.log(`- ${msg}  (on ${[...routes].join(', ')})`);
process.exit(problems.size ? 1 : 0);
