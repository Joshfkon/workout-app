# Final Lighthouse — July 3, post merge-prep (production build, mobile-throttled)

Setup identical to the audit: `next build` + `next start` (port 3001),
Lighthouse 12 node API, Moto-G-class emulation, 4× CPU, slow-4G, authed via
session cookie. Raw reports refreshed in `lh-results/` (timestamps July 3 —
this closes the evidence gap where perf-item-6's numbers had no saved
artifacts). Runner: `ux-audit/lh-run.mjs`; CLS diagnostics:
`ux-audit/lh-cls-diag.mjs`.

(Refreshed after round 2's `d631071`; previous same-day run in git history.)

| Route | Score | FCP | LCP | TBT | CLS | vs. SUMMARY final table |
|---|---|---|---|---|---|---|
| /login | 98 | 0.9s | 2.46s | 2ms | 0 | ≈ (2.77) |
| / | 94 | 1.5s | 3.08s | 0ms | 0 | ≈ (2.94) |
| /dashboard/log | 88 | 0.9s | 3.92s | 22ms | 0 | = (3.91); **2.1–2.2s devtools** |
| /dashboard/history | 86 | 0.9s | 4.21s | 10ms | 0 | = (4.21) |
| /dashboard/settings | 86 | 0.9s | 4.28s | 5ms | 0 | improved (6.68 → 4.28) |
| /dashboard/workout/new | 84 | 0.9s | 4.58s | 10ms | 0 | ≈ (4.29); CLS 0.085 → 0 |
| /dashboard/nutrition | 81 | 1.1s | 4.79s | 40ms | 0.082 | improved (7.54 → 4.79)* |
| /dashboard/analytics† | 78 | 0.9s | 6.18s | 27ms | 0.008 | directional |
| /dashboard/mesocycle | **77** | 1.1s | 6.48s | 48ms | **0** | **CLS 0.417 → 0** (LCP varies ±1.5s run-to-run: 5.57–6.82 across the day) |
| /dashboard | **81** | 1.2s | 4.75s* | 41ms | 0.078 | **76 → 81; simulated-LCP floor — see addendum; 1.7–2.2s devtools, observed LCP == FCP** |

\* data-bound routes vary ±1.5s run-to-run with live Supabase RTT (the
audit noted the same).
† analytics lost auth mid-run and partially measured the login redirect —
same caveat as the original audit run; treat as directional.

**Mesocycle CLS:** 0 in the full-suite run AND in two dedicated diagnostic
runs post-skeleton-change (zero raw LayoutShift trace events, not just
below-threshold — see `fixes/mesocycle-cls/EVIDENCE.md`).

**LCP status:** superseded for /dashboard and /dashboard/log by commit
`d631071` — see the addendum below and `perf-item6.md`.

---

## Addendum (July 3, round 2) — /dashboard + /dashboard/log under target

After `d631071` (Suspense/loading.tsx removal + redundant client volume
re-fetch removal), measured on the final production build with **real**
DevTools throttling (4× CPU + slow-4G actually applied, observed paints,
remote Supabase):

| Route | LCP (devtools, observed) | Note |
|---|---|---|
| /dashboard | **1.7–2.2s** across 3 runs | observed LCP **== FCP** — the atrophy card paints in the first flush |
| /dashboard/log | **2.1–2.2s** across 2 runs | launcher was already first-flush HTML |

Raw reports: `lh-results/dashboard-devtools.json`, `log-devtools.json`.

**Why the simulated table above still shows ~4.7s for these routes:** the
default Lighthouse method ("simulate"/Lantern) doesn't observe throttled
paints — it models them, and its LCP graph includes every script that
finished before the *observed* (unthrottled) LCP timestamp. On localhost the
entire JS payload loads before first paint, so Lantern prices react-dom +
@supabase + Next runtime (~510KB of the 725KB) into LCP no matter where the
content actually paints. The observed metrics inside the simulated runs
confirm the reality: `observedLargestContentfulPaint == observedFCP`
(~1.1s unthrottled). Both numbers are kept here for comparability with the
audit's original (simulated) tables.
