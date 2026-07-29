# Set logging is slow on cellular — diagnosis (Phase 0–2, no fix applied)

**Status: diagnosis only.** No behavior has been changed. The only code added is
no-op-by-default timing instrumentation (`lib/debug/setLogTiming.ts` + tagged
call sites) and a measurement harness
(`lib/debug/__tests__/setLogLatencyHarness.test.ts`), both removable in one
commit — grep `setLogTiming`.

## TL;DR

The hypothesis is confirmed, with one refinement: the path is not just
enqueue-*and*-await — it is **probe-and-await, then insert-and-await**. When
`navigator.onLine` is `true` (which it is on any barely-usable cell
connection), logging a set performs **two serial, awaited network round trips**,
and the UI is behind both:

1. The **set row does not render until a `set_number` max() read returns.** The
   "optimistic" local commit sits *after* an awaited network read.
2. The **rest timer does not start, and the whole logger row stays disabled,
   until the `set_logs` insert returns** (plus, on last-set AMRAP candidates, a
   third awaited `auth.getUser()` round trip).

Neither request has a timeout, so a stalled cellular request holds the UI for
the WKWebView default (~60 s). The IndexedDB outbox engages **only** when
`navigator.onLine === false` or after the insert has already failed with a
network-shaped error — i.e. never for the degraded-but-connected user. Wifi
hides all of this because both round trips complete in tens of milliseconds.

`t1 − t0` tracks the network RTT ≈ 1:1 (measured below). That is the bug.

---

## Phase 0 — critical-path trace

Tap → visible row + running rest timer, in execution order. "Awaited by UI"
means the render path cannot proceed until the step settles.

| # | Step | Kind | Awaited by UI? | Evidence |
|---|------|------|----------------|----------|
| 1 | Log tap → `completeLoggedSet` guard + `setIsCompletingSet(true)` — **entire logger row disables** | sync local | — | `components/workout/ExerciseCard.tsx:1631-1644`, `:3316` (`disabled={isCompletingSet}`) |
| 2 | `lightHaptic()` | fire-and-forget | no | `ExerciseCard.tsx:1647` |
| 3 | `await onSetComplete(...)` → page's `handleSetComplete` | — | **yes** (lock held until it returns, +100 ms) | `ExerciseCard.tsx:1651`, `:1666`; wired at `app/(dashboard)/dashboard/workout/[id]/page.tsx:5558-5560` |
| 4 | Quality/rest-prescription computation | sync local | yes (trivial) | `page.tsx:2142-2191` |
| 5 | **`set_number` probe: `select max(set_number)` from `set_logs`** | **network read** | **yes — blocks everything after it** | `page.tsx:2200-2225` (`await supabase.from('set_logs').select('set_number')…single()` at `:2206-2214`, gated on `navigator.onLine` at `:2198`) |
| 6 | Optimistic local commit: `setCompletedSets`, `setCurrentSetNumber`, `logSetToStore`, glyph → `saving` | sync local (Zustand + React state) | this **is** t1 — but it happens *after* step 5 | `page.tsx:2285-2288` |
| 7a | *(offline only)* `await enqueueSetInsert` → IndexedDB put | IDB write | yes (single-digit ms) | `page.tsx:2314-2318` |
| 7b | *(online)* **`await supabase.from('set_logs').insert(row)`** | **network write** | **yes** | `page.tsx:2321-2336`; network-error fallback enqueues at `:2339-2344` |
| 8 | Joint-pain event insert (if flagged) | network write | no (`void`) | `page.tsx:2369-2380` |
| 9 | Rest timer starts (`startWorkingRest`) / superset advance | sync local | — this is the timer moment, **after step 7b** | `page.tsx:2447` (normal flow), `:2417/:2434/:2442` |
| 10 | Sanity checks, calibration bookkeeping | sync local | yes (trivial) | `page.tsx:2452+` |
| 11 | *(AMRAP-eligible last sets only)* **`await supabase.auth.getUser()`** | **network read** (`/auth/v1/user`) | yes — holds the button lock, timer already running | `page.tsx:2526` |
| 12 | Handler returns → +100 ms → logger row re-enables | — | — | `ExerciseCard.tsx:1666` |

