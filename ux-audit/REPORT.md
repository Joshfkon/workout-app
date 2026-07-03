# HyperTrack UX/UI Audit — July 2, 2026

**Method.** Live app crawled with Playwright (Chrome) against a dev build at 390×844 and 1440×900 — 118 screenshots across every route plus step-by-step walkthroughs of the core flows (`screenshots/`). Performance measured with Lighthouse (mobile emulation, 4× CPU throttle, slow-4G simulation) against a **production build** (`next build` + `next start`) — see `PERF.md`. Code paths verified against source for every finding. Benchmark: Hevy, Strong, MacroFactor, RP Hypertrophy.

**Caveats.** One account state (established user with an active mesocycle). Empty states were evaluated from code + onboarding screenshots, not a fresh account. Lighthouse ran against localhost — real Supabase round-trips make the LCP numbers *worse* than reported. `/dashboard/analytics`'s Lighthouse row lost auth mid-run (redirected to login); treat it as directional.

**The one-paragraph verdict.** The core set-logging interaction is genuinely good — one tap when the suggestion is right, pre-filled weight/reps/RIR, last-session numbers inline, auto rest timer with sound/haptics, per-set DB persistence. The science layer (MEV/MRV volume bars, plateau detection, readiness, injury-aware swaps) is a real differentiator no competitor has. But the app fails its own environment: **tap targets on the workout screen are half the required size, the rest timer is invisible after logging a set, there is no way out of a workout without finishing or destroying it, logging fails outright when gym Wi-Fi drops, and a fat-fingered weight is permanent once the session ends.** Add ~4–6 s LCP on every dashboard route and a GET request that silently creates workout sessions, and paying users will hit rage-quit moments weekly. Everything below is fixable; most of it cheaply.

---

## P0 — blocks or badly degrades core flows

### P0-1 · Visiting a URL creates a workout session (side-effectful GET)
**Evidence:** Navigating to `/dashboard/workout/quick` — no click, just a page load — created session `99d59e23…` in the account and redirected to it. The audit crawler triggered it by merely visiting the route. Result visible in `screenshots/dashboard--mobile.png`: a phantom **"Continue workout — 0 exercises · 0/0 sets"** as the home page's primary CTA.
**Why it matters:** Link prefetching, a bookmarked URL, a back-button revisit, or a browser restoring tabs will silently spawn sessions that then hijack the Home and Train screens' primary action ("Continue" a workout the user never started). It corrupts training history — the thing the entire adaptive engine feeds on.
**Fix:** `workout/quick` must render a confirm screen (or be a POST-only action). Creation belongs behind an explicit tap, exactly like `handleStartBlank` on `/dashboard/log`. Also guard the Continue card: a session with 0 logged sets and 0 blocks older than N hours should be auto-discarded (code already has the discard machinery — `handleCancelWorkout`, workout/[id]/page.tsx:2986).

### P0-2 · Offline set logging fails — in the one place the app is used
**Evidence:** `public/sw.js:106-119` — all API/Supabase calls are network-only, no fallback, no queue. The SW caches the shell so the app *looks* alive offline, then every "Log set" write fails.
**Why it matters:** Gyms are basements with congested Wi-Fi. Hevy and Strong both queue writes and sync later; users switching from them will lose sets in their first bad-signal session and never trust the app again. This is the highest-stakes gap vs. competitors on the list.
**Fix:** IndexedDB outbox for set writes + background flush on reconnect, with per-set status glyphs so the user knows what state their data is in. Mockup: `mockups/04-sync-status-offline.html`. (Zustand-persist already keeps local state alive, so the plumbing is half-built.)

