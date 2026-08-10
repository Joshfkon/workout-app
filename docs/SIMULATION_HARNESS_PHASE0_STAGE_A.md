# Simulated-User Testing Harness — Phase 0, Stage A audit

**Status:** AUDIT ONLY. No production code was changed by this report.
**Scope of Stage A:** 0.1 Clock audit · 0.3 Entry-point audit · 0.5 State-isolation audit.
**Stage B (0.2 determinism, 0.4 mutation-boundary, 0.6 idempotency) is in a companion
report: [SIMULATION_HARNESS_PHASE0_STAGE_B.md](./SIMULATION_HARNESS_PHASE0_STAGE_B.md)**,
which also records the decisions taken on the three open questions in §5 below.

Repo snapshot: branch `claude/hypertracker-simulation-phase-0-8smabx`, 666 non-test
`.ts`/`.tsx` files under `app/ components/ hooks/ lib/ services/ stores/ types/`.

---

## 0. Headline findings (read this first)

**H1 — The Phase 0 stop condition is NOT triggered.** Every calculation module
named in the stop condition (prescription, fatigue/recovery, trend, progression,
volume accounting) is already a pure function of its inputs and contains **zero**
references to `Date.now()` / `new Date()` / `Date.parse()`:

| Module | implicit-`now` refs |
|---|---|
| `services/setRecommender.ts` (2224 lines — the live prescription engine) | 0 |
| `services/progressionEngine.ts` | 0 |
| `services/volumeTracker.ts` | 0 |
| `services/effectiveVolume.ts` | 0 |
| `services/shared/volumeCredit.ts` (canonical set-credit) | 0 |
| `services/shared/trend.ts` | 0 (parses supplied dates only) |
| `services/fatigueEngine.ts` | 0 |
| `services/fatigueBudgetEngine.ts` | 0 |
| `services/mesocycleBuilder.ts` | 0 |
| `services/setPrescription.ts`, `repRangeEngine.ts`, `progressionScope.ts`, `weeklyProgressionEngine.ts`, `phaseAssessment.ts`, `sessionBuilderWithFatigue.ts` | 0 |
| `services/muscleRecovery.ts` | `now: Date` is a **required** parameter |
| `services/deloadEngine.ts` | `now: Date` is a **required** parameter |
| `services/plateauDetector.ts` | `referenceDate` is an **optional** parameter (defaults to newest data point, not wall clock) |

`services/suggestionEngine/e1rmAnchor.ts` goes further and documents an explicit
design property we can lean on: the anchor "moves ONLY when training happens (a
session enters or displaces the window) — never with wall-clock time, and it is
pure/deterministic." Clock injection therefore only has to reach **callers**, not
calculations. Phase 1 needs no change to any prescription/volume/fatigue/trend math.

**H2 — The real Phase 1 cost is the entry-point audit, not the clock.** There is no
production callable for `getPrescription`, `logSet`, `editSet`, or `deleteSet`.
That logic lives inline in two React files:

- `components/workout/ExerciseCard.tsx` (4705 lines) — the ONLY caller of
  `recommendSet()` in the codebase (line 711), plus all of its input assembly.
- `app/(dashboard)/dashboard/workout/[id]/page.tsx` (7176 lines) — `handleSetComplete`
  (line 2503, ~470 lines), `handleSetEdit` (3071), `handleDeleteSet` (3173).

Everything else the driver needs already exists as an injectable production function
(see §2). Extraction is required, but it is *four* extractions, not a rewrite.

**H3 — `set_logs` has NO soft-delete.** `handleDeleteSet` issues a hard
`DELETE` (`page.tsx:3208`). The only `deleted_at` columns in the schema are on
`exercises` (merge soft-delete) and `activity_feed`. This directly affects the
Phase 3 assertion "soft-deleted sets do not contribute to active aggregates" and
the "messy editor" persona — the harness must match production semantics (hard
delete), not assume soft-delete.

**H4 — Pre-existing integrity divergence found (reported, not fixed).**
`handleDeleteSet` renumbers the surviving sets' `setNumber` to a dense `1..n`
**in local/Zustand state only** — no `set_number` UPDATE is issued to the DB
(`page.tsx:3175–3197` vs `:3202–3212`). After a mid-session delete, in-memory
set numbering and persisted `set_logs.set_number` disagree until reload. Since
`set_number` participates in `UNIQUE(exercise_block_id, set_number)` and in the
DB-max probe at `page.tsx:2578`, this is a legitimate Phase 3 INVARIANT candidate.
**Per constraint 9 this is reported only. No fix is proposed as part of harness work.**

**H5 — State isolation is achievable but needs one seam.** Supabase browser clients
are module-level singletons whose URL/key are captured at module load
(`lib/supabase/client.ts:6–7, 27–28`), and two production paths construct their own
client internally rather than accepting one: `ProgramEngine` (`programEngine.ts:137`)
and `fetchExerciseHistory` (`_lib/suggestions.ts:562`). Per-process isolation works
today (one Jest worker = one module registry); **concurrent simulations inside a
single process do not**.

---

## 1. Clock/time audit (0.1)

### 1.1 Method and scope

