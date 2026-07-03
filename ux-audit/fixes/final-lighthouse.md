# Final Lighthouse — July 3, post merge-prep (production build, mobile-throttled)

Setup identical to the audit: `next build` + `next start` (port 3001),
Lighthouse 12 node API, Moto-G-class emulation, 4× CPU, slow-4G, authed via
session cookie. Raw reports refreshed in `lh-results/` (timestamps July 3 —
this closes the evidence gap where perf-item-6's numbers had no saved
artifacts). Runner: `ux-audit/lh-run.mjs`; CLS diagnostics:
`ux-audit/lh-cls-diag.mjs`.

| Route | Score | FCP | LCP | TBT | CLS | vs. SUMMARY final table |
|---|---|---|---|---|---|---|
| /login | 97 | 0.9s | 2.53s | 36ms | 0 | ≈ (2.77) |
| / | 94 | 1.5s | 3.08s | 0ms | 0 | ≈ (2.94) |
| /dashboard/log | 88 | 0.9s | 3.92s | 9ms | 0 | = (3.91) |
| /dashboard/history | 86 | 0.9s | 4.22s | 13ms | 0 | = (4.21) |
| /dashboard/settings | 85 | 0.9s | 4.42s | 7ms | 0 | improved (6.68 → 4.42) |
| /dashboard/workout/new | 84 | 0.9s | 4.53s | 16ms | 0 | ≈ (4.29); CLS 0.085 → 0 |
| /dashboard/nutrition | 81 | 1.2s | 4.66s | 64ms | 0.082 | improved (7.54 → 4.66)* |
| /dashboard/analytics† | 78 | 0.9s | 6.05s | 35ms | 0.002 | directional |
| /dashboard/mesocycle | **79** | 0.9s | **5.57s** | 15ms | **0** | **57 → 79; CLS 0.417 → 0** |
| /dashboard | 76 | 0.9s | 6.50s | 51ms | 0.078 | = (6.33); CLS 0.13 → 0.078 |

\* data-bound routes vary ±1.5s run-to-run with live Supabase RTT (the
audit noted the same).
† analytics lost auth mid-run and partially measured the login redirect —
same caveat as the original audit run; treat as directional.

**Mesocycle CLS:** 0 in the full-suite run AND in two dedicated diagnostic
runs post-skeleton-change (zero raw LayoutShift trace events, not just
below-threshold — see `fixes/mesocycle-cls/EVIDENCE.md`).

**LCP status (unchanged diagnosis):** authed routes remain
fetch-after-hydrate / Render-Delay-bound (`fixes/perf-item6.md`: 93% Render
Delay, network idle by ~1.4s). Getting `/dashboard` and `/dashboard/log`
under 2.5s requires the bundle-split or static-LCP-card lever scoped in that
doc — a product/effort call, flagged in REVIEW.md open items.
