# Phase 6 — Full Home Dashboard Card Audit

**Scope:** every card on the Home dashboard (`app/(dashboard)/dashboard/DashboardClient.tsx`,
fed by `lib/actions/dashboard.ts` via `app/(dashboard)/dashboard/page.tsx`).

**Trigger:** Weekly Volume changed **71/88 → 87/88 sets** and "muscles below MEV"
**14 → 12** across a force-quit **with no new workout logged**. A value that
recomputes differently on a fresh launch is the same class of bug as the
previously-fixed nutrition card.

For each card this document records:
1. **Data source** — live selector / cached summary / card-local computation
2. **Time bucketing** — how "today"/"this week" is defined (week start, local vs UTC, rolling vs calendar)
3. **Subscription** — re-derives on store change, or only on mount/launch?
4. **Root cause** where the card is implicated in the 71→87 discrepancy.

A **status** tag marks each card: ✅ fixed in this pass · ⚠️ residual issue documented · ✔️ already correct.

---

## The shared machinery (read this first)

Two rules the architecture is being moved toward:

> **Cards may not own computations.** Each card renders the output of a shared
> pure selector (`computeWeeklyMevSummary`, `computeWeekSessions`,
> `computeWeightRate`, `computeLiftTrends`, `buildAnchoredBodyCompTrend`, …) that
> the detail page also uses. One source of truth per number.

> **All time bucketing goes through `lib/date/localDay.ts`.** "Today" and "this
> week" are LOCAL and STABLE — a window depends only on *which local day* it is
> computed on, never on the time of day, so the same data yields the same number
> across a relaunch.

`lib/date/localDay.ts` (added this pass):

| Export | Meaning |
|---|---|
| `WEEK_STARTS_ON = 1` | **Documented week-start constant: Monday** (ISO-8601). One place; every week key/window moves together. |
| `localDay(d?)` | local `YYYY-MM-DD` (same as `getLocalDateString`) |
| `startOfLocalDay(d?)` | local midnight of that day |
| `localWeekStart(d?)` / `localWeekKey(d?)` | Monday-anchored week start / its `YYYY-MM-DD` key |
| `rollingWindowStart(days,d?)` / `rollingWindowStartISO(...)` | trailing-N-day window anchored to **local midnight**, not the wall clock |
| `localDaysBetween(a,b)` | whole local days between two dates |

The volume selector exports `weeklyVolumeWindowStartISO()` (built on
`rollingWindowStartISO(7)`) as the single window every volume consumer filters
`completed_at` against.

---

## 1. Weekly Volume + "muscles below MEV" ✅ (the reported bug)

**Data source.** Card-local render of a **shared selector** over live `set_logs`.
`MetricTileGrid` (`components/dashboard/home/MetricTileGrid.tsx:243-254`) renders
`volume.totalSets / volume.totalTarget` and `volume.lowCount`, where `volume =
computeWeeklyMevSummary(muscleVolume)` (`DashboardClient.tsx:602`). `muscleVolume`
comes from three query sites:

- **Server initial-data** — `lib/actions/dashboard.ts:fetchWeeklyMuscleVolume` → `computeWeeklyMuscleVolume`.
- **Client full-fetch** — `DashboardClient.tsx` (~1147) — *previously inlined its own accumulation.*
- **Detail page** — `components/dashboard/WeeklyMevSummary.tsx` (the tile's tap-through, on `/dashboard/volume`) → same shared pipeline.

**Time bucketing.** Originally every site computed
`weekStart = new Date(); weekStart.setDate(getDate()-6); .gte(completed_at, weekStart.toISOString())`
— a rolling `now − 6 days` **UTC instant re-evaluated at each render's execution
moment**. No stable anchor: the window slid every second.

**Subscription.** None on the workout store. Derived once from `muscleVolume`
state. On a normal SSR relaunch the client **fast path** (`DashboardClient.tsx:772`)
returns early and keeps the server value verbatim; the client only recomputes on
a no-`initialData` load or a post-midnight rollover. The `DASHBOARD_CACHE`
localStorage writes `muscleVolume: []` and is skipped when `initialData` exists,
so it is **not** a stale-value source; `workoutStore` persist holds only the
active session.

**Root cause of 71 → 87.** Two independent defects, both now fixed:

1. **Non-deterministic window.** The lower bound was a live `now` timestamp, so
   the set of sessions inside `[now−6d, now]` depended on the exact instant of
   render. Two renders on the same day (morning → evening relaunch) legitimately
   queried different windows.
2. **Divergent computation between paths.** The client full-fetch path built
   `target` from a `volumeTargets` table (values 8–12) while the server/detail
   path used **MEV** targets (sum = 88). Because `computeWeeklyMevSummary.totalTarget`
   sums `mv.target`, an SSR load showed `…/88` and a client-full-fetch load showed
   a different denominator. `status:'low'` classification also differed
   (`sets > target*1.3` vs `sets > target*1.5`), which feeds `lowCount` — the 14↔12 flip.

   Both observed values carried denominator **88**, i.e. both came from the
   **server** pipeline at two different instants → **87 (the fresh relaunch value)
   was correct; 71 was a stale / partial snapshot** (most consistent with a session
   that was still `in_progress` at the first render finalizing to `completed`
   before relaunch, or the earlier value never being re-derived).

**Fix applied.**
- All three query sites now call `weeklyVolumeWindowStartISO()` → a **local-midnight-anchored**
  trailing-7-day window. Stable for the whole local day → relaunch-invariant.
- The client full-fetch path now calls `computeWeeklyMuscleVolume(weeklyBlocks)` —
  the identical shared pipeline. The divergent `volumeTargets` table is deleted.
  Server, client, and detail page are now **one function over one window**.
- Rounding note: `totalSets` sums per-muscle `Math.round` values in all paths
  (identical everywhere), so rounding contributes at most ±1–2 sets and never
  differs by path — it was never the 16-set driver.

**Guaranteed by test:** `_lib/__tests__/weeklyVolume.relaunch.test.ts` (parity +
relaunch invariance) and `lib/date/__tests__/localDay.test.ts` (window stability).

---

## 2. Header session counter — "0/5 sessions", "Wk 1 of 5" ⚠️

**Data source.** `computeWeekSessions` (`_lib/weekSessions.ts`) over the
mesocycle's nested `workout_sessions` (`planned_date`, `state`, `completed_at`).
Server: `dashboard.ts:107`. Client: `DashboardClient.tsx:989`. Rendered via
`GlanceHeader` (`sessionsLabel`, `weekContext` — `DashboardClient.tsx:411-418`).

**Time bucketing.** **A different window from the volume card.** `computeWeekSessions`
uses a **mesocycle-relative** 7-day block: `weekStart = Date.parse(start_date) +
(currentWeek-1)*7d`, `weekEnd = weekStart + 7d`. `Date.parse('YYYY-MM-DD')` is
**UTC midnight**, so boundaries are UTC-aligned while `completed_at` is a real
local-evening timestamp. `currentWeek = Math.min(weeksSinceStart, total_weeks)`.

**Subscription.** Mount/fetch only; no store subscription. On the fast path the
client keeps the server value. A relaunch re-queries and can change it.

**Root cause of the "0/5 sessions vs 71 sets" contradiction.** The volume card
proves completed training exists this week (71 sets). The counter reads a
**different, mesocycle-anchored window** and shows 0/5 because:
- `total = 5` is the `days_per_week` **fallback** (`weekSessions.ts:53`), which
  fires precisely because `planned === 0` — no session has a `planned_date` inside
  the mesocycle-week block (ad-hoc/free workouts have `planned_date = null` and
  can never satisfy `plannedInWindow`).
- `done === 0` because once the mesocycle runs past `total_weeks`, `currentWeek`
  is **frozen at `total_weeks`**, so the block `[start+…, start+total_weeks*7d)` sits
  in the past and today's `completed_at` values fall at/after `weekEnd` → excluded.

**The trustworthy number is the volume card's (71 sets).** The counter is
measuring "completions inside a frozen mesocycle block," not "training this
week."

**Recommended fix (not applied — product decision required).** Route the counter
through `localWeekKey` so "this week" means the same local calendar week the
volume card uses, and count completions by `completed_at` in that window
(crediting ad-hoc workouts). Retain "Wk N of M" as mesocycle progress but derive
the *done/total* from the shared week window. This is a behavior change to a
core mesocycle concept, so it is flagged for sign-off rather than changed
silently. `weekSessions.ts` should also parse `start_date` via `startOfLocalDay`
instead of UTC `Date.parse` to remove the ±1-day boundary error.

---

## 3. Nutrition card ⚠️ (reference for the fix pattern)

**Data source.** Card-local reduce over raw `food_log` rows — **not** a shared
selector. The live tile is the "Nutrition" tile in `MetricTileGrid.tsx:174-201`,
fed by `nutritionTotals` state. The reduce is copy-pasted in ≥3 places
(`dashboard.ts:180`, `DashboardClient.tsx` client fetch + cache payload). The
**detail page** (`nutrition/page.tsx`) uses a genuinely shared hook
`computeDailyNutritionSummary` — *which the Home tile does not call*.
(`components/dashboard/streaming/NutritionServer.tsx` is dead code — not imported.)

**Time bucketing.** `logged_at == getLocalDateString()`. **Local**, good — but the
server action computes "today" in the **server** timezone while the client
computes it in the **device** timezone. Rows are written with the device-local
date. When server TZ ≠ device TZ the two "today" strings disagree by a day.

**Subscription.** `useState`, not a store subscription. Fast path trusts the
server number and skips the client re-query. Rollover handled: `dateKey` bumped
by a 60s interval + `visibilitychange` breaks the fast path after midnight, and
an empty rollover refetch resets stale totals to zero (`DashboardClient.tsx:1077`).

**Prior fix (the canonical pattern, from commits `fcd1b4b`, `5f16b2e`).**
1. Bucket per **local day** with `getLocalDateString`, never UTC.
2. **Key every cache and the server-`initialData` fast path by the mount day**
   (`dateKey` vs `initialDateKey`); invalidate on rollover.
3. **Reset to empty on an empty rollover refetch** — never leave yesterday's number.
4. **Load everything the card needs on BOTH paths** (fast + full), or the fast
   path serves a stale default.

**Residual.** The server-TZ-vs-device-TZ "today" can still select different rows
on first paint. Recommended: compute the daily window with the **device** local
day (recompute on the client when `dateKey !== initialDateKey`-style mismatch, or
thread the client TZ to the server action), and extract a single `getDailyNutrition`
selector shared by the tile and the detail page. Same residual applies to any
server-seeded *daily* value (see the localDay module header note).

---

## 4. Weight tile + trend ("+3.0 lb/wk") ⚠️

**Data source.** Shared selector `computeWeightRate` (`_lib/weightRate.ts`) over
`weight_log`. Home tile: `DashboardClient.tsx:586`. Rendered in `MetricTileGrid.tsx:277-285`.

**Time bucketing / smoothing.** OLS **linear regression** over a **21-day window
anchored at the latest weigh-in** (fallback: last 2 entries), slope×7, rounded 0.1.
Not a calendar week — a trailing series window. Units converted per-row via
`getDisplayWeight` (`weight_log` is **not** kg-canonical: it stores raw
`weight` + `unit`).

**Detail-page parity — NOT guaranteed today.**
- The **Nutrition → Weight tab** uses the **same** `computeWeightRate`, but feeds
  it a **30-day** fetch (`nutrition/page.tsx:317`) while the Home tile feeds a
  **90-day** fetch (`dashboard.ts:203`). Because the regression window is anchored
  at the *latest* weigh-in, the two diverge whenever the most recent weigh-in is
  ≳10 days old (Home includes older points the 30-day series dropped). In the
  extreme (no weigh-in in 30 days) the tab returns `null` while the tile still
  shows a rate.
- The **Body-hub `WeightGraph`** uses a **different metric** entirely: first-vs-last
  **delta** over a selectable 7/30/90d window — not a `/wk` regression rate.

**Subscription / relaunch.** `weightRate` re-derives via `useMemo` on
`weightHistory`. But a **relaunch can change it with no new weigh-in**: the
`WEIGHT_HISTORY_CACHE` load (`DashboardClient.tsx:608-621`, 1h TTL) runs
**unconditionally on mount** and overwrites the fresher server-seeded
`weightHistory` with up-to-1-hour-old data, so the recomputed rate differs
between a fresh server render and a cached client render.

**Recommended fix (not applied).** (a) Make the Home tile and the Weight tab draw
from the **same fetch window** (align to 90d, or a shared `getWeightSeries`
selector). (b) Gate the `WEIGHT_HISTORY_CACHE` load on `!hasInitialData` (as the
`DASHBOARD_CACHE` load already is) so cached data never clobbers the fresher
server seed. (c) Keep the regression window anchored via a documented constant.

---

## 5. Body Comp card ✔️ (already correct)

**Data source.** `fetchBodyCompGlance` (`dashboard.ts:245`) →
`buildAnchoredBodyCompTrend` + `computeFFMI` + `analyzeBodyCompTrend`. Server-only,
seeded in `initialData.bodyCompGlance`.

**Time bucketing.** 365-day `weight_log` window + all scans; "latest" = last point
of the anchored trend (most recent weigh-in projected from the last DEXA scan).
kg-canonical via `inputWeightToKg`.

**Subscription.** Server-computed, re-derives on every relaunch. It **intentionally**
shifts as weigh-ins accumulate after the last scan (documented at
`dashboard.ts:62-72`) — that is not a bug, it is the anchored-trend design.

**Parity.** The detail page (`analytics/page.tsx` via `useBodyCompTrend`) uses the
**same engine over the same 365-day window** and takes the same last trend point.
Card and detail agree by construction. **No change needed.** (Internal note: the
*displayed* FFMI is raw `computeFFMI().ffmi` while the trend arrow uses normalized
FFMI — but that is identical on both surfaces, so no Home-vs-detail divergence.)

---

## 6. Lifts / program-status tile ✔️

**Data source.** Shared selector `computeLiftTrends` (`_lib/liftTrends.ts`) over a
**12-week** (`LIFT_TREND_WINDOW_DAYS`) window of completed sessions. Server:
`dashboard.ts:fetchLiftTrends`. Client full-fetch: `DashboardClient.tsx:1189` —
**same helper**, same window constant, same `programStartDate` gating. Both pass a
`new Date()` "now", but the window is 12 weeks so a same-day time-of-day shift is
immaterial to the verdict. No divergent inline copy. Considered consistent; the
window could still be routed through localDay for uniformity (low priority).

---

## 7. Recovery / readiness ⚠️

**Data source.** The Home **readiness pill** (`GlanceHeader`,
`readinessScore={checkInStatus==='done' ? checkInReadiness : null}`,
`DashboardClient.tsx:1432`) = `readinessFromCheckIn` → `calculateReadinessScore`
(`services/fatigueEngine.ts`, pure) over **today's** `daily_check_ins` row. The
`MuscleRecoveryCard` is **not on Home** — it lives on the analytics page.

**Time bucketing / inputs.** The pill reads only the day's check-in (sleep,
quality, mood, energy) keyed on the **local** `dateKey`. It passes **no recent
volume** and no `daysSinceLastSession`/`previousSessionRpe`, so those fall to
constant defaults in the engine — the pill's "recovery" sub-score is a constant
and consumes **no volume data at all**. `DailyCheckIn` writes/reads with the same
`getLocalDateString()` local day — consistent with the pill.