Raw counts across `app/ components/ hooks/ lib/ services/ stores/ types/`, excluding tests:
`Date.now()` — 96 sites · `new Date()` (zero-arg) — 258 sites · `new Date(x)` (all forms) — 573 sites.

The great majority are **out of simulation scope** (nutrition/TDEE, body composition,
DEXA, social feed, subscriptions/Stripe, wearable integrations, UI animation) or are
**date parsing of supplied data** (`new Date(row.completed_at)`), which is not a clock
dependency. The tables below enumerate **every** site in the training-engine scope:
`services/` (training modules), `lib/training/`, `lib/date/`, `lib/utils.ts`,
`app/(dashboard)/dashboard/workout/**`, `app/(dashboard)/dashboard/mesocycle/**`,
`components/workout/**`, and the training hooks.

Classification: **(a)** engine logic · **(b)** data layer · **(c)** UI only.

### 1.2 Class (a) — engine logic. MUST be simulation-controlled.

| File:Line | Usage | Classification | Injection needed? | Proposed boundary | Blast radius |
|---|---|---|---|---|---|
| `services/weightEstimationEngine.ts:938` | `Date.now()` — 28-day freshness gate on the cached estimated-max for the canonical exercise key | (a) | **Yes** | `now` param on `WeightEstimationEngine` ctor/method, defaulting to `clock.now()` | Cold-start weight suggestions only; used by `startMesocycleSession`, workout page |
| `services/weightEstimationEngine.ts:948` | same gate on the legacy/original-name cache key | (a) | **Yes** | as above | as above |
| `services/weightEstimationEngine.ts:1017` | `Date.now()` — 28-day recency filter selecting "recent history" for direct estimation | (a) | **Yes** | as above | Changes which sessions feed a cold-start estimate |
| `services/weightEstimationEngine.ts:1080` | `Date.now()` — recency weighting `exp(-ageDays/14)` in `selectBestEstimate` | (a) | **Yes** | as above | Directly scales the estimate value |
| `services/performanceTracker.ts:259` | `new Date()` − 56d — 8-week stagnation window | (a) | **Yes** | `now` param on `checkForStagnation` / tracker ctor | Stagnation signal (Plateauer persona) |
| `services/performanceTracker.ts:275` | `Date.now()` — `weeksStagnant` computation | (a) | **Yes** | as above | Signal text + `priority` threshold (≥6 weeks ⇒ high) |
| `services/plateauDetector.ts:583` | `new Date().toISOString()` — `detectedAt` on the emitted alert | (a)/(b) | **Yes** (trace determinism) | `referenceDate` already threaded; reuse it for the stamp | Alert payload only; matters for byte-identical replay traces |
| `services/phasePlanning.ts:86` | `now: Date = new Date()` default | (a) | **Default only** | Callers pass `clock.now()`; keep default | Phase boundary planning |
| `lib/training/mesocycleProgress.ts:42` | `today: Date = new Date()` default | (a) | **Default only** | Callers pass `clock.now()` | Mesocycle week/progress derivation |
| `lib/training/weeklyRollover.ts:474` | `loadWeeklyMuscleSignals(..., now: Date = new Date())` — derives this/last/prev week windows | (a) | **Default only** | Caller passes `clock.now()` | Weekly ±1 set adjustment (week-boundary assertions) |
| `lib/training/trainingSchedule.ts:212` | `nextTrainingDate(..., from: Date = new Date())` | (a) | **Default only** | Caller passes `clock.now()` | Which calendar dates are training days |
| `lib/training/programEngine.ts:62` | `const today = new Date()` (module-scope helper) | (a) | **Yes** | Parameterize helper | Program generation |
| `lib/training/programEngine.ts:287` | `new Date()` − 4 weeks — history window in `loadUserData` | (a) | **Yes** | `ProgramEngine` ctor option | Recovery factors / weight recs |
| `lib/training/programEngine.ts:1395` | `const today = new Date()` in `getTodayWorkout` | (a) | **Yes** | ctor option | Which session is "today's" |
| `lib/training/programEngine.ts:1483` | `const now = new Date()` in `checkDeloadTriggers` | (a) | **Yes** | ctor option | Deload trigger evaluation |
| `lib/training/programEngine.ts:1512` | `getLocalDateString()` in `checkDeloadTriggers` | (a) | **Yes** | ctor option | as above |
| `lib/training/startMesocycleSession.ts:456` | `getLocalDateString()` — "is there already a session for today?" + `planned_date` | (a) | **Yes** | `today?: string` on `StartMesocycleSessionInput` | Session identity/resume; **this is the single most important date in the driver's loop** |
| `app/(dashboard)/dashboard/workout/_lib/adhocSession.ts:71` | `getLocalDateString()` — today's ad-hoc session lookup | (a) | **Yes** | `today` arg | Ad-hoc session resume |
| `app/(dashboard)/dashboard/workout/_lib/adhocSession.ts:164` | `now: number = Date.now()` — auto-discard staleness | (a) | **Default only** | Caller passes clock | Abandoned-session handling (Chaotic persona) |
| `app/(dashboard)/dashboard/workout/_lib/adhocSession.ts:216` | `getLocalDateString()` | (a) | **Yes** | `today` arg | as above |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:335` | `useState(() => new Date())` → `recoveryNow`, fed to `computeMuscleRecovery` | (a) | **Yes** | becomes a driver-supplied argument on extraction | Muscle-recovery readiness rows |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:1390` | `new Date()` — `weekInMesocycle` from `start_date` | (a) | **Yes** | extraction | Coach context / week index |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:1749` | `new Date()` − 28d — set-log window for calibration | (a) | **Yes** | extraction | Machine calibration inputs |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:1929` | `new Date()` − 90d — exercise usage counts | (a) | **Yes** | extraction | Swap/browse ordering |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:1970` | `getLocalDateString()` | (a) | **Yes** | extraction | — |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:2216` | `new Date()` → `computeMuscleRecovery(..., now, ...)` at soreness-ask time | (a) | **Yes** | extraction | Soreness-adjustment decision |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:2248` | `useState(() => new Date())` → `volumeNow` | (a) | **Yes** | extraction | Weekly volume window |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:2326` | `Date.now()` − 42d — joint-pain event window | (a) | **Yes** | extraction | Pain-pattern notices |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:2361` | `new Date()` → `getExercisePainPattern(..., now)` | (a) | **Yes** | extraction | as above |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:2410` | `getLocalDateString()` | (a) | **Yes** | extraction | — |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:6167` | `now: new Date()` passed into a readiness/recovery child | (a) | **Yes** | extraction | Readiness display + target selection |
| `components/workout/ExerciseCard.tsx:846` | `referenceDate: new Date()` → `detectPlateau` | (a) | **Yes** | extraction (§2 `getPrescription`) | Plateau/staleness contract (`STALE_AFTER_WEEKS = 6`) |
| `components/workout/ExerciseCard.tsx:863` | `referenceDate: new Date()` → second plateau call | (a) | **Yes** | extraction | as above |
| `app/(dashboard)/dashboard/workout/[id]/_lib/muscleFeedbackWrites.ts:144` | `Date.now() − withinDays·86400000` — recent-muscle-session window driving the soreness ask | (a) | **Yes** | `now` param | Whether a soreness prompt appears at all |
| `app/(dashboard)/dashboard/workout/[id]/_lib/postSessionMeso.ts:89` | `const now = new Date()` — joint-pain window for the weekly flag | (a) | **Yes** | `now` param | ProgramEngine deload trigger 5 |
| `hooks/useMuscleRecovery.ts:126` | `useState(() => new Date())` | (a) | Only if the driver uses this hook | Prefer calling `computeMuscleRecovery` directly | Recovery display |
| `services/exerciseVarietyService.ts:248` | `new Date()` − N days — usage cutoff | (a) | **Yes** | `now` param | Exercise-variety selection (only if the harness exercises swaps) |
| `lib/utils.ts:24` | `getLocalDateString(date: Date = new Date())` | (a) foundation | **Default only** | This is injection boundary **B1** (§1.4) | Every "today" in the app |
| `lib/date/localDay.ts:49,57,66,80,96,103` | `localDay` / `startOfLocalDay` / `localWeekStart` / `localWeekKey` / `rollingWindowStart` / `rollingWindowStartISO`, each `date: Date = new Date()` | (a) foundation | **Default only** | Injection boundary **B1** | Every day/week bucket in the app |

### 1.3 Class (b) — data layer (record/mutation timestamps and persistence defaults)

These do not steer a decision *at the moment they are written*, but they become
engine input on the next read, so the simulation must control them too — otherwise
a 6-month simulated run stamps every row with the real wall clock and every
history window collapses to "today".

| File:Line | Usage | Classification | Injection needed? | Proposed boundary | Blast radius |
|---|---|---|---|---|---|
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:2540` | `set_logs.logged_at` | (b) | **Yes — critical** | `logSet()` extraction takes `loggedAt` | Every history/trend/volume read |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:3161` | `set_logs.edited_at` stamp | (b) | **Yes** | `editSet()` extraction | `staleTargets.isTargetStale` (recalc detection) |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:1578, 2377` | `workout_sessions.started_at` | (b) | **Yes** | `startSession()` / resume path | Session ordering |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:4830, 4938` | `completed_at` snapshot at finish | (b) | **Yes** | `completeSession()` extraction | **Ordering key for all exercise history** (`fetchExerciseHistory` orders by `completed_at`) |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:4151` | `exercise_blocks.skipped_at` | (b) | Yes | extraction | Skip semantics |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:807, 811` | ad-hoc session id + back-dated `started_at` | (b) | Yes | extraction | — |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:988` | `block.createdAt ?? new Date().toISOString()` | (b) | Yes | extraction | Feeds `staleTargets` created-vs-edited comparison |
| `app/(dashboard)/dashboard/workout/[id]/_lib/finishWorkout.ts:131` | `workout_sessions.completed_at` in the optimistic finish patch | (b) | **Yes** | add `completedAt` to `FinishSummaryData` | as above |
| `app/(dashboard)/dashboard/workout/_lib/adhocSession.ts:105, 132, 194` | `started_at`, `auto_discarded_at` | (b) | Yes | `now` param | — |
| `lib/training/startMesocycleSession.ts:504, 524` | `workout_sessions.started_at` (claim + insert) | (b) | **Yes** | `now`/`today` on input | — |
| `lib/training/startTemplateWorkout.ts:214, 240` | `planned_date`, `templates.last_performed_at` | (b) | Yes | `now`/`today` param | — |
| `lib/training/repeatWorkout.ts:56` | `planned_date` | (b) | Yes | `today` param | — |
| `lib/training/programEngine.ts:937, 950` | mesocycle `name` (`toLocaleDateString`), `start_date` | (b) | **Yes** | ctor option | `start_date` anchors interval schedules |
| `lib/training/programEngine.ts:1563, 1581` | `exercise_history.performed_at`, `strength_calibrations.tested_at` | (b) | **Yes** | ctor option | Cold-start estimation inputs |
| `lib/training/coachingService.ts:318` | `completed_at` | (b) | Yes | `now` param | — |
| `lib/training/deloadRecommendation.ts:188` | `deload_recommended_at` | (b) | Yes | `now` param | Deload cadence |
| `lib/training/enhancedAthleteMode.ts:115` | `updated_at` | (b) | Low | `now` param | — |
| `lib/training/transferCandidates.ts:60` | `Date.now() − TRANSFER_LOOKBACK_DAYS·86400000` cutoff | (a)/(b) | **Yes** | `now` param | Cold-start transfer ladder |
| `app/(dashboard)/dashboard/mesocycle/new/page.tsx:93` | `scheduleAnchorDate = getLocalDateString()` → `mesocycles.start_date` | (b) | **Yes** | `createProgram()` extraction | **Anchors interval schedules for the whole meso** |
| `app/(dashboard)/dashboard/mesocycle/new/page.tsx:443` | mesocycle `name` from `toLocaleDateString()` | (b)/(c) | Yes (locale too — Stage B) | extraction | Cosmetic + a locale nondeterminism source |
| `lib/offline/setOutbox.ts:148, 157, 173` | `enqueuedAt: Date.now()` — **flush ordering key** | (b) | **Yes** | `now` param or clock import | Ordering of queued writes (FK safety: sets before motion captures) |
| `lib/actions/exercise-completion.ts:67` | `ai_exercise_completions.created_at` | (b) | Out of scope | — | AI quota only |
| **DB defaults** — `set_logs.logged_at DEFAULT NOW()`, `workout_sessions.created_at DEFAULT NOW()`, `exercise_blocks.created_at DEFAULT NOW()` (`supabase/migrations/20241209000001_initial_schema.sql`); 141 `DEFAULT NOW()`/`CURRENT_TIMESTAMP` occurrences across 137 migration files | (b) | **Yes, by avoidance** | Client always supplies the column explicitly so the default never fires | `exercise_blocks.created_at` is the one currently NOT always client-supplied — it feeds `staleTargets` |

