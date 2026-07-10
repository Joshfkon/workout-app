# Loading-states work — final report

## Goal

Kill blocking, full-viewport loading states on navigation to already-seen data.
Move dashboard data views to a **cached-first / stale-while-revalidate** model
(React Query in-memory cache + IndexedDB persistence). Full-screen "heart"
loaders are now reserved for the first-ever load with an empty persisted cache.

## Before → after

| Surface | Before (fetched on every mount/param change) | After (cached) |
|---|---|---|
| **Eat / nutrition** (#1) | 13-query `Promise.all` in `useEffect([selectedDate])`; whole page returned a full-screen spinner on **every day switch** | Per-day food log is `['nutrition','day',dateKey]` with `keepPreviousData` (instant switch, skeleton only for never-fetched days); date-independent context is one cached `['nutrition','global']` query; adjacent days prefetched; persisted to IndexedDB. Full-screen heart only on first-ever empty-cache load. |
| **exercises** (#4) | Full `exercises` catalog refetched into state on every mount → "Loading exercises…" each revisit | `['exercises','catalog']`, infinite `staleTime`, persisted → revisit renders instantly |
| **history** (#2) | Page 0 of `workout_sessions` refetched on every mount → full-screen loader | `['history','sessions','page0']` cached + seeded; pagination still appends; edits/deletes write through the cache |
| **analytics** (#3) | profile + DEXA + photos + coaching refetched on every mount → full-screen "Loading your analytics…" | `['analytics','main']` bundle cached (5-min staleTime), seeded into state; DEXA save invalidates |
| **templates/[id]** (#5) | Template refetched on every `[id]` mount → `min-h-screen` spinner on each open/switch | `['templateDetail', id]` cached; `loadTemplate()` now refetches it so all edit handlers keep the cache fresh |

## Infrastructure added

- `components/providers/QueryProvider.tsx` — single `QueryClient` at the
  dashboard shell, wrapped in `PersistQueryClientProvider`.
- `lib/query/queryClient.ts` — client factory, `PERSISTED_QUERY_PREFIXES`
  allow-list, `IMMUTABLE_GC_TIME`.
- `lib/query/idbPersister.ts` — IndexedDB persister (idb-keyval); only
  allow-listed nutrition/history/analytics/exercises/template queries are
  written to disk (nothing auth-sensitive).
- `hooks/useNutritionData.ts` — the Eat page's per-day + global queries.
- New deps: `@tanstack/react-query`, `@tanstack/react-query-persist-client`,
  `@tanstack/query-async-storage-persister`, `idb-keyval`.

## Verification

Playwright (390px, `ux-audit/verify/`, real app + mocked Supabase — see that
dir's README for the two-cookie auth bypass):

- `nutrition-dayswitch.mjs` — **13/13**: cold start, today→yesterday→
  day-before→today, per-day data changes, quick-add updates totals
  (630→930 kcal), warm reload; a MutationObserver fails if the full-screen
  testid ever appears during a switch.
- `exercises-revisit.mjs`, `history-revisit.mjs`, `analytics-revisit.mjs`,
  `template-revisit.mjs` — each **1/1**: no full-page loading testid on an SPA
  revisit. Before/after screenshots in `ux-audit/verify/screens/`.
- `npm test` → **2441/2441** after every change; `npx next build` clean.

## Regression checklist — re-verified

The 7 commits touch **only** the five data pages + the query infra +
`ux-audit/` (`git diff --name-only 7e1e684^..HEAD`). They do **not** touch the
active-workout page, Zustand stores, or the offline outbox.

1. One-tap set logging — untouched (active-workout page out of scope). ✓
2. Rest timer mechanics — untouched; `RestTimer.test.tsx` green. ✓
3. Per-set DB persistence + outbox + sync glyphs — untouched;
   `setOutbox.test.ts` green. ✓
4. Nutrition quick-add + undo toast — quick-add updates totals immediately
   (verified 630→930); undo uses the same `mutateFoodEntries` cache-write
   path. ✓
5. Dashboard date handling — unchanged; only fetching/caching changed, not how
   dates are computed (reused `getLocalDateString`). ✓
6. Adaptive TDEE / nutrition-derived calcs — read the same queries (now inside
   the cached global bundle), no new stale inputs. ✓

## Deliberately deferred (with reasoning)

- **templates list (#6, P1)** and **settings (#7, P1)** — live/editable data,
  lower traffic; can adopt the same pattern opportunistically. Not required to
  clear the P0 goal.
- **DashboardClient (#8, P2)** — already effectively fixed: the server
  component passes `initialData`, so the client early-return never fires in
  normal navigation.
- **mesocycle (#9)** — already skeleton-based (CLS-optimized), not a spinner.
- **body-composition (#10) / coaching (#11)** — redirect stubs, no data fetch.
- **workout/new, pricing, exercises/add, onboarding (P2)** — cold-start-only,
  low traffic; deferred.
- **Active workout session (#12)** — intentionally never touched (live
  Zustand/outbox state; riskiest to disturb, explicitly out of scope).

## Guardrail

- `CLAUDE.md` → "Loading States & Data Caching (cached-first)" documents the
  rule: full-viewport loaders are cold-start-only; new data views use
  `useQuery` + cached-first, gated `if (isLoading && !query.data && !isRestoring)`.
- `ux-audit/verify/lib.mjs#assertNoReloadSpinner` is a reusable helper that
  fails when a page's loading testid appears on an SPA revisit.