**The `MuscleRecoveryCard` (analytics)** reads a **7-day UTC-instant** window
(`useMuscleRecovery.ts:195`, `sevenDaysAgo.toISOString()`) with `now = new Date()`
at compute time — a **third** "recent" window, distinct from the volume tile's
window and the volume page's `useWeeklyVolume` local-midnight-string window.

**Subscription / relaunch.** The pill is deterministic from the stored row on a
given local day (a midnight-rollover relaunch **hides** it — new day, no check-in —
rather than changing the number). The `MuscleRecoveryCard` **does change on
relaunch with no new data**: `recoveryPercent` grows with elapsed wall-clock time
and muscles flip to "Ready" as workouts age out of the rolling 7-day window.

**Recommended fix (not applied).** (a) If readiness should reflect training load,
feed it the shared weekly-volume output rather than leaving `daysSinceLastSession`
at a default. (b) Route `useMuscleRecovery`'s window and `useWeeklyVolume`'s window
through the **same** `localDay` helper as the volume tile so all three "recent"
windows coincide.

---

## Cross-card consistency matrix

| Requirement | Status | Notes |
|---|---|---|
| Weekly Volume sets == Train-history sets for the same window | ✅ enforced | One `computeWeeklyMuscleVolume` + one `weeklyVolumeWindowStartISO()` across server/client/detail. |
| "0/5 sessions" agrees with the volume week window | ⚠️ documented | Counter uses a frozen mesocycle block; volume is trustworthy. Fix flagged for product sign-off (§2). |
| Weight trend from the same series/smoothing/window as detail | ⚠️ documented | Same `computeWeightRate` but 90d (tile) vs 30d (tab) fetch; cache clobber on relaunch (§4). |
| Recovery inputs read post-fix canonical data | ⚠️ documented | Pill consumes no volume; MuscleRecoveryCard uses a divergent window (§7). |
| "Muscles below MEV" deterministic — 14↔12 flip impossible | ✅ enforced | Single pipeline + single MEV target table + stable window; covered by relaunch test. |
| Body Comp card == detail page | ✔️ already true | Shared anchored-trend engine (§5). |