### 1.4 Class (c) — UI only. No simulation control needed.

`hooks/useRestTimer.ts:87,96,113,178,297` · `hooks/useWorkoutTimer.ts:182` ·
`hooks/useDurationTimer.ts:79,106` · `hooks/useKeyboardInset.ts:140,153,184` ·
`lib/utils.ts:98` (`formatDistanceToNow`), `:35–95` (chart tick/date formatting) ·
`lib/utils/staleDeployRecovery.ts:37,39` · `lib/debug/setLogTiming.ts` ·
`_lib/finishWorkout.ts:57,65` (`performance.now()` instrumentation) ·
`_lib/durationEstimate.ts:92` `secondsSinceLastSet` (live duration readout;
`page.tsx:2278` passes `Date.now()`) · `_lib/suggestions.ts:645` (`getHours()` for
greeting text) · `lib/integrations/notifications.ts:93`.

One caveat: `secondsSinceLastSet` reads the wall clock but only feeds the on-screen
duration estimate. If the driver ever asserts on estimated duration it moves to (a).

### 1.5 Proposed injection boundaries

- **B1 — `lib/date/localDay.ts` + `lib/utils.getLocalDateString`.** Both already take
  `date: Date = new Date()`. Making the *default* resolve through a module-level
  `Clock` gives us every day/week bucket in the app for one edit, with zero
  signature churn. 62 zero-arg `getLocalDateString()` call sites and 10 zero-arg
  `localDay`-family call sites become simulation-controlled at once.
  This module is documented as "the single source of truth for how the app buckets
  time into days and weeks" and already pins `WEEK_STARTS_ON = 1` (Monday, ISO-8601)
  — the `today()` semantics the harness spec requires are **already defined here**.