### P0-3 · The active workout is a navigation trap
**Evidence:** `screenshots/dashboard_workout_quick--mobile.png` and `flow-workout-07-after-set1.png`: no back button, and `BottomNavigation.tsx:73-76` hides the tab bar on workout routes. The only exits are **Finish** (terminal) or **Cancel Workout** (destructive, deletes progress). In the installed PWA (which onboarding actively pushes) there is no browser chrome to fall back on.
**Why it matters:** Mid-rest, users check macros, reply to a comment, glance at volume. Here that requires OS-level gestures and luck. Session state already survives navigation (per-set DB writes + Zustand persist) — the trap is purely presentational.
**Fix:** Back chevron minimizes the workout; persistent "Resume — 6/18 sets · rest 1:12" pill above the restored bottom nav on all tabs. Mockup: `mockups/03-workout-navigation.html`.

### P0-4 · Sub-44 px tap targets on exactly the screen used with sweaty hands
**Evidence (measured live from DOM bounding boxes, 390 px viewport):**
| Control | Size | Minimum |
|---|---|---|
| RIR chips (3/2/1/0) — a required per-set input | **26×25 px** | 44×44 |
| Weight/reps steppers | 40×40 | 44×44 |
| "Log set" | 310×**40** | ≥44 tall |
| Rest timer "+15s" / "Skip" | 53×32 / 51×32 | 44×44 |
| "Finish" (header) | 59×**28** | 44×44 |
| Set feedback / overflow ⋮ | 30×30 | 44×44 |
**Why it matters:** These are tapped between sets, hands chalked/sweaty, phone on a bench. A missed RIR tap either logs wrong effort data (which drives the progression engine!) or forces re-taps under time pressure. Competitors' set rows are finger-first.
**Fix:** 52–56 px input row; labeled RIR chips ("2 · good"). Mockup: `mockups/02-set-logger-ergonomics.html`.

### P0-5 · Rest timer is invisible when it matters
**Evidence:** `flow-workout-08-rest-timer.png` — screenshot taken 3 s after logging a set: **no countdown anywhere in the viewport**. The timer bar renders inline *inside* the exercise card (`components/workout/RestTimer.tsx` — a deliberate redesign replacing the old fixed panel), below the suggestion banner, next-set rows, and set list — i.e., below the fold the moment the card has content, and gone entirely once you scroll.
**Why it matters:** Rest timing is half the job of a lifting app. The sound/haptic work (which is good — `useRestTimer.ts:93-129`) can't carry it in a loud gym with the phone face-up. Hevy/Strong pin the countdown to a screen edge.
**Fix:** Sticky bottom timer bar with mm:ss, progress, +15s/Skip ≥44 px. Mockup: `mockups/01-rest-timer.html`.

---

## P1 — significant friction vs. competitors

### P1-1 · Hydration failure on at least six major pages
**Evidence:** Console on history, mesocycle, templates, exercises, body-composition, coaching, settings: `Error: Hydration failed…` traced to `components/ui/LoadingAnimation.tsx:48-53` — default `type='random'` picks an animation with `Math.random()` in a `useMemo`, so server and client render different markup by design. In dev it stacks a red "N errors" toast on top of the bottom nav (`dashboard_mesocycle--mobile.png`); in production React throws away the SSR HTML and re-renders those trees client-side on **every load**.
**Why it matters:** Wasted render work on the slowest devices, content flash, and it masks real hydration bugs forever after.
**Fix (≤10 lines):** pick the random variant in a `useEffect` after mount (render a deterministic one first), or hash something stable. This alone should visibly improve the LCP numbers in `PERF.md`.

### P1-2 · LCP 3.9–6.4 s on every authed route (production, mobile-throttled, localhost API)
**Evidence:** `PERF.md`. Home 6.36 s, mesocycle 5.96 s, workout/new 4.52 s, nutrition 4.68 s. LCP elements are all client-fetched text — pages ship a shell, hydrate 650–800 KB of JS, then start Supabase queries.
**Why it matters:** > 2.5 s is failing; competitors' logging screens are effectively instant. Every route is a client component doing fetch-after-hydrate; there's no skeleton on most (blank → pop-in), and history/analytics refetch everything on every visit and every time-range change (`analytics/page.tsx:847-1145`).
**Fix:** ranked plan in `PERF.md` (server-render first paint data, split the 462 KB workout bundle, paginate history, cache analytics per range, skeletons).

