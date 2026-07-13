#!/usr/bin/env node
/**
 * Auth email delivery smoke test (see docs/AUTH_EMAIL_DELIVERY_AUDIT.md §6).
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/smoke-auth-email.mjs you+smoke1@gmail.com [--link-only] [--keep]
 *
 * Modes:
 *   default     Real signup via the anon key (exactly what the register page
 *               does), so Supabase sends the confirmation email through
 *               whatever sender production is configured with. You watch the
 *               mailbox; the script polls the admin API until the account
 *               shows email_confirmed_at (i.e. you clicked the link), then
 *               deletes the throwaway user.
 *   --link-only Skips delivery entirely: generates the confirmation link via
 *               the admin API and follows its redirect chain, asserting it
 *               lands on <APP_URL>/auth/callback. Verifies redirect config
 *               without needing an inbox.
 *   --ci        Fully non-interactive (for GitHub Actions): uniquifies the
 *               mailbox with a +ci-<timestamp> tag, runs the link redirect
 *               assertion, performs a real signup, and asserts the message
 *               appears in Resend's sent log within 2 minutes (REQUIRES
 *               RESEND_API_KEY — Supabase's own send reports nothing, the
 *               sent log is the only place a silent drop is visible). Cleans
 *               up all throwaway users. Non-zero exit on any failure.
 *
 * Optional env:
 *   NEXT_PUBLIC_APP_URL  Expected app origin (default https://hypertrack.app)
 *   RESEND_API_KEY       If set (i.e. Resend SMTP is configured in the
 *                        Supabase dashboard), the script also checks Resend's
 *                        sent log for the message.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://hypertrack.app';
const RESEND_KEY = process.env.RESEND_API_KEY;

const EMAIL_WAIT_MS = 2 * 60 * 1000; // assert delivery within 2 minutes
const CONFIRM_WAIT_MS = 10 * 60 * 1000; // wait for the human to click the link
const POLL_MS = 5000;

const args = process.argv.slice(2);
const emailArg = args.find((a) => !a.startsWith('--'));
const linkOnly = args.includes('--link-only');
const ciMode = args.includes('--ci');
const keep = args.includes('--keep');

function fail(msg) {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

if (!emailArg || !emailArg.includes('@')) {
  fail('pass a throwaway email you control, e.g. you+smoke1@gmail.com');
}
if (!SUPABASE_URL || !SERVICE_KEY || (!linkOnly && !ANON_KEY)) {
  fail(
    'missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY' +
      (linkOnly ? '' : ', NEXT_PUBLIC_SUPABASE_ANON_KEY')
  );
}
if (ciMode && !RESEND_KEY) {
  fail(
    '--ci requires RESEND_API_KEY: without the Resend sent-log there is no way to detect a silent drop (Supabase signUp/resend report success either way).'
  );
}

// In CI, uniquify the mailbox with plus-addressing so reruns never collide
// with a leftover user, and delivery still lands in the base inbox.
const plusTag = (addr, tag) => addr.replace('@', `+${tag}@`);
const email = ciMode ? plusTag(emailArg, `ci-${Date.now()}`) : emailArg;

const REDIRECT_TO = `${APP_URL}/auth/callback?next=/onboarding`;
const PASSWORD = `Smoke-${Math.random().toString(36).slice(2)}-Aa1!`;

async function api(path, { method = 'GET', body, admin = false } = {}) {
  const key = admin ? SERVICE_KEY : ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function findUserByEmail(addr) {
  // GoTrue admin list supports ?email= exact filter on recent versions;
  // fall back to scanning page 1.
  const { json } = await api(
    `/auth/v1/admin/users?email=${encodeURIComponent(addr)}&per_page=100`,
    { admin: true }
  );
  const users = json.users || [];
  return users.find((u) => u.email?.toLowerCase() === addr.toLowerCase()) || null;
}

async function deleteUser(id) {
  const { status } = await api(`/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    admin: true,
  });
  console.log(status < 300 ? `Cleaned up throwaway user ${id}.` : `WARN: delete returned ${status} — remove ${email} manually in the dashboard.`);
}

async function checkResendSentLog(addr) {
  const res = await fetch('https://api.resend.com/emails', {
    headers: { Authorization: `Bearer ${RESEND_KEY}` },
  });
  if (!res.ok) {
    console.log(`  (Resend API returned ${res.status} — check the dashboard sent log manually)`);
    return null;
  }
  const json = await res.json();
  const hit = (json.data || []).find((m) =>
    (Array.isArray(m.to) ? m.to : [m.to]).some(
      (t) => t?.toLowerCase() === addr.toLowerCase()
    )
  );
  return hit || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate a signup confirmation link via the admin API and assert its verify
 * redirect lands on <APP_URL>/auth/callback. Catches Redirect-URLs allow-list
 * problems (Supabase silently falls back to the Site URL) without an inbox.
 * Creates — and deletes — a throwaway user for the given address.
 */
