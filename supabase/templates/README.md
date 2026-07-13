# Auth email templates

Custom Supabase Auth email templates. Each includes the action button
(`{{ .ConfirmationURL }}`) **and** the 6-digit `{{ .Token }}` code, because
emailed links only work in the browser that started the flow (PKCE code
verifier) — the code works from any device via `/verify-code`
(`supabase.auth.verifyOtp`). Keep `{{ .Token }}` in any future edit or the
cross-device fallback silently dies.

- `confirmation.html` — signup confirmation ("Confirm signup" in the dashboard)
- `recovery.html` — password reset ("Reset password" in the dashboard)

## Local

Wired up in `supabase/config.toml` under `[auth.email.template.confirmation]`
and `[auth.email.template.recovery]` — `supabase start`/`db reset` picks them
up automatically (view sends at the Inbucket UI, port 54324).

## Production (manual step — config.toml does NOT deploy templates)

Hosted projects take templates from the dashboard only:

1. Supabase Dashboard → **Authentication → Emails → Templates**.
2. Open **Confirm signup**, paste the body of `confirmation.html`, set subject
   to `Confirm your HyperTrack account`, save.
3. Open **Reset password**, paste the body of `recovery.html`, set subject to
   `Reset your HyperTrack password`, save.
4. Send yourself a test of each (register a plus-addressed user / request a
   reset) and check the code renders under the button.

Re-do this whenever these files change.