### P1-3 · A typo'd weight is permanent after the session ends
**Evidence:** Completed workouts are read-only — history offers only "Restart Workout" (`flow-history-01-list.png`, history/page.tsx:1109-1135). During the session, editing works (3–5 taps) but there is **no undo** after set deletion.
**Why it matters:** 415 instead of 145 poisons E1RM, PR detection, weekly volume, and the auto-progression suggestions built on them — forever, invisibly. Strong and Hevy allow retroactive edits; MacroFactor's whole brand is "fix your data, the algorithm adapts."
**Fix:** Editable set cells in history detail + recalculation on save; undo-toast on set delete (nutrition already has exactly this pattern — reuse it). Mockup: `mockups/05-history-edit.html`.

### P1-4 · No save/sync feedback for set writes
**Evidence:** `handleSetComplete` inserts to Supabase per set with no "saving/saved" indicator anywhere; failures surface only as a generic error toast. (Related to P0-2 but distinct: even online, users get no confirmation their data is durable.)
**Fix:** Per-set status glyph + logged-set undo toast. Mockup: `mockups/04`.

### P1-5 · No supersets, and the plate calculator is built but unreachable
**Evidence:** Zero superset support in schema or UI (grep confirms). Plate calculator: `ExerciseCard.tsx:199` accepts `onPlateCalculatorOpen`, the workout page has `showPlateCalculator` state (workout/[id]/page.tsx:301-302) — **no button ever triggers it**.
**Why it matters:** Supersets are table stakes for hypertrophy programs (RP's app programs them; Hevy groups them). The plate calculator is pure found money — it's already written.
**Fix:** Wire a "⚖" affordance on the weight field (mockup 02). Supersets: schema `superset_group` on exercise_blocks + shared rest handling — bigger lift, but users of every competitor will ask for it in reviews.

### P1-6 · History is a flat, unsearchable list
**Evidence:** No calendar view, no date range, no exercise filter — just reverse-chronological cards (history/page.tsx:488). Long-tenure users (the ones who pay) scroll for their life.
**Fix:** Month calendar with dot markers + per-exercise filter chip row. Strong's calendar is the reference.

### P1-7 · Icon-only, unlabeled tab rows in Analytics and Settings
**Evidence:** `dashboard_analytics--mobile.png` (📊 🎯 💪 📈 💚), `dashboard_settings--mobile.png` (👤 ⚖ ⚙ 👥) — no text labels, emoji rendering varies by platform.
**Why it matters:** Five unlabeled tabs each hiding major features (Wellness charts! Volume trends! Account/billing!) = features that effectively don't exist. Discoverability heuristic straight fail.
**Fix:** 10-pt labels under icons; they fit at 390 px.

### P1-8 · Unit chaos: kg shown to a lbs user
**Evidence:** Feed workout card "Volume: 14468 kg" and leaderboard "20530 kg" while the same user's logger shows "145 lbs" (`dashboard_feed--mobile.png`, `dashboard_leaderboards--mobile.png`).
**Why it matters:** Trust. A lifter who thinks in pounds reads 14468 kg as someone else's data — worse on social surfaces where numbers are the content. `formatWeight(v, unit)` exists (lib/utils); these components just don't use it.

### P1-9 · Orphaned features: no path to Profile, Discover, Leaderboards, Pricing
**Evidence:** `dashboard_more--mobile.png` lists 7 items; those four routes exist, work, and are linked from nowhere (nav agent verified `more/page.tsx:23-31` and both nav components).
**Why it matters:** Social + monetization surfaces that can only be reached by URL. Leaderboards even says "Top 1% **of 1** lifters" — nobody can get there to populate it.
**Fix:** Add to More (and put an upgrade entry point where free users actually are).

---

## P2 — polish

| # | Finding | Evidence / note |
|---|---|---|
| P2-1 | Raw data keys in UI: "Lateral_delts" as workout title, picker subtitle, volume rows | `dashboard_workout_quick--mobile.png`, `flow-workout-06`. One `formatMuscleName()` away. |
| P2-2 | Brand split: "HyperTracker" on onboarding welcome + science page vs "HyperTrack" everywhere else | `onboarding--mobile.png`, `learn--mobile.png` |
| P2-3 | Login shows raw Supabase errors ("missing email or phone", "Invalid login credentials") | login/page.tsx:29 — map to human copy |
| P2-4 | Dev leftovers in prod UI: "For testing: create an account or use Supabase dashboard" on login | login/page.tsx:112-114 |
| P2-5 | Landing has two CTAs to the same place ("Get Started" + "Create Account") | `landing--mobile.png` |
| P2-6 | Register: Confirm-Password field (drop for show-password toggle); no password manager hints beyond autocomplete | `register--mobile.png` |
| P2-7 | Native `confirm()`/`alert()` dialogs in history bulk-delete vs styled modal elsewhere | history/page.tsx:115,148 |
| P2-8 | "Press Enter to send, Shift+Enter for new line" hint on a touch screen | `dashboard_ai-coach--mobile.png` |
| P2-9 | Desktop: duplicated logo (sidebar + header), 40%+ dead space right of content, Elite badge desktop-only | `dashboard--desktop.png` |
| P2-10 | Every route shares one `<title>` ("HyperTrack - Science-Based Workout Tracker") — killed tab discrimination, weak deep-link previews | crawl log: identical titles on 70+ pages |
| P2-11 | Number formatting: "2175.0 lbs total", weight truncated to "57.5 …" in stepper | `flow-history-01`, `dashboard_workout_quick--mobile.png` |
| P2-12 | Legacy routes `/dashboard/coaching`, `/dashboard/body-composition` still exist as redirect stubs; `/dashboard/workout` hub duplicates most of `/dashboard/log` (two "start a workout" surfaces with different options) | crawl redirects; `dashboard_workout--mobile.png` vs `dashboard_log--mobile.png` |
| P2-13 | Supabase 406s on volume pages (`.single()` on zero rows) — noisy console, latent error path | crawl log `/dashboard/volume` |
| P2-14 | Exercises library: filter wall (status/muscle/equipment) pushes the actual list below the fold at 390 px; "Active (0)" chip is cryptic | `dashboard_exercises--mobile.png` |
| P2-15 | Templates page has no starter templates — a "Test" template and a folder icon; competitors ship a template gallery | `dashboard_templates--mobile.png` |
| P2-16 | History → workout detail is a full-screen "Loading workout…" spinner with no skeleton | `flow-history-02-detail.png` |

---

## Heuristic scorecard (fitness-app weighted)

Scores 1–5 (5 = best-in-class). Weighted for mid-workout usability.

| Screen | Tap targets | Taps-to-goal | Status visibility | Error recovery | Empty state | Consistency | Notes |
|---|---|---|---|---|---|---|---|
| Workout logger | **1** | **5** | **2** | 3 (in-session) / **1** (after) | 4 | 4 | 1-tap logging is elite; everything around it undersized/invisible |
| Train (log) | 4 | 5 | 4 | — | 4 | 4 | Best screen in the app |
| Home | 4 | 4 | 4 | — | 3 | 4 | Phantom continue card (P0-1) undermines it |
| Nutrition | 4 | 5 | 4 | **5** (undo toast) | 2 | 4 | MacroFactor-competitive quick-add |
| History | 3 | 3 | 3 | **1** | 4 | 3 | Read-only + unsearchable |
| Analytics | 3 | 2 | 2 | — | 2 | 3 | Unlabeled tabs, refetch-everything, no skeletons |
| Mesocycle | 4 | 4 | 4 | 3 | 3 | 4 | Solid |
| Settings | 3 | 3 | 4 | 4 | — | 3 | Unlabeled tabs; delete-account guarded properly |
| Onboarding | 4 | 4 | 4 | 4 | — | 4 | Clear, skippable; "HyperTracker!" typo on screen 1 |

**Measured tap counts** (mobile): log a set with suggestion accepted **1**; with weight adjustment **2–3**; start blank workout to first logged set **6** (incl. exercise search); log a frequent food **1–2**; edit a logged food **2**; fix a set logged 2 sessions ago **impossible**.

---

## Competitive gap matrix

| Capability | HyperTrack | Hevy | Strong | MacroFactor | RP |
|---|---|---|---|---|---|
| 1-tap set logging w/ suggestions | ✅ best-in-class | ➖ manual | ➖ manual | — | ✅ |
| Previous performance inline | ✅ card subtitle | ✅ per-row | ✅ per-row | — | ✅ |
| Rest timer visible while scrolling | ❌ (P0-5) | ✅ pinned | ✅ pinned | — | ✅ |
| Plate calculator | ❌ built, unwired (P1-5) | ✅ | ✅ | — | ✅ |
| Supersets | ❌ none | ✅ | ✅ | — | ✅ |
| Offline logging | ❌ fails (P0-2) | ✅ queue | ✅ local-first | ✅ | ✅ |
| Edit past workouts | ❌ (P1-3) | ✅ | ✅ | ✅ (any data) | ✅ |
| Calendar/history browse | ❌ flat list | ✅ | ✅ calendar | ✅ | ➖ |
| Volume landmarks (MEV/MAV/MRV) | ✅ **unique** | ❌ | ❌ | — | ✅ |
| Plateau detection | ✅ **unique** | ❌ | ❌ | — | ➖ |
| Readiness/fatigue auto-regulation | ✅ **unique** | ❌ | ❌ | — | ✅ |
| Adaptive TDEE + macro targets | ✅ | ❌ | ❌ | ✅ | ❌ |
| AI food describe + barcode | ✅ | ❌ | ❌ | ✅ barcode | ❌ |
| Warmup protocol generation | ✅ | ❌ | ✅ | — | ✅ |
| Exercise S–F hypertrophy tiers | ✅ **unique** | ❌ | ❌ | — | ➖ |

**What a switching user misses on day one:** working offline logging, supersets, a pinned rest timer, plate math, editing yesterday's typo, and a calendar. **What they'd gain and can't get elsewhere:** the volume/fatigue science layer and integrated training+nutrition adaptation. The strategy writes itself: close the six table-stakes gaps; the differentiation is already built.

---

## What's already strong (don't break these)

- One-tap set logging with explained suggestions ("holding the weight — your last set matched the target effort") — more transparent than RP.
- Rest timer *mechanics*: auto-start, 3-tone beep, haptics, native notification, localStorage resume (`useRestTimer.ts`) — it only needs to be visible.
- Per-set persistence + session recovery after tab close.
- Nutrition quick-add stack (Describe-with-AI, barcode, frequent chips, copy-yesterday, undo toast) — genuinely MacroFactor-tier interaction design.
- Injury-aware exercise swapping and the pre-workout readiness check.
- Onboarding: progressive, skippable, DEXA-aware, visual body-fat guide.
- Bottom nav: 64 px targets, correct 5-tab IA.

## Screenshot index
`screenshots/<route>--mobile.png` (viewport), `--mobile-full.png` (full page), `--desktop.png`; flow steps as `flow-workout-01…13`, `flow-history-*`, `flow-nutrition-*`. Mockups in `mockups/01…05-*.html` (open in a browser; they embed the current-state screenshots for side-by-side).