- **B2 — explicit `now`/`today` arguments on the training data-layer functions**
  (`startMesocycleWorkoutSession`, `adhocSession`, `startTemplateWorkout`,
  `repeatWorkout`, `postSessionMeso`, `muscleFeedbackWrites`, `weeklyRollover`,
  `transferCandidates`, `finishWorkout`). Defaulting each to `clock.now()` keeps
  every existing caller source-compatible.
- **B3 — constructor option on `ProgramEngine`** and a `now` option on
  `WeightEstimationEngine` / `PerformanceTracker` (the three stateful classes).
- **B4 — the extracted domain functions from §2** carry `loggedAt` / `completedAt`
  explicitly rather than stamping internally.

**Timezone semantics (already settled by B1, documented for the record):** a "day"
is a calendar day in the *runtime's* timezone; a "week" starts Monday. `localDay.ts`
warns that on the server this is the server's timezone. For v1 the harness should
pin `TZ` (the Jest config already defaults to `America/Denver` specifically to keep
local-vs-UTC bugs visible) and implement `advanceDay()` as a **calendar-day**
increment via `startOfLocalDay` + `setDate(+1)` — not `+24h` — matching
`localDay.addLocalDays`. A DST/timezone scenario suite stays out of scope per
constraint 12.

---

## 2. Entry-point audit (0.3)