So on cellular: row renders after ~1 RTT, rest timer after ~2 serial RTTs,
inputs unlock after 2–3 serial RTTs — each with no timeout.

### The eight specific questions

**1. Optimistic or not.** Optimistic in structure, not in ordering. The row
renders from local state (`completedSets` React state + `logSetToStore`
Zustand, `page.tsx:2285-2288`) — no React Query cache involved — but that
commit is sequenced *after* the awaited network probe (step 5), and the caller
`await`s the whole mutation before re-enabling input (step 3). So the
"optimistic" update is behind one network round trip, and the interaction lock
is behind two.

**2. Outbox gating.** Exactly one condition chooses outbox vs direct write:
`const online = typeof navigator === 'undefined' || navigator.onLine`
(`page.tsx:2198`). `!online` → enqueue (`:2314`); otherwise direct insert, with
a *reactive* fallback to the outbox only if the insert already failed with a
network-shaped error (`isNetworkError`, `:2339`). No Capacitor `Network`
plugin, no RTT/quality signal. As hypothesized: on a barely-usable cell
connection `navigator.onLine` is `true`, so the outbox never engages until a
request has already burned its (unbounded) wait.

**3. Timeouts.** None on the hot path. `lib/supabase/client.ts` creates the
browser client with no custom fetch/AbortController, and supabase-js v2.87's
`fetchWithAuth` adds headers only (`node_modules/@supabase/supabase-js/dist/main/lib/fetch.js`)
— no timeout. The probe and the insert both wait for the platform default
(WKWebView ≈ 60 s). The *outbox flush* path, by contrast, already caps every
op at 10 s (`OP_TIMEOUT_MS`, `lib/offline/setOutbox.ts:267-280`) — the durable
path is the one that already has the right behavior.

**4. Auth on the hot path.** Yes, two ways. (a) Every PostgREST request goes
through `fetchWithAuth` → `_getAccessToken()` → `await this.auth.getSession()`
(`supabase-js/dist/main/SupabaseClient.js:71,179-184`); when the JWT is within
the expiry margin, `getSession` → `__loadSession` **awaits an inline token
refresh** (`auth-js/dist/main/GoTrueClient.js:1195-1223`) — an extra serial
round trip in front of the probe *and/or* insert. This fires exactly in the
beta-tester scenario: phone locked/backgrounded through rest periods long
enough for the auto-refresh timer to miss. (b) The AMRAP branch awaits
`supabase.auth.getUser()` — always a network call — while the input lock is
held (`page.tsx:2526`).

**5. Post-success fan-out.** None — this is *not* a cause. No
`invalidateQueries`/refetch runs on a set write; the only workout-screen
invalidation is at workout completion (`onCompletionSynced` →
`invalidateWorkoutDerivedCaches`, `page.tsx:4435`). Suggestion card, e1RM
display, volume totals, and the history strip all derive from local state /
mount-fetched data and never show loading states after a set.

**6. Prescription is client-side.** Confirmed not a network read. Next-set
prefill comes from `recommendSet`/`prescribe`
(`services/setRecommender.ts`) computed in `ExerciseCard` memos from
`completedSets` + the `exerciseHistories` map fetched **once** at session load
(`page.tsx:416`, `fetchExerciseHistory` on mount / on exercise add at
`:3830-3845`). No per-set server read exists.

