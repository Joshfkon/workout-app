/**
 * Shared helpers for the loading-state verification specs.
 * Uses the `playwright` library (no @playwright/test runner in this repo).
 */
import { chromium } from 'playwright';

export const BASE = 'http://localhost:3000';
export const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Two cookies: a JWT for the middleware fast-path + a base64 session for the
 *  @supabase/ssr browser client. See README.md for the full rationale. */
export function authCookies() {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'test-user-id', role: 'authenticated', exp })}.sig`;
  const user = { id: 'test-user-id', aud: 'authenticated', role: 'authenticated', email: 'test@test.com' };
  const session = { access_token: jwt, token_type: 'bearer', expires_in: 2592000, expires_at: exp, refresh_token: 'r', user };
  const sessionCookie = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  return {
    user,
    cookies: [
      { name: 'aaa-auth-token', value: jwt, domain: 'localhost', path: '/', httpOnly: false, secure: false },
      // The browser client's storage key is derived from NEXT_PUBLIC_SUPABASE_URL
      // (sb-<first host label>-auth-token). Plant both common local setups so
      // getSession() — which the app reads identity from at boot — works whether
      // the build points at placeholder.supabase.co or a localhost mock.
      { name: 'sb-placeholder-auth-token', value: sessionCookie, domain: 'localhost', path: '/', httpOnly: false, secure: false },
      { name: 'sb-localhost-auth-token', value: sessionCookie, domain: 'localhost', path: '/', httpOnly: false, secure: false },
    ],
  };
}

export const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

export async function newHarness() {
  const { user, cookies } = authCookies();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await context.addCookies(cookies);
  const page = await context.newPage();
  // Catch-all first (checked last); auth returns the user. Specific routes are
  // registered by the caller AFTER this and therefore win.
  await page.route('**/rest/v1/**', (r) => json(r, []));
  await page.route('**/auth/v1/**', (r) => json(r, user));
  return { browser, context, page, user };
}

/**
 * Assert that a repeat visit to `url` does NOT re-show the given full-page
 * loading testid — the core P0 guarantee.
 *
 * Uses REAL SPA navigation — the way users move between dashboard tabs: load
 * the surface once (cold, spinner allowed), SPA-navigate away via the fixed
 * bottom nav, then browser-back to the surface. The dashboard layout — and
 * with it the React Query in-memory cache — stays mounted across SPA nav, so
 * the surface must render from the warm cache with no loading state. Because
 * SPA nav keeps ONE document, a MutationObserver armed before the back nav
 * survives and catches even a one-frame skeleton flash. (This is the true P0
 * scenario; a hard reload is a different case — the server can't read the
 * client cache and legitimately server-renders a skeleton.)
 */
export async function assertNoReloadSpinner(page, { url, awayHref = '/dashboard/nutrition', loadedSelector, loadingTestid, screenshotPrefix, out }) {
  const results = [];
  const assert = (cond, msg) => { results.push(!!cond); console.log((cond ? 'PASS: ' : 'FAIL: ') + msg); };

  // First visit — spinner allowed (cold cache) — populates the in-memory cache.
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  await page.locator(loadedSelector).first().waitFor({ state: 'visible', timeout: 20000 });
  if (out) await page.screenshot({ path: `${out}${screenshotPrefix}-1-first-visit.png` });

  // SPA-navigate away via the visible fixed bottom nav (keeps layout + cache).
  await page.locator(`nav.fixed a[href="${awayHref}"]`).first().click();
  await page.waitForTimeout(600);

  // Arm the flash watcher (the document persists across SPA nav), then go back.
  await page.evaluate((testid) => {
    window.__spinnerSeen = false;
    new MutationObserver(() => {
      if (document.querySelector(`[data-testid="${testid}"]`)) window.__spinnerSeen = true;
    }).observe(document.documentElement, { childList: true, subtree: true });
  }, loadingTestid);

  await page.goBack();
  await page.locator(loadedSelector).first().waitFor({ state: 'visible', timeout: 20000 });
  if (out) await page.screenshot({ path: `${out}${screenshotPrefix}-2-revisit.png` });

  const seen = await page.evaluate(() => window.__spinnerSeen);
  assert(seen === false, `no full-page loading ("${loadingTestid}") on SPA revisit to ${url}`);
  return results;
}
