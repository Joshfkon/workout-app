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

---

## Addendum (July 3, second session) — corrected diagnosis + executed fix

Two findings sharpen the above, one of which changes the fix:

**1. /dashboard: the content was never in the *visible* first flush.** A
no-JS Playwright load showed `<main>` completely empty. The server HTML
carries the hero card only as a **hidden streamed Suspense segment**
(`<div hidden id="S:0">`) that the **final inline `$RC` script in the body**
swaps into place. Inline scripts execute in parse order on the main thread —
and under Lighthouse's 4× CPU throttle that last script queues behind the
async framework chunks' execution. That is the precise mechanism of the
"93% Render Delay": all bytes arrive by ~1.4s, but the swap that makes the
card *visible* runs at ~6s. Not hydration per se — script-execution
contention delaying a script-driven reveal.

**Fix executed:** removed the page's `<Suspense>` boundary and the
route-level `loading.tsx` — the page now awaits its ~450ms of data before
flushing, so the card is plain visible HTML in the first flush and LCP
collapses toward FCP. Trade: cold-load TTFB rises by the fetch time;
client-side tab switches keep the previous screen during load (App Router
default), which reads as a normal page transition. Measured result in
`fixes/final-lighthouse.md`.

**2. Bundle-split headroom is near zero — lever 1 retracted.** Chunk-level
breakdown of /dashboard's 725KB (uncompressed): react-dom 169KB +
@supabase-js 222KB + Next runtime/polyfills 122KB + shared UI ~130KB; the
page's own code is **43KB**, and every modal/tracker was already
`next/dynamic`. There is no meaningful below-fold code left to split — the
"650KB DashboardClient chunk" framing in the original doc was wrong; it's
framework + Supabase, which hydration needs regardless.

**3. /dashboard/log needs no server-render work** — its launcher (including
the LCP element) is already plain visible HTML in the first flush (no
template/$RC in the response). Its ~3.5s Render Delay is main-thread paint
contention while ~700KB of shared JS executes — the only real lever left for
it is shrinking @supabase-js/framework cost or deferring hydration, both
platform-level projects out of scope here.