**7. Capacitor transport.** Webview `fetch`. `capacitor.config.ts` does not
enable the `CapacitorHttp` plugin, so nothing routes through the native bridge
and no app-level request queue exists (concurrency is the browser stack's).
The one *logical* serializer is `isCompletingSet` — one slow set-log blocks
the next tap by design. Note the iOS shell loads the **hosted** app
(`server.url: https://hypertrack.app`), so cellular latency also applies to
any code/chunk fetches, but that is separate from the per-set path.

**8. Outbox flush behavior.** Sound, and not a contention source. Triggers:
dashboard-shell mount + `online` event (`components/dashboard/DashboardLayoutClient.tsx:38`),
workout-page mount + `online` + a 5 s poll that flushes only while the queue is
non-empty (`page.tsx:352-374`). Policy: serial, oldest-first; per-op 10 s
timeout; on network error keeps the entry, increments `attempts`, **breaks**
the loop (no hammering); server rejections retry ≤ 5 times then drop; per-tab
in-flight dedupe (`flushSetOutbox`, `setOutbox.ts:288-297`); insert dedupe via
client-generated UUID + `ignoreDuplicates` upsert. No exponential backoff
(fixed 5 s cadence) — acceptable. Enqueues are independent IDB puts and cannot
be blocked by a failing flush.

### Why wifi feels instant

On wifi both awaited round trips are ~15–40 ms, so tap→row ≈ 30 ms and
tap→timer ≈ 60 ms — under perception thresholds. At 400 ms RTT the same code
is 400/800 ms; with 1% loss + a TCP retransmit or an inline token refresh,
multi-second; with a stalled request, up to ~60 s with the row frozen.

---

## Phase 1 — instrumentation and measurement

### Instrumentation (in this branch, off by default)

`lib/debug/setLogTiming.ts`, called from `handleSetComplete` and
`ExerciseCard.completeLoggedSet` (every call site commented `setLogTiming`).
Enable with `localStorage.setItem('ht:set-timing', '1')` (or build with
`NEXT_PUBLIC_SET_LOG_TIMING=1`); per-set phase rows accumulate in
`window.__setLogTimings` and `console.table` on each set; marks/measures also
land on the Performance timeline for remote Safari/Chrome profiling. Phases:
`t0_tap`, `probe_sent/done`, `t1_local_commit`, `t1_painted`,
`t2_outbox_enqueued`, `t3_insert_sent`, `t4_insert_done`,
`auth_getuser_sent/done`, `t5_handler_done`.

### Measurement

This diagnosis environment has no Supabase credentials and no iOS device, so
the throttled numbers below come from the committed harness
(`lib/debug/__tests__/setLogLatencyHarness.test.ts`,
`npx jest lib/debug/__tests__/setLogLatencyHarness.test.ts`), which executes
the exact awaited control flow traced above (with file:line refs inline)
against a fake Supabase costing a configurable RTT per request, alongside the
outbox-first shape using the **real** `lib/offline/setOutbox` module and its
**real `idbDriver`** (jsdom is given an IndexedDB via `fake-indexeddb`, so the
outbox-first numbers include the production `indexedDB.open` + readwrite
transaction per enqueue, not the in-memory fallback). Real wall-clock timers;
5 sets per condition, averaged. An on-device Network Link Conditioner run with
the flag enabled will reproduce the same shape with device constants added
(expect a real WKWebView IndexedDB put to cost single-digit ms — visible as
`t2_outbox_enqueued`); the harness numbers are the architecture's floor.

| Profile | Path | RTT (ms) | t1 row rendered (ms) | rest timer started (ms) | t5 handler done (ms) | requests |
|---|---|---:|---:|---:|---:|---:|
| wifi | current | 30 | **31** | 62 | 62 | 10 |
| wifi | outbox-first | 30 | **0** | 1 | 1 | 5 |
| Slow 4G | current | 400 | **401** | 801 | 801 | 10 |
| Slow 4G | outbox-first | 400 | **0** | 0 | 0 | 5 |
| Very Bad Network | current | 1200 | **1201** | 2402 | 2402 | 10 |
| Very Bad Network | outbox-first | 1200 | **0** | 0 | 0 | 5 |

Stall case (one request hangs 5 s — capped for test speed; the real path has
**no** cap): current path starts the rest timer at **5402 ms**; outbox-first
at **0 ms**.

**`t1 − t0` tracks RTT ≈ 1:1 on the current path** (31/401/1201 ms at
30/400/1200 ms RTT) **and stays flat at ~0 ms outbox-first — the durable IDB
enqueue costs ≤1 ms in-process.** The UI is on the network's critical path.
Also note the request count: the current path sends 2 requests per set
(probe + insert); outbox-first sends 1.

---

## Phase 2 — root causes and proposed minimal fix (not implemented)

### Root causes, ranked

1. **Awaited `set_number` probe before the optimistic commit**
   (`page.tsx:2200-2225`). Sole reason the *row itself* is slow. Cost: 1 RTT
   (+ inline token refresh when stale), no timeout.
2. **Awaited insert before the rest timer and input unlock**
   (`page.tsx:2321-2336` + `ExerciseCard.tsx:1651,1666,3316`). Sole reason the
   *timer* is slow and the row is locked. Cost: 1 RTT, no timeout.
3. **`navigator.onLine` gates the outbox** (`page.tsx:2198`) — the durable
   path (which already has timeouts, retry, dedupe) never engages when
   degraded-but-connected.
4. **No timeout on the direct path** — converts "slow" into "frozen for up to
   ~60 s" on a stall.
5. **Auth on the hot path** — inline JWT refresh ahead of hot-path requests
   after backgrounding; awaited `auth.getUser()` in the AMRAP branch
   (`page.tsx:2526`).

Explicitly disproved: post-success refetch fan-out (none), network-read
prescriptions (client-side), Capacitor native-bridge serialization (webview
fetch), outbox flush contention (isolated, already well-behaved).

### Proposed minimal fix — agrees with the expected shape

The expected fix shape is right, and the codebase already contains its
template: the mid-workout deload toggle enqueues to the outbox
unconditionally and flushes in the background (`page.tsx:4480-4503`). Apply
the same inversion to `handleSetComplete`:

1. **Outbox is the only write path for sets.** Delete the `online` branch:
   local commit → `enqueueSetInsert` → glyph `queued` → start rest timer →
   `void flushSetOutbox(...)` (+ existing mount/online/poll flushers). Nothing
   between tap and timer touches the network; glyphs go
   `queued → syncing → synced` via the existing `reconcileSetSync`.
   Client-generated UUID + `ignoreDuplicates` upsert already makes
   double-flush safe (DO-NOT-BREAK #4 holds by construction).
2. **Drop the per-set `set_number` probe** from the hot path. Local numbering
   (`currentSetNumber`) is already the offline fallback and already floors the
   DB max. The probe's only value — cross-device concurrent logging into the
   same block — is a rare case whose worst outcome (cosmetic duplicate
   `set_number`, ids stay unique) can be reconciled at flush/summary time if
   it matters; it does not justify 1 RTT × every set × every user.
3. **Connectivity only schedules flushes** (`online` event + poll — already
   implemented); it never gates enqueue.
4. **Timeout/backoff:** already covered on the flush path (10 s per op,
   attempts counter, break-on-network-error). With (1), the un-timeouted
   direct insert ceases to exist on the session path. Optionally add mild
   backoff to the 5 s poll for repeatedly-failing entries.
5. **Hot-path auth cleanups:** replace the AMRAP branch's awaited
   `auth.getUser()` with the session's already-known `userId`
   (`session.userId` is in scope), keeping the whole handler network-free.
6. **Post-write refetches:** none exist; keep it that way (no new
   `invalidateQueries` on the set path).

Small consequences to handle in the fix (why it's not *purely* mechanical):
the joint-pain event currently attaches `set_log_id` only when the row is
known persisted (`page.tsx:2315-2318` comment, `:2369`) — with outbox-first it
should either always omit the FK (current queued-set behavior) or be enqueued
after the set row flushes; and the server-rejection rollback branch
(`page.tsx:2345-2356`) moves from log-time to flush-time, where the existing
≤5-attempts drop policy applies (a glyph-level `failed` surface can follow
up separately).

### DO-NOT-BREAK check for this phase

No behavior changed: instrumentation is a no-op unless the debug flag is set
(guard at `lib/debug/setLogTiming.ts:55-63`). Verified: `tsc --noEmit`
introduces no new errors (one pre-existing error in
`hooks/__tests__/useWorkoutMuscleVolume.test.ts` exists on `main` — CI runs
jest, not tsc, so it doesn't surface there);
`lib/offline/__tests__/setOutbox.test.ts` +
`components/workout/__tests__/ExerciseCard.test.tsx` — 105 tests pass. The
Playwright throttled/offline before-vs-after run belongs to the fix phase
(there is no "after" yet, and this environment has no app credentials to run
the live app).
