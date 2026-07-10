# Loading-States Audit — HyperTrack

Goal: eliminate **blocking, full-viewport loading states** on navigation to
data the user has already seen, moving to a **cached-first / stale-while-
revalidate** model (React Query cache + IndexedDB persistence). Full-screen
"heart" spinners are reserved for *first-ever load with an empty persisted
cache*.

## Severity legend

- **P0** — blocking spinner re-appears on *repeat* navigation to
  already-seen data (day switch, revisit a route/detail, param change). Worst
  offender class; this is what the project is about.
- **P1** — blocking spinner on *first* navigation where a skeleton / partial
  chrome render is possible and the data is live-ish.
- **P2** — cold-start-only, or effectively never fires (server passes
  `initialData`), or trivial (redirect stub, no data fetch).

## Reference components

| Component | File | Role |
|---|---|---|
| `LoadingAnimation` | `components/ui/LoadingAnimation.tsx:39` | animated figure/spinner, centered |
| `FullPageLoading` | `components/ui/LoadingAnimation.tsx:453` | `LoadingAnimation` in `min-h-[60vh]` + tip — the true full-viewport blocker |
| `SkeletonCard` / `SkeletonExercise` | `:417` / `:430` | non-blocking structural placeholders (the good pattern) |

Route-level `loading.tsx` files (analytics, exercises, nutrition, workout,
workout/[id]) are all **skeleton-based already — no change needed.**

## Audit table

