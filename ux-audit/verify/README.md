# Loading-states verification harness

Standalone Playwright scripts (using the `playwright` **library** — this repo
has no `@playwright/test` runner) that drive the real app at a 390px viewport
and assert the cached-first behavior described in `../loading-audit.md`.

## Running

```bash
# 1. Build + start the app on :3000 (placeholder Supabase env is fine — the
#    scripts intercept every Supabase call).
NEXT_PUBLIC_SUPABASE_URL="https://placeholder.supabase.co" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="placeholder-anon-key" \
  npx next build && npx next start &

# 2. Run a spec
node ux-audit/verify/nutrition-dayswitch.mjs
```

Screenshots are written to `./screens/`.

## Why two auth cookies

The app can't reach a real Supabase, so the harness fakes auth. Two cookies
are needed because middleware and the browser client read the session
differently:

- `aaa-auth-token` = a bare JWT (`header.payload.sig`, future `exp`). The
  Next middleware's fast-path (`hasValidSessionCookie`) finds the first cookie
  whose name contains `auth-token` and only checks that it splits into 3
  JWT parts with a valid `exp`. This lets a **non-sensitive** route
  (`/dashboard/nutrition`) through without a server round-trip to Supabase.
- `sb-placeholder-auth-token` = `base64-<session JSON>`, the format
  `@supabase/ssr` parses into a client session so `getUser()` works and REST
  calls carry the token. The `aaa-` prefix ensures middleware finds the JWT
  cookie first.

All Supabase `auth/v1` + `rest/v1` calls are intercepted with canned per-date
fixtures. Route handlers are registered **catch-all first** because Playwright
checks routes last-registered-first. `insert().select().single()` responses
must be a single JSON object (not an array), matching PostgREST's `single()`
behavior.

`serviceWorkers: 'block'` avoids the app's service worker serving stale chunks
across rebuilds.

## nutrition-dayswitch.mjs — what it asserts (13 checks)

- Cold start renders (no `/login` redirect via the auth bypass).
- The full-screen loading testid (`nutrition-full-loading`) is absent after
  the initial load and **never** appears during today→yesterday→day-before→
  today switches (verified live by a MutationObserver, not just point checks).
- Per-day data actually changes (today: Oats+Chicken; yesterday: Salmon).
- A quick-add (frequent-food chip) updates the macro totals immediately
  (630 → 930 kcal) — the optimistic-write path.
- A warm reload (persisted IndexedDB cache) renders without the full loader.

## label-scan.mjs — what it asserts (24 checks)

Drives the Add Food → Scan Label flow with OCR injected via the
`window.__hypertrackMockLabelOcr` test hook (LabelScanner skips the
tesseract.js WASM run when it's set):

- High-confidence scan lands directly in the create-food form with macros +
  serving size prefilled, "Scanned" badges on scanned fields, and a
  review-before-saving banner; editing a field and saving produces a
  `custom_foods` insert with the edited value.
- A low-confidence scan (protein misread → Atwater mismatch) stops at the
  review step, names the suspect field, and offers the user-triggered
  "Try AI scan"; going offline disables the AI button with explanatory copy
  while manual entry stays reachable; "use anyway" carries the amber "Check"
  mark into the form.
- The barcode tab still renders its scanner (shared Add Food sheet, no
  regression).
