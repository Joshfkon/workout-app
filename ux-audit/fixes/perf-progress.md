# P1-2 perf progress — running LCP table

Method: `next build` + `next start`, Lighthouse 12 node API, default mobile
config (Moto-G-class, 4× CPU throttle, slow-4G simulation), authed via session
cookies, localhost server + **remote** Supabase. Same harness as the audit's
PERF.md. Run-to-run variance on data-bound routes is high (±1.5s observed)
because LCP waits on live Supabase round-trips.

## Plan items (from PERF.md, ranked) and status

| # | Item | Status |
|---|------|--------|
| 1 | LoadingAnimation hydration fix | ✅ P1-1 commit — 0 hydration errors on all 8 routes |
| 2 | Skeletons for dashboard data zones | ➖ deferred — perceived-only; does not move LCP. Recommend with item 5 |
| 3 | Code-split heavy pages | ✅ history: recharts split out (−99 KB first-load). Nutrition barcode: AddFoodModal was ALREADY dynamic (audit assumption wrong) — scanner now defers further (modal-open → barcode-tab-open) but first-load KB unchanged. Analytics inline charts + workout/[id] internals deferred (higher-risk refactors) |
| 4 | Paginate + cache data layer | ✅ history paginated (20/page + "Load older workouts"); workout page exercise-history capped (~10 blocks/exercise, was unbounded); analytics per-time-range cache (range flips no longer refetch) |
| 5 | Server-render first paint | ❌ NOT attempted — week-scale structural change. This is where the remaining LCP lives |

## Bundle first-load JS (from next build) — real, reproducible wins

| Route | Before | After | Δ |
|---|---|---|---|
| /dashboard/history | 305 KB | **206 KB** | **−99 KB** |
| /dashboard/nutrition | 319 KB | 319 KB | 0 (modal already split; see above) |
| /dashboard/workout/[id] | 462 KB | 465 KB | +3 KB (P0-2/3/5 features added this phase) |

## LCP per route (ms) — audit baseline vs after items 1+3+4

| Route | Audit | Now | Read |
|---|---|---|---|
| /login (control) | 2449 | 2451 | stable — confirms harness comparability |
| /dashboard/log | 3918 | 3918 | unchanged |
| /dashboard/workout/new | 4522 | 4527 | unchanged |
| /dashboard/history | 4190 | 4063 | −127; bundle −99 KB but LCP is fetch-bound |
| /dashboard | 6357 | 6491 | within variance |
| /dashboard/mesocycle | 5958 | 6342 | within variance; see CLS note |
| /dashboard/nutrition | 4675 | 6488 | Supabase-latency variance (nutrition runs 13 queries) |
| /dashboard/settings | 4271 | 6318 | variance |
| /dashboard/analytics | 6378* | 6378 | *audit run had lost auth; now measured properly |

## Honest conclusion (per the stop condition)

**The plan is exhausted short of item 5, and authed routes are NOT under
2.5s LCP.** Items 1–4 delivered correctness (hydration) and real bundle/query
wins, but the audit's diagnosis stands: every dashboard route ships a shell,
hydrates, THEN fetches from Supabase — the LCP element is client-fetched text,
so no amount of bundle-splitting or query-capping moves it below 2.5s. The
structural fix is PERF.md item 5: move first-paint reads into the Server
Components that wrap these pages (the pattern already exists — `/dashboard`
seeds `DashboardClient` with server-fetched `initialData`) page by page:
log → history → nutrition → mesocycle → settings. Estimated ~1 day per page;
each converted page should land in the ~1.5s class (shell FCP is already 0.9s).

## New finding surfaced by the hydration fix

`/dashboard/mesocycle` now shows **CLS 0.417** (reproduced 3×; was 0 in the
audit). The shifting node is a page content card (`div.rounded-xl`, not the
loading animation): with hydration no longer discarding the SSR tree,
Lighthouse can now observe the page's progressive data pop-in, which shifts
below-fold cards as sections arrive. Pre-existing behavior, newly measurable.
Fix belongs with item 2/5 (reserve space or skeleton the mesocycle cards).
Smaller echo on `/dashboard` (CLS 0.074 → 0.13).
