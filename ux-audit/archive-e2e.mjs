/* E2E: stale-session auto-discard now ARCHIVES (post-migration).
 * 1. Create an empty quick session through the app UI (Playwright).
 * 2. Backdate started_at 5h (service role — own test row only).
 * 3. Open the session URL: expect redirect to /dashboard/log AND the row
 *    flipped to state='auto_discarded' with auto_discarded_at set (not deleted).
 * 4. Re-open the archived URL: expect the same redirect (new guard).
 * 5. Clean up: hard-delete the test row (no UI path exists for archived rows
 *    by design) + orphan check. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FLOW_BASE || 'http://localhost:3001';
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth-state.json'), 'utf8'));
const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').trim().replace(/^=+/, '');
const supabase = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

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

// 1. create empty session via UI
await page.goto(BASE + '/dashboard/workout/quick', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /Start workout|Continue workout/ }).click();
await page.waitForURL(/\/dashboard\/workout\/[0-9a-f-]{36}/, { timeout: 20000 });
const sessionId = page.url().match(/workout\/([0-9a-f-]{36})/)[1];
console.log('created session:', sessionId);
await page.goto(BASE + '/dashboard/log', { waitUntil: 'domcontentloaded' }); // leave it, don't touch it further

// 2. backdate started_at 5h (test row only)
const backdated = new Date(Date.now() - 5 * 3600e3).toISOString();
const upd = await supabase.from('workout_sessions')
  .update({ started_at: backdated })
  .eq('id', sessionId)
  .is('mesocycle_id', null)
  .select('id, state, started_at');
console.log('backdated:', JSON.stringify(upd.data), upd.error?.message || '');

// 3. open the stale session URL
await page.goto(BASE + '/dashboard/workout/' + sessionId, { waitUntil: 'domcontentloaded' });
await page.waitForURL(/\/dashboard\/log/, { timeout: 20000 }).catch(() => {});
console.log('after open:', page.url().includes('/dashboard/log') ? 'redirected to /dashboard/log PASS' : 'NO REDIRECT FAIL (' + page.url() + ')');

const row = await supabase.from('workout_sessions').select('id, state, auto_discarded_at').eq('id', sessionId).maybeSingle();
if (!row.data) console.log('row after open: DELETED — FAIL (should be archived)');
else console.log(`row after open: state=${row.data.state}, auto_discarded_at=${row.data.auto_discarded_at} ${row.data.state === 'auto_discarded' && row.data.auto_discarded_at ? 'PASS' : 'FAIL'}`);

// 4. archived URL revisit redirects
await page.goto(BASE + '/dashboard/workout/' + sessionId, { waitUntil: 'domcontentloaded' });
await page.waitForURL(/\/dashboard\/log/, { timeout: 20000 }).catch(() => {});
console.log('archived revisit:', page.url().includes('/dashboard/log') ? 'redirected PASS' : 'FAIL (' + page.url() + ')');

// invisible on Home/quick (allowlists)
await page.goto(BASE + '/dashboard/workout/quick', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const cta = await page.getByRole('button', { name: /Start workout|Continue workout/ }).textContent();
console.log('quick CTA after archive:', cta?.trim(), /Start/.test(cta || '') ? 'PASS (invisible)' : 'FAIL (resurfaced)');

// 5. cleanup: delete the archived test row
const del = await supabase.from('workout_sessions').delete().eq('id', sessionId).eq('state', 'auto_discarded');
console.log('cleanup delete:', del.error ? 'ERR ' + del.error.message : 'done');
const gone = await supabase.from('workout_sessions').select('id').eq('id', sessionId);
console.log('row gone:', gone.data?.length === 0 ? 'yes' : 'NO');

await browser.close();
console.log('ARCHIVE E2E DONE');
