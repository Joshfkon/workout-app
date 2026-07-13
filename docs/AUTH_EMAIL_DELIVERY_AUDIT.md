# Auth Email Delivery Audit — confirmation & password reset

Date: 2026-07-13 · Scope: read-only code/config audit + manual checklist.
No configuration was changed.

---

## 1. Code + env inventory

### Resend usage: NONE

There is **no Resend integration anywhere in this repo**:

- No `resend` / `@resend` SDK import, no `RESEND_API_KEY` reference (code,
  docs, CI, env examples).
- No `sendEmail` utility, no mail-sending API route, no server action that
  sends mail.
- No Supabase edge functions exist at all (`supabase/functions/` is absent),
  so no edge function sends mail either.
- The only "resend" hits are `supabase.auth.resend({ type: 'signup' })` in
  `app/(auth)/login/page.tsx:49` — that is Supabase Auth's *re-send
  confirmation* API, which routes through whatever sender Supabase Auth is
  configured with. It is not the Resend product.

⇒ Every auth email (signup confirmation, password reset, email change) is
sent **by Supabase Auth itself**, using whatever SMTP is (or isn't)
configured in the hosted project's dashboard.

### Senders and what they're used for

| Sender | Used for | Where |
|---|---|---|
| Supabase Auth (built-in or dashboard SMTP) | Signup confirmation | `supabase.auth.signUp()` — `app/(auth)/register/page.tsx:40`, `hooks/useSupabase.ts:47` |
| Supabase Auth | Re-send confirmation | `supabase.auth.resend()` — `app/(auth)/login/page.tsx:49` |
| Supabase Auth | Password reset | `supabase.auth.resetPasswordForEmail()` — `app/(auth)/forgot-password/page.tsx:31` |

No other email is sent by the application.

### supabase/config.toml (LOCAL ONLY — does not prove production)

`supabase/config.toml` governs the **local CLI stack only**. The hosted
project's Auth settings live in the Supabase dashboard and are not in this
repo. **Nothing in this repo can prove what production is set to** — that's
the manual checklist below. That said, the local file is telling:

- `[auth.email.smtp]` block is **commented out** (lines 213–221) — and the
  commented example is SendGrid, not Resend. No IaC, script, or doc anywhere
  in the repo references configuring production SMTP.
- `[auth.email] enable_confirmations = false` locally (line 203). Production
  evidently differs: the register page handles the
  "user created but no session" confirmation branch, the login page ships a
  full "Resend confirmation email" UX, and `SECURITY_AUDIT.md` (finding #4)
  recommended enabling confirmations — so production almost certainly has
  **Confirm email = ON**.
- `[auth.rate_limit] email_sent = 2` per hour (line 176) — this mirrors the
  built-in sender's default production rate limit.

### Verdict on routing

**No evidence exists that custom SMTP was ever configured.** Unless someone
set SMTP up directly in the dashboard (verify below), production auth emails
go through **Supabase's built-in dev sender**, which is:

1. Rate-limited to ~2 emails/hour project-wide (matches the local default).
2. Best-effort delivery, sent from `noreply@mail.app.supabase.io` (poor
   deliverability/spam placement).
3. **Restricted recipients**: Supabase's built-in sender only delivers to
   email addresses belonging to members of the project's *organization/team*.
   Any ordinary user signing up gets **no email at all, silently** — the
   `signUp()` call still returns success. (Verify current wording in the
   dashboard banner / docs, but this restriction has applied to hosted
   projects for some time.)

---

## 2. Resend API checks

`RESEND_API_KEY` is **not present in this environment** and not referenced by
the codebase, so the API checks could not be run — and given §1, Resend may
not be in the picture at all. If it turns out Resend SMTP *was* configured in
the Supabase dashboard, run these as dashboard/API steps (see checklist §5,
items R1–R3).

---

## 3. Auth email settings audit (code-visible parts)

### Confirmation required?

- Local: `enable_confirmations = false`. Production: almost certainly **true**
  (see §1). The UX fully supports it (register → "Check your email…" →
  login page resend button).

### Redirect targets

- Signup / resend: `emailRedirectTo = ${window.location.origin}/auth/callback?next=/onboarding`
  (`register/page.tsx:38`, `login/page.tsx:53`).
- Password reset: `redirectTo = ${NEXT_PUBLIC_APP_URL || window.location.origin}/auth/callback?next=/reset-password`
  (`forgot-password/page.tsx:27-29`). Note the in-code comment says to
  allow-list `https://www.hypertrack.app/auth/callback` (**www**), while
  `capacitor.config.ts` and CLAUDE.md use `https://hypertrack.app`
  (**non-www**). Both variants must be in the dashboard Redirect URLs
  allow-list — if `redirectTo` isn't allow-listed, Supabase silently falls
  back to the Site URL, so the email "sends fine" but lands on the wrong
  page.
- Callback handler: `app/(auth)/auth/callback/route.ts` — exchanges `?code=`
  via `exchangeCodeForSession`, routes recovery → `/reset-password`,
  new users → `/onboarding`, else `next` or `/dashboard/log`. Error params
  (expired OTP etc.) are handled.

### PKCE cross-device gotcha (looks like "broken email" to users)

The browser client is `createBrowserClient` from `@supabase/ssr` (default
flow: **PKCE**). The code verifier is stored in the browser that initiated
signup/reset. If the user taps the email link **on a different device or
browser** (e.g. signed up in the iOS app, opens Gmail on a laptop),
`exchangeCodeForSession` fails and they land on
`/login?message=Authentication failed`. The email delivered fine — the flow
still reads as broken.

### Capacitor deep-link behavior

- The native app loads the hosted site (`server.url = https://hypertrack.app`),
  so `window.location.origin` inside the app is the production origin —
  redirect URLs generated from the app are correct.
- `lib/integrations/capacitor-stub.ts:101` forwards `appUrlOpen` events for
  `/auth/callback` into the webview, but per `docs/APP_STORE_SUBMISSION.md`
  the iOS `CFBundleURLTypes` / universal-link setup is **not finished** — so
  email links tapped on-device open the system browser, not the app. The
  account still gets confirmed (server-side), but the user returns to the app
  without a session and must log in. Expected today; not a delivery failure.

### Email templates

No template customization exists in the repo (`[auth.email.template.*]` all
commented out; no `supabase/templates/` directory). Production templates are
whatever the dashboard shows — presumably Supabase defaults, sent from
`noreply@mail.app.supabase.io` unless custom SMTP overrides the sender.

---

## 4. OUTPUT A — Verdict

**Auth emails are sent by Supabase Auth, and there is no evidence of custom
SMTP — so production is most likely on Supabase's built-in dev sender.**

Ranked most-likely causes for a confirmation email that never arrived:

1. **Built-in sender restrictions (most likely).** Two failure modes, both
   silent: (a) recipients outside the Supabase org's team receive nothing at
   all; (b) ~2 emails/hour project-wide rate limit — a couple of signups or
   resend taps exhausts the hour. `signUp()`/`resend()` still return success.
2. **Suppression** — only applicable if Resend/other SMTP is actually
   configured in the dashboard; a prior bounce silently blocks the address
   forever until manually removed.
3. **DNS unverified** — same conditionality; unverified SPF/DKIM on
   `hypertrack.app` ⇒ rejections/spam.
4. **Spam placement** — very plausible for the built-in sender
   (`noreply@mail.app.supabase.io`), check spam folder first in any repro.
5. **Redirect misconfig / PKCE cross-device** — the email arrives but the
   link fails: `redirectTo` not in the allow-list (silent fallback to Site
   URL), www vs non-www mismatch, or link opened on a different device than
   the one that signed up ("Authentication failed").

**Fix direction** (not applied — config is out of scope for this audit):
configure production SMTP in the Supabase dashboard (Resend works well:
`smtp.resend.com:465`, user `resend`, pass = API key, sender
`noreply@hypertrack.app` on a verified domain), then raise the auth email
rate limit.

---

## 5. OUTPUT B — Manual checklist (dashboard steps)

Supabase steps (project: the one behind `NEXT_PUBLIC_SUPABASE_URL`):

- [ ] **S1 — Is custom SMTP on?** Dashboard → **Authentication → Emails → SMTP Settings** (older UI: Project Settings → Auth → SMTP). If "Enable Custom SMTP" is OFF ⇒ built-in sender confirmed ⇒ root cause per §4.1.
- [ ] **S2 — Confirm email toggle**: Authentication → **Sign In / Providers → Email** → "Confirm email". Record ON/OFF (expected ON).
- [ ] **S3 — Rate limits**: Authentication → **Rate Limits** → "Emails sent per hour". Built-in sender pins this at ~2/hr; with custom SMTP raise to e.g. 30+/hr.
- [ ] **S4 — URL configuration**: Authentication → **URL Configuration**. Site URL should be `https://hypertrack.app` (or www variant — whichever is canonical). Redirect URLs must include BOTH `https://hypertrack.app/auth/callback` and `https://www.hypertrack.app/auth/callback` (wildcards `https://hypertrack.app/**` acceptable), plus `http://localhost:3000/auth/callback` for dev.
- [ ] **S5 — Templates**: Authentication → **Emails → Templates** → "Confirm signup" and "Reset password". Note sender name/address and whether `{{ .ConfirmationURL }}` is intact.
- [ ] **S6 — Auth logs**: Dashboard → **Logs → Auth** (filter around the failed signup's timestamp). Look for `mail.send` errors, `429 over_email_send_rate_limit`, or "email not sent — address not authorized" style entries. This is the closest thing to a delivery log Supabase has for the built-in sender.
- [ ] **S7 — The affected user's state**: Authentication → **Users** → find the address → check `email_confirmed_at` empty and `confirmation_sent_at` timestamps (each resend attempt updates it; if it never updates, the send is being rejected before queueing).

Resend steps (ONLY if S1 shows custom SMTP pointing at Resend):

- [ ] **R1 — Domain**: resend.com → **Domains** → `hypertrack.app` must show Verified, with SPF + DKIM records green. (API: `GET https://api.resend.com/domains`.)
- [ ] **R2 — Sent log**: **Emails** → search the affected address, last 48h → status delivered / bounced / complained. (API: `GET https://api.resend.com/emails`.)
- [ ] **R3 — Suppression**: **Audiences / Suppressions** → search the affected address. A suppressed address silently never receives again — remove it manually.

DNS (only relevant with custom SMTP on a `hypertrack.app` sender):

- [ ] **D1** — `dig TXT hypertrack.app` / the Resend-provided selector: SPF include and DKIM records present and matching what Resend's domain screen shows. Add DMARC (`_dmarc.hypertrack.app`) at least `p=none`.

---

## 6. OUTPUT C — Test loop

Repeatable smoke test: `scripts/smoke-auth-email.mjs` (added by this audit).

```bash
# Full delivery test (real signup → you watch the mailbox → script polls
# until the account shows confirmed, then cleans up the throwaway user):
NEXT_PUBLIC_SUPABASE_URL=... \
NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/smoke-auth-email.mjs you+smoke1@gmail.com

# Link-only test (no email needed — verifies the confirmation link's
# redirect chain lands on /auth/callback at the right origin):
... node scripts/smoke-auth-email.mjs you+smoke2@gmail.com --link-only

# If Resend SMTP is configured, also pass RESEND_API_KEY=... and the script
# checks Resend's sent log for the message instead of relying on the mailbox.
```

Procedure (what the script automates):

1. `signUp()` a throwaway user (use Gmail plus-addressing on a mailbox you
   control) with the production `emailRedirectTo`.
2. Assert the email arrives within 2 minutes — mailbox check, or Resend sent
   log when `RESEND_API_KEY` is provided. If nothing after 2 min and no
   Resend record ⇒ delivery failure (see §4 ranking).
3. Click the link **on the same device/browser context** → must land signed
   in at `/onboarding`. (Then optionally re-open on a second device to
   observe the PKCE cross-device behavior described in §3.)
4. Script polls the admin API for `email_confirmed_at` and reports PASS/FAIL,
   then deletes the throwaway user (`--keep` to skip).

Re-run this whenever auth/email/SMTP/redirect configuration changes.