Target loop: `createProgram → startSession → getPrescription → logSet →
getNextPrescription → editSet/deleteSet → completeSession → advanceTime → startSession`.

| Operation | Current callable | UI dependency | Extraction required |
|---|---|---|---|
| **createProgram** | Pure planners exist and are already headless: `mesocycleBuilder.generateFullProgram()`, `generateMesocycleRecommendation()`, `calculateRecoveryFactors()`. The **persistence** is an inline `supabase.from('mesocycles').insert({...})` at `app/(dashboard)/dashboard/mesocycle/new/page.tsx:441`, ~90 lines of field assembly inside `handleSubmit`. (`ProgramEngine.generateMesocycle()` at `programEngine.ts:885` also writes a mesocycle but is **not** the path the UI uses.) | **Total** — logic is in `handleSubmit` | **YES.** Extract `createMesocycle(supabase, input)` to `lib/training/`; page calls it. |
| **startSession** (programmed) | `lib/training/startMesocycleSession.ts:430` `startMesocycleWorkoutSession({supabase, mesocycle, todayWorkout, completedSessions})` — already async, already takes an injected `SupabaseClient`, already returns `{sessionId, resumedExisting}` | **None** | **No extraction.** Add `today`/`now` (B2). |
| **startSession** (ad-hoc / template) | `app/(dashboard)/dashboard/workout/_lib/adhocSession.ts`, `lib/training/startTemplateWorkout.ts`, `lib/training/repeatWorkout.ts` — all injectable | None | No extraction; add `now` (B2). |
| **loadSession** (read blocks/sets/history for a session) | `_lib/sessionMapping.ts` (`mapWorkoutSessionRow`, `mapLoadedBlockRow`, `mapSetLogRow`) is pure and extracted, but the **queries** that feed it are inline in `page.tsx` (~lines 1200–1800) | High | **YES.** Extract `loadWorkoutSession(supabase, sessionId)` returning the mapped session + blocks + sets. |
| **loadExerciseHistory** | `_lib/suggestions.ts:555` `fetchExerciseHistory(exerciseId, userId, scope?, exerciseType?)`; `buildExerciseHistories()` / `computeHistoryFromBlocks()` are pure | Low | **Partial.** The function builds its own client (`createUntypedClient()` at `suggestions.ts:562`) — add a `supabase` parameter. |
| **getPrescription** | **None.** `recommendSet()` (`services/setRecommender.ts:885`) has exactly one caller in the entire repo: `components/workout/ExerciseCard.tsx:711`, inside a local closure `recommendNext(last, positionOffset)` (`ExerciseCard.tsx:687–744`). Its inputs (`sessionBestE1RM`, `lastSessionE1RM`, `coldStartE1RM`, `isColdStartExercise`, `sessionObservedSets`, `positionContext`, `effectiveTargetRir`, `repTotalMode`/`repTotalNextSetAt`) are all `useMemo`s in the same component. | **Total** | **YES — the single largest extraction.** Extract a pure `buildPrescriptionInput(...)` + `getPrescription(...)` module (suggested: `services/prescription/sessionPrescription.ts`), have `ExerciseCard` call it, driver calls the same. |
| **getSessionStartPrescription** | `recommendSeedForSlot()` — called from BOTH `lib/training/startMesocycleSession.ts:69` (headless ✔) and `ExerciseCard.tsx:2459` (UI) | Mixed | No extraction needed for the seed itself; the ExerciseCard-side assembly folds into the `getPrescription` extraction. |
| **logSet** | **None.** `handleSetComplete` — `page.tsx:2503`, ~470 lines. Contains: quality classification (2517–2537), `loggedAt` stamping, rest prescription, DB max-`set_number` probe (2578–2596), set-role inference (2600–2607), client UUID, row build, optimistic Zustand + React state, insert / outbox enqueue / rollback, joint-pain event, undo toast, motion capture, dropset chaining, superset advance. | **Total** | **YES.** Extract `logSet(deps, input)` covering: quality, set-role, numbering, row build, persist/enqueue. Leave toasts/timers/motion in the component. |
| **getNextPrescription** | Same as `getPrescription` — re-derived on re-render from `completedSets` | Total | Covered by the `getPrescription` extraction. |
| **editSet** | **None.** `handleSetEdit` — `page.tsx:3071`, ~100 lines (quality recompute, feedback/RIR resync, local+store update, DB update or `updateQueuedSet`, `edited_at` stamp). | Total | **YES.** Extract `editSet(deps, setId, patch)`. |
| **deleteSet** | **None.** `handleDeleteSet` — `page.tsx:3173`. Hard delete; local renumber only (see H4). `undoLoggedSet` (`:3225`) wraps it. | Total | **YES.** Extract `deleteSet(deps, setId)`. |
| **skip / unskip block** | `handleSkipBlock` (`:4141`), `handleUnskipBlock` (`:4165`) — inline | Total | Optional for v1 (Chaotic/Messy personas want it). |
| **swapExercise** | `handleExerciseSwap` (`:3881`) — inline; pure `exerciseSwapper`/`injuryAwareSwapper` underneath | Total | Optional for v1 (Messy-editor persona). |
| **changeTargetSets / repRange** | `handleTargetSetsChange` (`:3420`), `handleRepRangeChange` (`:3505`) — inline | Total | Optional. |
| **completeSession** | `_lib/finishWorkout.ts:168` `submitFinishOptimistic(deps, data)` — injectable supabase, injectable `navigate`/`showClaimPrompt` callbacks | **Low** — already a seam; the page only supplies callbacks | **No extraction.** Add `completedAt` to `FinishSummaryData` (B2/B4). |
| **post-session engine updates** | `_lib/postSessionMeso.ts:44` `runPostSessionMesoUpdates(supabase, input)`; `_lib/sessionWrites.ts` `writePerformanceSnapshots`, `upsertWeeklyFatigueLog`; `lib/training/weeklyRollover.ts:470` `loadWeeklyMuscleSignals(supabase, ...)` | None | No extraction; add `now` (B2). |
| **cancelSession** | `_lib/cancelWorkout.ts:37` `cancelWorkoutSession(...)` — injectable | None | None. |
| **advanceTime** | **Does not exist** | — | Phase 1 `Clock` (B1). |

