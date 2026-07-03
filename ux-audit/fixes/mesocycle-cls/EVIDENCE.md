# Mesocycle CLS 0.417 — no longer reproducible; skeleton hardening applied

## What the audit measured (July 2, 17:04)

`lh-results/dashboard_mesocycle.json`: CLS **0.417**, attributed to a single
element — the "How Your Program Works" card
(`div.space-y-6 > div.rounded-xl`, height 1061px) moving after first paint.
SUMMARY note 3 called it progressive card pop-in, pre-existing, to be fixed
alongside skeletons/PERF-5.

## Re-measurement on the current branch (July 3, pre-skeleton, commit c869338)

Three consecutive Lighthouse runs (mobile emulation, 4× CPU + slow-4G,
production build, same account state — active "Cutting Block - Upper/Lower"
mesocycle with a today's-workout card, verified in-browser):

| Run | LCP | CLS | LayoutShift trace events |
|---|---|---|---|
| 1 | 6.62 s | **0** | **0** |
| 2 | 5.73 s | **0** | **0** |
| 3 | 4.75 s | **0** | **0** |

Diagnostic runner: `ux-audit/lh-cls-diag.mjs` (dumps every raw LayoutShift
trace event with impacted-node rects; saved lhr:
`lh-results/mesocycle-cls-diag.json`). Zero events — not merely
below-threshold shifts.

**Honest read:** none of the 12 commits between the two measurements touched
this page's load path, so the original 0.417 was most likely timing-dependent
(the spinner→content swap landing across two frames under CPU contention —
the audit machine's near-full C: drive is a plausible contributor) rather
than fixed by code. It is not reproducible today; there was nothing to
bisect a fix against.

## Hardening applied anyway (commit 68d4c2c)

The spinner→content swap the trace implicated is still structurally
timing-dependent, so per the audit's own recommendation (PERF item 2 /
SUMMARY note 3) the loading state is now **two skeleton cards approximating
the loaded layout** (today card + overview with stat grid, progress bar,
week strip) instead of a short spinner card. The swap can no longer move
content that's already on screen, whatever the frame timing.

## Post-change verification

See the final Lighthouse table (fixes/final-lighthouse.md): mesocycle CLS
re-measured on the rebuilt production bundle after this change — expected 0,
and the skeleton is visible in the LH filmstrip during load.