## What changed in this pass

- **`lib/date/localDay.ts`** — new local-day/local-week module with the documented
  `WEEK_STARTS_ON = Monday` constant, `localWeekKey`, and a local-midnight-anchored
  rolling-window helper. Tests: `lib/date/__tests__/localDay.test.ts`.
- **`_lib/weeklyVolume.ts`** — `weeklyVolumeWindowStartISO()`, the single window
  every volume consumer uses.
- **`lib/actions/dashboard.ts`**, **`DashboardClient.tsx`**,
  **`components/dashboard/WeeklyMevSummary.tsx`** — all three volume query sites use
  the shared window; the client's divergent inline accumulation is replaced by
  `computeWeeklyMuscleVolume`.
- **Tests** — `_lib/__tests__/weeklyVolume.relaunch.test.ts` (card↔detail parity +
  relaunch invariance).

## Follow-ups (ranked)

1. **Session counter → shared local week** (§2) — resolves the "0/5 vs 71"
   contradiction. Needs product sign-off (changes mesocycle-week semantics).
2. **Weight tile: align fetch window + gate the history cache on `!hasInitialData`** (§4).
3. **`getDailyNutrition` shared selector + device-local "today" for server-seeded
   daily data** (§3) — also closes the nutrition server-TZ residual.
4. **Unify the three "recent-volume" windows** (volume tile, `useWeeklyVolume`,
   `useMuscleRecovery`) on `localDay` (§7).
5. Route the Lifts 12-week window through `localDay` for uniformity (§6, low priority).