**Summary:** 5 required extractions (`createProgram`, `loadSession`, `getPrescription`,
`logSet`, `editSet`+`deleteSet`), 1 signature widening (`fetchExerciseHistory`), and
4 optional ones for the Messy-editor persona. Everything else is already callable.

Per the harness spec, each extraction must be **move-not-copy**: the component is
rewritten to call the new function, so the UI and driver share one implementation.

---

## 3. State-isolation audit (0.5)

| Store | Isolation possible? | Timestamp source | Reset strategy | Risk |
|---|---|---|---|---|
| **Supabase / PostgreSQL** (all `set_logs`, `workout_sessions`, `exercise_blocks`, `mesocycles`, `exercise_history`, `strength_calibrations`, `weekly_fatigue_logs`, `session_muscle_feedback`, `joint_pain_events`) | **Per-process yes, in-process no.** `lib/supabase/client.ts` caches `typedClientInstance` / `untypedClientInstance` at module scope (`:6–7`) and reads `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` into module constants at load (`:27–28`). One URL per module registry. | **Client-supplied for every row the workout flow writes** (`logged_at`, `started_at`, `completed_at` are always explicit). DB `DEFAULT NOW()` exists as a fallback on `set_logs.logged_at`, `workout_sessions.created_at`, `exercise_blocks.created_at` — the last of these is the one that can actually fire. | Two viable options: **(i)** local Supabase via `supabase/config.toml` (already present, ports 54321/54322) + `npx supabase db reset` per run — real RLS/constraints/triggers, requires Docker, slow; **(ii)** an in-memory fake `SupabaseClient` implementing the query-builder subset the training paths use. Existing tests already hand-roll per-test stubs (`_lib/__tests__/finishWorkout.test.ts:makeGatedSupabase`). | **Medium.** Option (i) gives real constraint enforcement (`UNIQUE(exercise_block_id,set_number)`, `reps <= 100`, RLS) — valuable for the accounting invariants — but no parallelism without per-run schemas. Option (ii) is fast and trivially parallel but **would not catch DB-constraint violations**, which is exactly the bug class Phase 3.1 targets. **Recommendation: option (i) for the full suite, option (ii) for fast CI + deterministic scenarios.** |
| **`ProgramEngine`** (`lib/training/programEngine.ts:126`) | **No.** Constructor calls `createUntypedClient()` internally (`:137`); no injection point. | — | — | **Flagged per spec.** Persistence is hardwired to the global client. Needs a ctor parameter (B3) in Phase 1. |
| **`fetchExerciseHistory`** (`_lib/suggestions.ts:555`) | **No.** Calls `createUntypedClient()` at `:562`. | — | — | Flagged. Needs a `supabase` parameter. |
| **`WeightEstimationEngine`** (`services/weightEstimationEngine.ts`) | Yes — data is passed in; the caches are **per-instance** (`this.estimatedMaxes`), not module-level. | `lastUpdated: new Date()` at `:1659, 1677, 1692, 1819, 1887` | New instance per simulation | Low — but the 28-day/14-day windows need `now` (B3). |
| **`PerformanceTracker`** (`services/performanceTracker.ts`) | Yes — per-instance `setHistory` / `performanceSignals` | `createdAt: new Date()` (`:217, 243, 288`), `timestamp: new Date()` (`:568`) | New instance | Low; needs `now` (B3). |
| **Zustand `useWorkoutStore`** (`stores/workoutStore.ts:86`) | **No.** Module-level singleton with `persist({name:'workout-storage'})` → `localStorage`. | `SorenessAskRecord.askedAt` ISO strings | `useWorkoutStore.setState(initial)` between runs; jsdom `localStorage` is per-environment | **Medium.** Global singleton ⇒ no in-process parallelism. **Mitigation: the driver should not use it at all.** It is a UI-resume cache, not the system of record — the DB is. Keep the extracted `logSet` free of store writes (the component keeps its `logSetToStore` call). |
| **Zustand `useUserStore` / `useExerciseStore`** | Same shape (module singletons) | — | `setState` reset | Same; same mitigation. |
| **Offline outbox** (`lib/offline/setOutbox.ts`) | **Yes.** Module-level `driver` (`:128`) and `flushInFlight` (`:279`), **but** an explicit test seam already exists: `__setDriverForTests` (used in `finishWorkout.test.ts`), and `createMemoryDriver()` is the automatic fallback when `indexedDB` is undefined. `fake-indexeddb@6` is already a devDependency. | `enqueuedAt: Date.now()` (`:148,157,173`) — **the flush ordering key** | `__setDriverForTests(memoryDriver())` per run | **Low–medium.** `flushInFlight` is a module-global promise; concurrent in-process runs would share it. |
| **`services/exerciseService.ts` cache** (`:164–165` `exerciseCache`, `cacheTimestamp`, 5-min TTL) | **No** — module-level, shared across all users | `Date.now()` (`:185, 201, 815`) | Needs an exported reset, or the harness seeds the exercise catalog once and treats it as immutable | **Low.** Exercise catalog is genuinely global/immutable in a simulation, so sharing is acceptable — but it must be seeded deterministically. |
| **`lib/data/exercisePreferencesService.ts`** (`:33–34`), **`services/exerciseVarietyService.ts`** (`:34–39`) | **No** — module-level `Map`s keyed by `userId`, TTL by `Date.now()` | `Date.now()` | Keyed by user, so distinct simulated users don't collide; TTL still wall-clock | **Low–medium.** Keying by userId means a unique simulated `userId` per run gives de-facto isolation. Wall-clock TTL means a long simulated run never expires them — a real staleness-masking risk. |
| **React Query cache** (`components/providers/QueryProvider.tsx`) | N/A — driver is headless, never mounts the provider | — | — | None. |
| **`lib/supabase/admin.ts`** service-role client | Constructs fresh each call, reads env at call time | — | — | Usable for test-DB seeding/teardown if option (i) is chosen. |