async function assertLinkRedirect(addr) {
  console.log(`Generating signup confirmation link for ${addr} (redirect-config check)...`);
  // redirect_to is a QUERY param in GoTrue's REST API (the SDK's
  // options.redirectTo maps to it); a body field would be silently ignored
  // and the link would fall back to the Site URL.
  const { status, json } = await api(
    `/auth/v1/admin/generate_link?redirect_to=${encodeURIComponent(REDIRECT_TO)}`,
    {
      method: 'POST',
      admin: true,
      body: { type: 'signup', email: addr, password: PASSWORD },
    }
  );
  if (status >= 300) fail(`generate_link failed (${status}): ${JSON.stringify(json)}`);
  const link = json.action_link || json.properties?.action_link;
  if (!link) fail(`no action_link in response: ${JSON.stringify(json)}`);
  console.log(`Action link: ${link}`);

  // GET consumes the token — fine, this is a throwaway user.
  const res = await fetch(link, { redirect: 'manual' });
  const location = res.headers.get('location') || '(none)';
  console.log(`Verify endpoint responded ${res.status}, Location: ${location}`);

  const ok = location.startsWith(`${APP_URL}/auth/callback`);
  const user = await findUserByEmail(addr);
  if (user && !keep) await deleteUser(user.id);
  if (!ok) {
    fail(
      `confirmation link redirects to "${location}" — expected it to start with ${APP_URL}/auth/callback.\n` +
        'Likely cause: redirect_to not in the dashboard Redirect URLs allow-list (silent fallback to Site URL), or Site URL misconfigured.'
    );
  }
}

/**
 * CI delivery check: real signup, then poll Resend's sent log until the
 * message to `addr` shows up (bounded by EMAIL_WAIT_MS). A signup that
 * "succeeds" while nothing reaches the sent log IS the silent-drop incident
 * this job exists to catch.
 */
async function runCiDeliveryCheck(addr) {
  console.log(`Signing up throwaway user ${addr} (delivery check)...`);
  // redirect_to is a query param on /signup too (see assertLinkRedirect) —
  // this makes the emailed link the same /auth/callback?next=/onboarding
  // link the register page produces.
  const { status, json } = await api(
    `/auth/v1/signup?redirect_to=${encodeURIComponent(REDIRECT_TO)}`,
    {
      method: 'POST',
      body: { email: addr, password: PASSWORD },
    }
  );
  if (status >= 300) fail(`signup failed (${status}): ${JSON.stringify(json)}`);

  let userId = null;
  let hit = null;
  let bounced = null;
  try {
    if (json.access_token || json.session) {
      fail('signup returned a session immediately — email confirmation is DISABLED, so no confirmation email is ever sent. Re-enable it in Authentication → Sign In / Providers → Email.');
    }

    const start = Date.now();
    while (Date.now() - start < EMAIL_WAIT_MS) {
      hit = await checkResendSentLog(addr);
      if (hit) break;
      console.log(`[${Math.round((Date.now() - start) / 1000)}s] not in Resend sent log yet...`);
      await sleep(POLL_MS);
    }
    if (hit) {
      console.log(`Resend sent log: message ${hit.id}, status: ${hit.last_event || 'unknown'}`);
      if (['bounced', 'complained'].includes(hit.last_event)) bounced = hit.last_event;
    }
  } finally {
    const user = await findUserByEmail(addr);
    userId = user?.id ?? null;
    if (userId && !keep) await deleteUser(userId);
  }

  if (!hit) {
    fail(
      `signup succeeded but NO message to ${addr} appeared in the Resend sent log within ${EMAIL_WAIT_MS / 1000}s — confirmation emails are being silently dropped ` +
        '(rate limit, SMTP misconfig, or Supabase is back on the built-in sender). See docs/AUTH_EMAIL_DELIVERY_AUDIT.md §4.'
    );
  }
  if (bounced) {
    fail(`message reached Resend but its status is "${bounced}" — check domain verification and the suppression list.`);
  }
}

