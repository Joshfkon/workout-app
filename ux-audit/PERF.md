# HyperTrack Performance Audit — July 2, 2026

**Setup.** `next build` + `next start` (production), Lighthouse 12 via node API, default mobile config: Moto-G-class emulation, 4× CPU throttle, simulated slow-4G. Authenticated via session cookies. Server on localhost — **real Supabase latency is additive; treat every LCP below as a best case.** Raw reports: `lh-results/*.json`.

## Lighthouse results per route (mobile, throttled)

| Route | Perf score | FCP | **LCP** | TBT | CLS | Speed Index | Transfer | Script |
|---|---|---|---|---|---|---|---|---|
| `/login` | 98 | 0.9 s | 2.45 s | 0 ms | 0 | 1.4 s | 242 KB | 207 KB |
| `/` (landing) | 92 | 1.5 s | 3.09 s | 0 ms | 0 | 3.2 s | 243 KB | 207 KB |
| `/dashboard/log` | 88 | 0.9 s | **3.92 s** | 10 ms | 0 | 1.5 s | 818 KB | 728 KB |
| `/dashboard/history` | 86 | 1.1 s | **4.19 s** | 14 ms | 0 | 1.9 s | 748 KB | 675 KB |
| `/dashboard/settings` | 85 | 1.1 s | **4.27 s** | 7 ms | 0 | 2.5 s | 712 KB | 649 KB |
| `/dashboard/workout/new` | 84 | 0.9 s | **4.52 s** | 17 ms | 0 | 1.4 s | 732 KB | 666 KB |
| `/dashboard/nutrition` | 81 | 1.1 s | **4.68 s** | 50 ms | 0.081 | 2.4 s | 859 KB | 795 KB |
| `/dashboard/mesocycle` | 78 | 0.9 s | **5.96 s** | 34 ms | 0 | 2.0 s | 766 KB | 692 KB |
| `/dashboard/analytics`* | 78 | 0.9 s | 6.17 s | 32 ms | 0 | 2.2 s | 732 KB | 656 KB |
| `/dashboard` (home) | 76 | 0.9 s | **6.36 s** | 33 ms | 0.074 | 2.1 s | 723 KB | 650 KB |

\* analytics run lost auth and partially measured the login redirect — directional only.

**Reading:** TBT and CLS are healthy — this is not a jank problem. FCP ≈ 1 s everywhere — the shell arrives fine. **Every authed route then blows the 2.5 s LCP budget by 1.5–4 s** because the LCP element is client-fetched text: shell → hydrate 650–800 KB JS → Supabase queries → content. The pattern is architectural (client components with `useEffect` fetching), so it applies uniformly.

## Bundle weight (from `next build`)

Shared baseline: 88.4 KB — good. Problem pages (first-load JS):

| Route | First-load JS | Why |
|---|---|---|
| `/dashboard/workout/[id]` | **462 KB** | The mid-workout page. 44.8 KB page code + recharts/framer/modals eagerly bundled |
| `/dashboard/workout` | 355 KB | Duplicate hub of /dashboard/log (199 KB) |
| `/dashboard/analytics` | 342 KB | recharts, all five tabs' components up front |
| `/dashboard/nutrition` | 319 KB | scanner libs (`@zxing`, `html5-qrcode`) likely eager |
| `/dashboard/history` | 305 KB | charts modal bundled with list |
| `/dashboard/settings` | 297 KB | all four tabs + import/export eager |

## Five slowest interactions observed (live walkthrough)

1. **History → workout detail:** full-screen "Loading workout…" spinner, multi-second (fetches session + blocks + all historical sets for every exercise, unpaginated) — `flow-history-02-detail.png`.
2. **Cold load of Home:** 6.4 s LCP; five widget queries after hydrate; phantom-continue card logic runs before paint settles.
3. **Analytics time-range switch:** refetches the entire nested query tree per click, no cache, no skeleton (analytics/page.tsx:847-1145) — blank gap between clicks.
4. **Blank workout start:** full-screen "Starting workout…" spinner blocks on session INSERT + full exercise-library fetch before showing anything (`flow-workout-02-empty-workout.png`).
5. **Every page with a loading state:** hydration mismatch (LoadingAnimation `Math.random()`) forces React to re-render the tree client-side — double work on the slowest devices, plus content flash.

## Top 5 fixes, ranked by impact ÷ effort

| # | Fix | Effort | Impact |
|---|---|---|---|
| 1 | **LoadingAnimation hydration fix** — pick the random animation in `useEffect` (or seed deterministically). One file, ~10 lines. | ~30 min | Removes forced client re-render + console noise on 6+ routes; free LCP win everywhere it fires |
| 2 | **Skeletons for the five dashboard data zones** (home cards, history list, analytics tabs, workout detail). Perceived-perf: FCP is already 1 s; give the eye structure instead of blank/spinner. | ~1 day | Perceived LCP drops dramatically even before real fixes |
| 3 | **Code-split the heavy pages** — `next/dynamic` for recharts blocks, barcode scanner, SessionSummary, modals; kill the `/dashboard/workout` duplicate hub. Target: workout/[id] 462→~250 KB, nutrition 319→~230 KB. | 1–2 days | Directly shortens hydrate-then-fetch chain on the workout and nutrition paths |
| 4 | **Paginate + cache the data layer** — history: last 20 sessions with infinite scroll; exercise history: last 10 sessions; analytics: cache per time-range in memory (or SWR), don't refetch on tab/range revisit. | 2–3 days | Fixes the two worst live interactions (#1, #3); scales with user tenure instead of degrading |
| 5 | **Server-render the first paint** — move initial reads for Home/log/history into the Server Components that already wrap these pages (dashboard/page.tsx does this partially), pass as props; client takes over for interactions. | ~1 wk, incremental per page | The structural LCP fix: content in the HTML, 6.4 s → ~1.5 s class results |

Honorable mention: precache route shells in `sw.js` and add the offline outbox (REPORT P0-2) — as much a data-integrity fix as a perf one.