### 3.1 Can simulation runs execute concurrently?

**Not inside one Node process, today.** The blockers are, in order of severity:

1. `lib/supabase/client.ts` module singletons + module-load env capture — one
   database per process.
2. `ProgramEngine` / `fetchExerciseHistory` building their own client.
3. Zustand store singletons (avoidable — see mitigation above).
4. `setOutbox` `driver` + `flushInFlight` module globals.
5. `exerciseService` / `exercisePreferencesService` / `exerciseVarietyService`
   module-level caches.

**Achievable concurrency without touching (1)–(5): process-level.** Jest already
runs one module registry per test file per worker, so `N` seeds across `N` files
parallelize cleanly. Given the Phase 6 target (7 personas × 50 seeds × 6 months),
process-level parallelism plus per-run unique `userId` is very likely sufficient
for v1. **Recommendation: do not re-architect the singletons in Phase 1** — shard by
worker instead, and revisit only if the full suite's wall-clock is unacceptable.

### 3.2 Does simulation ever touch real user data?

Not if either isolation option is used: option (ii) never opens a socket; option (i)
points at `localhost:54322`. The one hazard is that `NEXT_PUBLIC_SUPABASE_URL` is
read at **module load**, so a stray `.env.local` pointing at production would be
picked up silently. **Phase 1 should add a hard guard** in the harness bootstrap that
refuses to run unless the resolved Supabase URL is localhost (or the fake client is
installed). This is harness code, not production code.

---

## 4. Production signatures/modules that would need to change in Phase 1

**A. Clock foundation (new, additive)**
- `lib/clock.ts` (new) — `interface Clock { now(): Date; today(timeZone?: string): string }`, a system clock, and a controllable test clock supporting `advanceHours`/`advanceDays`(calendar)/`advanceWeeks`.
- `lib/date/localDay.ts` — route the six `= new Date()` defaults through the module clock. **No signature changes.**
- `lib/utils.ts:24` `getLocalDateString` — same. **No signature change.**