| # | Route / component | File:line | Trigger | What's fetched | Mutability | How fetched | Severity |
|---|---|---|---|---|---|---|---|
| 1 | **Eat / nutrition** | `nutrition/page.tsx:1441` | **param change (selectedDate)** + cold start | 13-query `Promise.all`: `food_log` (selected day + prev day), `nutrition_targets`, `weight_log`, `custom_foods`, frequent foods, `users`, `dexa_scans`, `mesocycles`, `user_preferences`, `user_volume_profiles`, protein 30d, training sets 30d; + adaptive TDEE action | **per-day food = immutable for past days, live for today**; user-global rest is date-independent | raw supabase in `useEffect([selectedDate])` | **P0** |
| 2 | **history** | `history/page.tsx:828` (early-return) + `:1392` (Suspense `FullPageLoading`) | **cold start / revisit** (client component re-mounts on route entry); searchParams | `workout_sessions` + nested `exercise_blocks → exercises, set_logs`, paginated 20, states completed/in_progress | **immutable-in-practice** (completed workouts) | raw supabase in `useEffect([])` | **P0** |
| 3 | **analytics** | `analytics/page.tsx:1384` (early-return) + `:3001` (Suspense `FullPageLoading`) | **cold start / revisit**; `?tab=`,`?section=` param | `users`, benchmark/calibration, `dexa_scans`, lift trends (`workout_sessions → exercise_blocks/set_logs`), `mesocycles` | **mostly immutable** (DEXA history, completed-session lift trends) | raw supabase in `useEffect([router])` | **P0** |
| 4 | **exercises** | `exercises/page.tsx:770` (list-region gate w/ `LoadingAnimation`) | **cold start / revisit** (gated by `mounted` flag, always shows on first paint) | `exercises` full catalog `.order('name')` | **immutable** (static catalog) | raw supabase in `useEffect([mounted])` | **P0** |
| 5 | **templates/[id]** | `templates/[id]/page.tsx:342` (`min-h-screen` early-return) | **URL `[id]` param change** (navigate between/return to templates) | template + its exercises, `workout_folders`, `exercises` catalog `.limit(500)` | live-ish (user-editable) but re-blocks on revisit | raw supabase in `useEffect([templateId])` | **P0** |
| 6 | **templates** (list) | `templates/page.tsx:275` (`min-h-screen` early-return) | cold start | `workout_folders`, `workout_templates`, `workout_template_exercises` | live-ish (user-editable) | raw supabase in `useEffect([])` | **P1** |
| 7 | **settings** | `settings/page.tsx:374` (early-return) | cold start + **re-fires on auth state change** | `users` (preferences/experience) | live (user settings) | raw supabase in `useEffect` + auth listener | **P1** |
| 8 | **DashboardClient** | `DashboardClient.tsx:1321` (early-return) | cold start **without** server `initialData` only | mesocycle, today's workout, today's nutrition totals, weight, weekly volume, lift trends, body-comp | live (today's totals) | **server component passes `initialData`** → early-return is a fallback that ~never fires in normal nav | **P2** |
| 9 | **mesocycle** | `mesocycle/page.tsx:595` | cold start | `mesocycles` | live | raw supabase; **already skeleton-based, not a spinner** | **P2 (already good)** |
| 10 | **body-composition** | `body-composition/page.tsx:16` | mount | none — `router.replace('/dashboard/analytics')` redirect stub | n/a | n/a | **P2 (trivial)** |
| 11 | **coaching** | `coaching/page.tsx:16` | mount | none — redirect stub to analytics | n/a | n/a | **P2 (trivial)** |
| 12 | **workout/[id]** (active session) | `workout/[id]/page.tsx:3761` | active-session load | live session state | **live** | Zustand + supabase; already skeleton-based | **OUT OF SCOPE — do not touch** |

## Adjacent / non-blocking (no action)

- All five `loading.tsx` route fallbacks — skeleton-based, correct.
- `mesocycle/page.tsx:595` — already skeleton, CLS-optimized.
- `workout/[id]` phase-loading — live active session, out of scope.
- Sub-section loaders that render *inside* a card and don't gate the page
  (history calendar dots, analytics "Loading user data...", coaching notes
  spinner, dynamic-import chart fallbacks) — non-blocking, leave as-is.
- `workout/new`, `pricing`, `exercises/add`, onboarding `min-h-[400px]`
  blocks — cold-start-only, low traffic; **P2, deferred.**

## Fix plan / status

- ✅ **Phase 1** — Eat/nutrition (#1): the exemplar. React Query
  `['nutrition', dateKey]` per-day query, `keepPreviousData`, adjacent-day
  prefetch, IndexedDB persistence, skeleton chrome, mutation invalidation.
  Verified (`ux-audit/verify/nutrition-dayswitch.mjs`, 13/13).
- ✅ **Phase 2 (all P0s, one commit each, each verified)** —
  exercises (#4), history (#2), analytics (#3), templates/[id] (#5). Same
  pattern: query cache with long `staleTime` for immutable data (moderate for
  the editable template), render cached data instantly on revisit, skeleton /
  no full-page spinner only when the cache is truly empty. Per-surface
  Playwright specs in `ux-audit/verify/*-revisit.mjs` all pass.
- **Deferred (P1/P2), documented not churned** — templates list (#6),
  settings (#7) can adopt the pattern opportunistically (live data, lower
  traffic); DashboardClient (#8) already effectively fixed by server
  `initialData`; mesocycle (#9) already skeleton-based; redirect stubs
  (#10, #11) are trivial; `workout/new`, `pricing`, `exercises/add`,
  onboarding are cold-start-only (P2).
- **Never touched** — active workout session (#12): live Zustand/outbox
  state, explicitly out of scope.

## Guardrail (Phase 3)

- Convention documented in `CLAUDE.md` → "Loading States & Data Caching
  (cached-first)": full-viewport loaders are cold-start-only; new data views
  use `useQuery` + the cached-first pattern.
- `ux-audit/verify/lib.mjs#assertNoReloadSpinner` is a reusable Playwright
  helper that fails if a page's loading testid appears on an SPA revisit; the
  Eat spec additionally arms a MutationObserver across all day switches.

## Eat-page architecture confirmation (Phase 0 stop-gate)

The Eat page is a **client component** using **raw supabase in a
`useEffect([selectedDate])`**, storing results in ~20 `useState` vars, with a
single `if (isLoading) return <full-screen LoadingAnimation>` gate. Mutations
already update local state optimistically (`applyInsertedEntries`, direct
`setFoodEntries`) rather than refetching. This matches the prompt's assumed
architecture (client cache layer is feasible; not per-request server-rendered),
so **no stop was required — proceeding to Phase 1.**