async function main() {
  console.log(`Target project : ${SUPABASE_URL}`);
  console.log(`App origin     : ${APP_URL}`);
  console.log(`Test address   : ${email}\n`);

  const existing = await findUserByEmail(email);
  if (existing) fail(`user ${email} already exists (${existing.id}) — pick a fresh plus-address or delete it first`);

  if (linkOnly) {
    await assertLinkRedirect(email);
    console.log('\nPASS: confirmation link redirects to the app callback correctly.');
    return;
  }

  if (ciMode) {
    // Redirect-config assertion on a second throwaway address (generate_link
    // creates a user too), then the real delivery check.
    await assertLinkRedirect(plusTag(emailArg, `ci-${Date.now()}-link`));
    console.log('Link redirect check passed.\n');
    await runCiDeliveryCheck(email);
    console.log('\nPASS: confirmation email reached the Resend sent log — no silent drop.');
    return;
  }

  // ---- Full delivery mode ----
  console.log('Signing up throwaway user via public API (triggers the real confirmation email)...');
  const { status, json } = await api(
    `/auth/v1/signup?redirect_to=${encodeURIComponent(REDIRECT_TO)}`,
    {
      method: 'POST',
      body: { email, password: PASSWORD },
    }
  );
  if (status >= 300) fail(`signup failed (${status}): ${JSON.stringify(json)}`);
  if (json.access_token || json.session) {
    const user = await findUserByEmail(email);
    if (user && !keep) await deleteUser(user.id);
    fail('signup returned a session immediately — email confirmation is DISABLED in this project, so no confirmation email is ever sent. (Reset flow can still be tested via the dashboard checklist.)');
  }
  console.log('Signup accepted; confirmation email should now be queued.');
  console.log(`\n>>> CHECK THE MAILBOX for ${email} (and its spam folder). Expected within 2 minutes. <<<\n`);

  const start = Date.now();
  let resendSeen = false;
  let confirmed = false;
  let userId = null;

  while (Date.now() - start < CONFIRM_WAIT_MS) {
    const user = await findUserByEmail(email);
    if (user) {
      userId = user.id;
      if (user.email_confirmed_at) {
        confirmed = true;
        break;
      }
    }
    if (RESEND_KEY && !resendSeen) {
      const hit = await checkResendSentLog(email);
      if (hit) {
        resendSeen = true;
        console.log(`Resend sent log: found message ${hit.id} (status: ${hit.last_event || 'unknown'})`);
      }
    }
    const elapsed = Date.now() - start;
    if (elapsed > EMAIL_WAIT_MS && !resendSeen && RESEND_KEY) {
      console.log('WARN: 2 minutes elapsed with no record in the Resend sent log — delivery has likely failed (see audit §4 ranking). Still waiting in case you clicked from a slow inbox...');
    } else if (elapsed > EMAIL_WAIT_MS && !RESEND_KEY) {
      console.log(`[${Math.round(elapsed / 1000)}s] still waiting for the link to be clicked (email_confirmed_at not set)...`);
    }
    await sleep(POLL_MS);
  }

  if (!keep && userId) await deleteUser(userId);

  if (!confirmed) {
    fail(
      'timed out waiting for confirmation. If NO email arrived within 2 minutes ⇒ delivery failure ' +
        '(most likely the built-in Supabase sender: recipient restriction or 2/hr rate limit — see docs/AUTH_EMAIL_DELIVERY_AUDIT.md §4). ' +
        'If the email arrived but the click failed ⇒ redirect/PKCE issue (§3).'
    );
  }
  console.log('\nPASS: email delivered, link clicked, account confirmed. If the browser landed signed-in on /onboarding, the full loop is healthy.');
}

main().catch((e) => fail(e.stack || String(e)));