**B. Widened signatures (all additive/optional — every existing caller compiles unchanged)**
- `lib/training/startMesocycleSession.ts` — `StartMesocycleSessionInput += { today?: string; now?: Date }`.
- `lib/training/startTemplateWorkout.ts`, `lib/training/repeatWorkout.ts` — `+= now?: Date`.
- `app/(dashboard)/dashboard/workout/_lib/adhocSession.ts` — `+= today?: string`.
- `app/(dashboard)/dashboard/workout/[id]/_lib/finishWorkout.ts` — `FinishSummaryData += completedAt: string`.
- `app/(dashboard)/dashboard/workout/[id]/_lib/postSessionMeso.ts` — `PostSessionMesoInput += now?: Date`.
- `app/(dashboard)/dashboard/workout/[id]/_lib/muscleFeedbackWrites.ts:126` `fetchRecentMuscleSessions` — `+= now?: Date`.
- `app/(dashboard)/dashboard/workout/[id]/_lib/suggestions.ts:555` `fetchExerciseHistory` — `+= supabase` parameter (**required**, since the internal client must go).
- `lib/training/transferCandidates.ts:60` — `+= now?: Date`.
- `lib/training/weeklyRollover.ts:470` — already has `now`; callers must pass it.
- `services/weightEstimationEngine.ts` — `now` on the class (affects `:938, 948, 1017, 1080`).
- `services/performanceTracker.ts` — `now` on the class (affects `:259, 275`).
- `services/plateauDetector.ts:583` — stamp `detectedAt` from `referenceDate`.
- `services/exerciseVarietyService.ts:248` — `+= now?: Date`.
- `lib/offline/setOutbox.ts:148,157,173` — `enqueuedAt` from the clock.
- `lib/training/programEngine.ts` — `ProgramEngine` constructor `+= { supabase?, now? }` (**this is the one class that currently cannot be isolated at all**).

**C. New extracted production modules (move-not-copy; UI rewritten to call them)**
- `services/prescription/sessionPrescription.ts` (new) — `getPrescription(input): SetRecommendation`, lifting `ExerciseCard.tsx:626–744` and its input `useMemo`s (`:628–671`). *Largest and highest-risk extraction.*
- `lib/training/logSet.ts` (new) — `logSet(deps, input)`, lifting the persistence core of `page.tsx:2503–2760`.
- `lib/training/editSet.ts` / `deleteSet.ts` (new) — lifting `page.tsx:3071–3212`.
- `lib/training/createMesocycle.ts` (new) — lifting `mesocycle/new/page.tsx:384–470`.
- `app/(dashboard)/dashboard/workout/[id]/_lib/loadSession.ts` (new) — lifting the session/blocks/sets queries from `page.tsx`.

**D. Explicitly NOT changed in Phase 1**
No change to `setRecommender`, `progressionEngine`, `volumeTracker`, `effectiveVolume`,
`shared/volumeCredit`, `shared/trend`, `shared/e1rm`, `fatigueEngine`,
`fatigueBudgetEngine`, `muscleRecovery`, `deloadEngine`, `mesocycleBuilder`,
`suggestionEngine/*`. **The stop condition does not apply.**

---

## 5. Risks and open questions for Josh

1. **`getPrescription` extraction is the crux.** `ExerciseCard.tsx` is 4705 lines and
   `recommendNext` closes over ~10 memoized values plus the `repTotalMode` branch.
   This is a genuine refactor with real regression risk — but there is no headless
   prescription without it, and `_lib/__tests__/engineRegressionBaseline.test.ts`
   already pins the common-case numbers as a safety net. **Recommend doing this
   extraction as its own PR, separate from the rest of Phase 1.**
2. **Which isolation option?** Local Supabase (real constraints, needs Docker, slower,
   harder to parallelize) vs. in-memory fake (fast, parallel, misses DB-constraint
   bugs). My recommendation is both, as stated in §3. **Needs your call.**
3. **`ProgramEngine` is uninjectable.** Confirm whether the harness must drive
   `checkDeloadTriggers` / `getTodayWorkout` (the UI reaches them via
   `lib/training/workoutIntegration.ts` and `deloadRecommendation.ts`). If yes, the
   constructor must change; if the harness can drive deloads through
   `deloadEngine`/`postSessionMeso` only, we can defer it.
4. **H3 — no soft-delete on `set_logs`.** The Phase 3 assertion set and the
   Messy-editor persona should be written against hard-delete semantics.
   Confirm that is the intended product behavior.
5. **H4 — the set-number renumbering divergence** is reported as a suspected
   pre-existing bug. Per constraint 9 it is **not** being fixed here. Confirm you
   want it tracked separately.
6. **Reason codes for the Set-3 contract.** `SetRecommendation` carries
   `rationale: 'maintain' | 'increase_load' | 'reduce_load'` plus an optional
   `provenance: PrescriptionProvenance` and several boolean flags
   (`noMeaningfulChange`, `sessionCapacityClamped`, `rangeFloorLoadDrop`,
   `positionMatch`, `progressionLever`). Stage B/Phase 3 will need a decision on
   which of these constitutes "a reason code" for
   `APPROVED_REPETITION_REASONS` (which stays `[]`, extendable only by you).

---

## 6. Stage A verdict

- Stop condition: **not triggered.** No prescription/fatigue/trend/progression/volume
  *calculation* needs modification — only their dependencies and callers.
- Clock injection: **small and tractable** (one foundation module + ~16 additive
  signature widenings).
- Entry points: **5 required extractions**, one of which (`getPrescription`) is
  substantial.
- Isolation: **achievable at process level today**; two module-level client
  constructions (`ProgramEngine`, `fetchExerciseHistory`) are flagged as required
  changes, and in-process parallelism is explicitly deferred.

**Awaiting approval to proceed to Stage B** (0.2 determinism, 0.4 mutation-boundary,
0.6 idempotency).
