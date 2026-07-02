# Item 6 — server-render first paint for /dashboard and /dashboard/log

**Outcome: neither route is under 2.5s LCP. Below is the specific, measured
reason — and it is NOT what PERF item 5 assumed.** I executed the server-render
change on /dashboard anyway (it's a real improvement and the correct
foundation); it did not move lab LCP, and the trace explains why.

## What I changed (kept)

- Extracted the weekly per-muscle volume computation to a shared pure module
  (`app/(dashboard)/dashboard/_lib/weeklyVolume.ts`).
- Added `fetchWeeklyMuscleVolume` server action; added it to the dashboard's
  server-side `Promise.all` and passed it through `initialData`. The atrophy
  card (the dashboard's LCP element) now has its data **server-side** and
  renders into the streamed HTML — confirmed by curl: the card's text is in the
  server response (full doc in ~1.3s unthrottled). Previously this data was
  fetched client-side after hydration.
- Converted `AtrophyRiskAlert` from `dynamic({ssr:false})` to a **static
  import** (it's the LCP element; you don't code-split your LCP element, and the
  dynamic boundary was flashing its skeleton over the SSR'd card during
  hydration).

## What the trace says (why LCP didn't move)

Lighthouse LCP-element phase breakdown, /dashboard (representative, 3 runs
~6.5s):

| Phase | Time | Share |
|---|---|---|
| TTFB | 452 ms | 7% |
| Load Delay | 0 ms | 0% |
| Load Time | 0 ms | 0% |
| **Render Delay** | **6161 ms** | **93%** |

Network waterfall: **every request finishes by ~1.36s** (HTML + all Supabase
fetches). The LCP element is a text node (no image → Load Time 0). So the
browser has the content and all bytes by ~1.4s but **does not paint the LCP
element until ~6.6s** — 6.1s of pure Render Delay.

/dashboard/log is the same shape: LCP 4.5s, Render Delay 4.0s (90%), network
done early.

**Render Delay with network idle = the main thread is busy.** The LCP content
lives inside a client-component tree (a `<Suspense>`-streamed 650KB
`DashboardClient` on /dashboard; a client-fetched launcher on /log). App-Router
streams the Suspense content as inline chunks that the **client** React runtime
must download, parse, and process before the content enters the live DOM.
Under Lighthouse's 4× CPU + slow-4G throttle, loading+hydrating that bundle
finishes at ~6s — and only then does the LCP text paint. (TBT looks modest
because the blocking is spread across streaming/hydration rather than a few
long tasks, but the paint is still gated on it.)

**Proof it's not data-fetch:** I made three fetch-side changes on /dashboard
(data into initialData → ssr:true → static import). LCP stayed 6.0–6.6s across
all three. The blocker is downstream of data entirely.

## The real fix (beyond a targeted per-route edit)

To get these two under 2.5s, the LCP content must paint from the **initial
server HTML flush without waiting on the big client bundle**. Two levers, both
structural:

1. **Shrink the client bundle on the LCP path.** `DashboardClient` is a
   ~1500-line client component pulling recharts-adjacent and many child
   widgets into one chunk (650 KB first-load). Splitting the below-fold,
   interactive widgets (trackers, modals, charts) out of the critical hydration
   path so the above-fold content hydrates against a much smaller bundle would
   cut Render Delay directly. This is a real refactor, not a config flip.
2. **Render the LCP card as static server HTML outside the hydration-gated
   tree.** Move a lightweight, non-interactive atrophy summary into the page
   shell above the `<Suspense>` boundary (awaiting its data before Suspense —
   trading ~1s of TTFB for the card being in the first flush). This changes the
   page layout (card moves above the fold) — a UX decision I did not make
   unprompted.

Both exceed "a targeted change to two routes," which is why I stopped at the
infrastructure + diagnosis. My server-volume change is the prerequisite for
option 2 and a genuine reduction in client work regardless.

## Recommendation

Treat dashboard LCP as a **bundle-reduction** project, not a data project. The
audit's PERF.md item 5 ("server-render first paint") is necessary but not
sufficient here — the dominant cost is client hydration of a large bundle
(Render Delay), which server-rendering the data alone doesn't address. If you
want me to proceed, say which lever (1 bundle-split or 2 static-card-hoist) and
I'll scope it as its own effort.
