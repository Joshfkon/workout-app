# Cold-start boot measurement harness

Measures the real cold-start timeline of the production build — the
`performance.mark('boot:*')` instrumentation in `lib/perf/bootTrace.ts` plus a
network waterfall and a screenshot filmstrip — under a simulated mid-range
phone (4x CPU throttle, 40ms asset RTT, 250ms Supabase RTT).

## Running

```bash
# 1. Mock Supabase (auth + PostgREST with injectable latency; serves the Next
#    server's server-side calls too, which Playwright interception can't).
node ux-audit/perf/mock-supabase.mjs &          # LATENCY_MS=250 default

# 2. Production build + server pointed at the mock.
NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="fake-anon-key" \
  npx next build && npx next start &

# 3. Measure. Cold = fresh context (no sessionStorage/IndexedDB/HTTP cache).
node ux-audit/perf/measure-boot.mjs cold1            # first-ever boot
node ux-audit/perf/measure-boot.mjs warm1 --warm     # returning-user boot
```

Output: the `boot:*` mark timeline (js-eval, app-mount, auth-start/-resolved,
data-start/-first-batch/-resolved, home-paint), paint timings, a per-request
waterfall, and a filmstrip in `./boot-shots/` (CDP screencast frames — real
capture timestamps; note they're relative to script start, so in `--warm` runs
the second navigation's frames start mid-sequence).

On a real device: set `localStorage.bootTrace = '1'` and the timeline is
console.table'd when Home paints; `window.__BOOT_TRACE__` holds the raw tuples.

## Baseline vs. fixed (2026-07, this simulation)

| milestone            | before | after (first-ever) | after (returning) |
|----------------------|-------:|-------------------:|------------------:|
| first paint (splash) |  0.83s |              0.75s |             0.32s |
| home-paint (content) |  5.5s  |              3.1s  |             0.87s |

The fixes: no boot-time `getUser()` round trips (local session identity — the
three serial getUser calls also blocked the REST batch behind supabase-js's
auth lock), the `/` redirect trusts the session cookie, `/dashboard/log` renders
from the persisted React Query cache (`['log','home']`) with background
revalidate, the hero-meta tail became a non-gating dependent query, and the
native Capacitor splash is the single loading surface (manual hide on
`boot:home-paint`).
