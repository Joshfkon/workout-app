# Simulated-User Testing Harness — Phase 0, Stage B audit

**Status:** AUDIT ONLY. No production code was changed by this report.
**Prerequisite:** [Stage A](./SIMULATION_HARNESS_PHASE0_STAGE_A.md) (0.1 clock · 0.3 entry points · 0.5 isolation).
**Scope of Stage B:** 0.2 Determinism · 0.4 Mutation-boundary · 0.6 Mutation/idempotency.

Per constraint 2, nothing here proposes or applies a production change. Per
constraint 9, suspected engine bugs found during the audit are **reported, not fixed**.

---

## 0. Headline findings

**H6 — Volume has no materialized aggregate. Anywhere.** Weekly/per-muscle volume is
derived live from `set_logs` on every read. A previous `weekly_muscle_volume` table
was **dropped** in migration `20260730000001`, with the reasoning recorded inline at
`hooks/useAdaptiveVolume.ts:93–97`: *"no production code ever wrote that table, and
stored aggregates would freeze stale-convention (pre-group-cap) numbers over live
derivation. Table dropped … so a future writer can't re-arm the trap."*

This collapses a whole class of Phase 3.1 assertions. "Deleting/editing a set updates
dependent aggregates exactly once" is **structurally guaranteed** — there is no
aggregate to update. The harness's job narrows to: *does the derivation read exactly
the right primitive set of rows, exactly once?*

**H7 — Two engine-state tables are written by nothing.**
- `exercise_performance_snapshots` — the writer `writePerformanceSnapshots`
  (`_lib/sessionWrites.ts:38`) is **exported and never called** from any production
  path (verified by whole-repo grep). Its only reader, `hooks/useExerciseHistory.ts:33`,
  is exported from `hooks/index.ts` and **has no consumers either**. The table is
  inert in the live app.
- `strength_calibrations` — written only by `ProgramEngine.recordExerciseHistory`
  (`programEngine.ts:1572`), reached only via `workoutIntegration.recordWorkoutExerciseHistory`,
  which **has no callers**. Read at `programEngine.ts:226`. The live calibration data
  lives in a *different* table, `calibrated_lifts` (onboarding), read at
  `coachingService.ts:257` and by the workout page.
- Same for `exercise_history` (`programEngine.ts:291` reads it; the only writer,
  `programEngine.ts:1559`, is on the dead `recordExerciseHistory` path).

Consequence: `ProgramEngine.loadUserData()` always sees empty `exercise_history` and
empty `strength_calibrations` in production. **The harness must not assert against
these three tables, and must not "helpfully" start populating them** — that would make
the simulation exercise a code path the real app never runs.

**H8 — `ProgramEngine`'s only live entry point is `checkDeloadTriggers`.** This
answers Stage A open question 3. Of the six `workoutIntegration` exports, exactly one
has a caller: `checkShouldDeload`, invoked from
`deloadRecommendation.ts:181–182` inside `recordDeloadRecommendationIfTriggered`,
which the finish flow calls via `runPostSessionMesoUpdates`. So the harness **does**
need `ProgramEngine` — but only for that one path, and the fix is a single optional
constructor parameter. **Decision (mine, stated as an assumption): add
`ProgramEngine(userId, opts?: { supabase?, now? })` in Phase 1.** It is two lines and
it unblocks the deload contract assertions.

**H9 — The double-log guard lives in the UI, not in the write path.**
`ExerciseCard.tsx:501` `isCompletingSet` gates re-entry (`:1993` early return,
`:3913` `disabled`). The online insert at `page.tsx:2695` is a plain `.insert(row)`
with a freshly minted `crypto.randomUUID()` per invocation — so **a caller that
bypasses the component guard and retries gets a genuine duplicate set** (new `id`,
new `set_number`, so neither the PK nor `UNIQUE(exercise_block_id, set_number)`
catches it). The extracted `logSet()` must therefore take a **caller-supplied
`setId`** so retries dedupe on the primary key. This is a harness-design requirement,
not an engine bug — the live UI is safe.

**H10 — `upsertWeeklyFatigueLog` is a read-then-write emulated upsert with no
backing unique constraint** (`_lib/sessionWrites.ts:224–248`; the comment at `:170`
says so explicitly). Idempotent under *sequential* retry; **not** under concurrency —
two overlapping finishes for the same `(user, mesocycle, week)` both read "no row"
and both `INSERT`, producing duplicate weekly fatigue rows that
`ProgramEngine.checkDeloadTriggers` then reads as consecutive weeks. Reported, not
fixed. Low real-world likelihood (finish is user-driven and serialized by the outbox),
but the Messy-editor / retry persona can hit it.

---

## 1. Determinism audit (0.2)

Target property:

```
same initial state + same simulated start date + same persona + same seed
= same normalized engine trace
```

### 1.1 Nondeterminism table

| File:Line | Source | Can affect engine? | Mitigation |
|---|---|---|---|
| `app/(dashboard)/dashboard/workout/[id]/_lib/suggestions.ts:883` | `Math.random()` — greeting picked from a list, embedded in `CoachMessage.greeting` | **No** to prescription; **yes** to trace bytes | Seed it (pass an RNG) or normalize `greeting` out of the trace. Prefer normalizing — it is pure presentation. |
| `components/ui/Toast.tsx:222`, `components/ui/LoadingAnimation.tsx:55,62`, `lib/utils.ts:466` (`generateId`), `lib/social.ts:120,276` | `Math.random()` | No — UI/social only, never on a training path | None. Out of scope. |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:2612` | `crypto.randomUUID()` → `set_logs.id` | **Ordering/selection: no** (every read orders by `set_number` / `logged_at` / `completed_at`). **Trace bytes: yes** | Extracted `logSet()` takes `setId` from the driver's seeded RNG. Doubles as the idempotency key (H9). |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:807` | `crypto.randomUUID()` — ad-hoc session id | Trace bytes only | Driver-supplied id, or normalize. |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:4070` | `crypto.randomUUID()` — `superset_group_id` | Trace bytes; **grouping is by this id**, so it affects superset ordering if the persona builds supersets | Driver-supplied id. |
| **`workout_sessions.id`, `exercise_blocks.id`** — `uuid_generate_v4()` PK defaults (`20241209000001_initial_schema.sql`); `insertWorkoutSessions` (`sessionOrigin.ts:68`) and the block insert (`startMesocycleSession.ts:926`) do **not** supply ids | DB-generated UUID | **Selection: no** — blocks are always read `.order('order')` (`page.tsx:1138`), sessions by `completed_at`. **Trace bytes: yes** | **Normalize in the trace** (stable alias map: `session#1`, `block#1`). Do *not* change the schema for this. |
| `services/suggestionEngine/e1rmAnchor.ts:96` | `.sort((a,b) => b[1] - a[1]).slice(0, ANCHOR_QUALIFYING_SESSIONS)` — ties at the 5th/6th session boundary fall back to `Map` insertion order, which follows the DB row order | **YES — engine-affecting.** Two sessions with an identical newest-set timestamp at the window edge can change which session is in the anchor pool, and therefore the anchor e1RM | Two options: (i) harness advances the simulated clock between every logged set so timestamps are strictly increasing — **required regardless** (see 1.2); (ii) report as a robustness nit and add a secondary sort key. Recommend (i) for v1; (ii) is a production change and stays out of harness work. |
| `hooks/useWeeklyVolume.ts:148` | `exercise_blocks` + nested `set_logs` select, **no `.order()`** | Sums are commutative, so per-muscle counts are stable — **except** float accumulation order for tonnage (last-ULP) | Assert tonnage in canonical integer units (grams) or with an explicit tolerance, per the Phase 3.1 wording. |
| `hooks/useMuscleReadiness.ts:162` | same shape, no `.order()` | Recovery inputs are aggregated; order-insensitive | As above. |
| `lib/training/weeklyRollover.ts:484` (`workout_sessions`), `:511` (`session_muscle_feedback`), `:534` (`exercise_blocks`+`set_logs`) | no `.order()` | Feeds `planWeeklySetAdjustments` (±1 set/muscle). Aggregation is order-insensitive; the muscle→adjustment map iteration is `Map` insertion order derived from row order | **Watch.** If a week-boundary assertion ever flaps, this is the first suspect. Harness mitigation: distinct timestamps + a normalized (sorted-by-muscle) trace projection. |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx:1753` | 28-day `set_logs` calibration window, no `.order()` | Feeds machine calibration | Same. |
| `lib/training/transferCandidates.ts:63–95` | `.order('logged_at', {ascending:false}).limit(TRANSFER_ROW_LIMIT)` | **YES.** A tie at the LIMIT boundary changes the candidate row set, which changes cold-start transfer estimates | Strictly-increasing simulated `logged_at` (1.2). |
| `app/(dashboard)/dashboard/workout/[id]/_lib/suggestions.ts:565–594` (`fetchExerciseHistory`) | `.order('workout_sessions(completed_at)', {ascending:false}).limit(HISTORY_SESSIONS_PER_EXERCISE)` | Same tie-at-limit risk on `completed_at` | Strictly-increasing simulated `completed_at`. |
| `computeHistoryFromBlocks` → `workingSetsOf` (`suggestions.ts:275–278`) | explicitly `.sort((a,b) => set_number)` with the comment *"not a … DB-ordering quirk"* | **Already mitigated in production** ✔ | None. |
| `_lib/readiness.ts:274, 424, 447, 469` | `localeCompare` on `displayName` — final tiebreak in `compareByActionability` and `selectGoodTargets` | **YES if the persona picks targets from readiness rows.** ICU collation varies by locale *and* ICU version | Pin `LANG`/`LC_ALL` in the harness, or normalize the trace to muscle keys rather than display names. |
| `ExerciseCard.tsx:613`, `page.tsx:6912`, `AddExercisePicker.tsx:266–366`, `workout/new/page.tsx:1161`, `services/suggestedWorkout.ts:216` | `localeCompare` on exercise/muscle names — swap-list and picker ordering | **YES if the persona swaps exercises** (Messy-editor) | Same mitigation. |
| `mesocycle/new/page.tsx:444`, `lib/training/programEngine.ts:937` | `new Date().toLocaleDateString()` in the mesocycle **name** | No (cosmetic) — but locale- *and* clock-dependent | `createMesocycle()` extraction takes an explicit `name`. |
| `app/(dashboard)/dashboard/workout/[id]/page.tsx` — 21 `void`-prefixed fire-and-forget calls (`:356, 398, 433–435, 446, 448, 876, 2192, 2219, 2741, 3041, 3065, 3756, 4885, 4967, 4972`) plus `finishWorkout.ts:209, 358` | Unawaited async side effects: joint-pain events, soreness upserts, outbox flushes, block-order persistence, motion capture, post-session meso updates | **YES for trace determinism.** Completion order is scheduler-dependent; `runPostSessionMesoUpdates` in particular is inside `finishWorkout.ts:209`'s detached IIFE | The extracted driver functions must **return the promise** (or expose a `settled()` handle) so the driver can await quiescence before snapshotting the trace. This is a design constraint on Phase 1, not a production behavior change. |
| Jest `process.env.TZ` (`jest.config.js:6`, defaults `America/Denver`) | Timezone affects every `localDay`/`getLocalDateString` bucket | **YES** — deliberately, to keep local-vs-UTC bugs visible | Harness pins `TZ` explicitly and records it in the failure header alongside persona/seed. |
| Floating-point accumulation order in tonnage sums (`workoutStore.getSessionStats`, `volumeTracker`, `effectiveVolume.sumEffectiveVolume`) | IEEE-754 non-associativity | Only in the last ULP | Phase 3.1 already prescribes canonical integer units / explicit tolerance. Validate the business invariant, not the IEEE artifact. |

### 1.2 The one hard requirement this audit produces

**The simulated clock must advance strictly between every logged set and every
completed session.** Three separate engine paths use `ORDER BY … LIMIT` on a
timestamp (`transferCandidates` on `logged_at`, `fetchExerciseHistory` on
`completed_at`, `bestQualifyingE1RM`'s session window), and a tie at the limit
boundary is resolved by unspecified row order. A naive harness that stamps every set
in a session with the same `loggedAt` would make the anchor and the cold-start
transfer ladder nondeterministic — and would look like an *engine* bug.

Recommended model: `logSet` advances the clock by the prescribed rest + a
persona-drawn set duration; `completeSession` advances to a persona-drawn session end.
Both come from the seeded RNG, so they replay exactly.

### 1.3 Determinism verdict

With (a) driver-supplied `setId`, (b) strictly-increasing simulated timestamps,
(c) a pinned `TZ`/locale, (d) awaited side effects, and (e) a trace normalizer that
aliases DB-generated UUIDs and drops the random greeting, the target property is
**achievable without changing any engine calculation**. The one genuine
engine-visible tie-break (`e1rmAnchor.ts:96`) is contained by (b).

---

## 2. Mutation-boundary audit (0.4)

Question: can the simulator drive realistic behavior **without** directly mutating
engine-owned state?

### 2.1 What engine-owned state actually exists

The good news from H6: **almost none of it is stored.** Prescription, volume,
progression, trend and recovery are all *recomputed on read* from primitives.

| Engine concern | Stored? | Where | Canonical mutator |
|---|---|---|---|
| Prescription (target load/reps/RIR/sets) | **Yes** — `exercise_blocks.target_weight_kg`, `target_rep_range`, `target_rir`, `target_sets` | `exercise_blocks` | `startMesocycleWorkoutSession` (✔ injectable). Also mutated by UI handlers: `handleTargetSetsChange` (`page.tsx:3420`), `handleRepRangeChange` (`:3505`), `applyRecalc` (`:1054`), block reorder (`:3706`), swap (`:3940`), skip (`:4150`) — **all need extraction** (Stage A §2). |
| Within-session next-set prescription | **No** — pure function of logged sets | — | `recommendSet()` (needs the `getPrescription` extraction). |
| Progression / PR detection | **No** — derived inline from history | — | — |
| Trend / e1RM anchor | **No** — derived from `set_logs` | — | — |
| Volume aggregates | **No** — derived live (H6) | — | — |
| Muscle recovery / readiness | **No** — `computeMuscleRecovery(history, muscle, now, config)` is pure | — | — |
| Weekly fatigue | **Yes** | `weekly_fatigue_logs` | `upsertWeeklyFatigueLog` via `runPostSessionMesoUpdates` (✔ injectable). See H10. |
| Per-muscle session feedback | **Yes** | `session_muscle_feedback` | `upsertSessionMuscleFeedback` (✔ injectable) / outbox upsert. |
| Mesocycle week + deload state | **Yes** | `mesocycles.current_week`, `deload_recommended_at`, `deload_reasons` | `runPostSessionMesoUpdates` (advance-only `.lt()` ✔) and `recordDeloadRecommendationIfTriggered` (race-safe `.is(null)` ✔). |
| Completed-session state | **Yes** | `workout_sessions.state/completed_at/session_rpe/is_deload` | `submitFinishOptimistic` (✔ injectable). |
| Adaptive volume tolerance | **Yes** | `user_volume_profiles` | `useAdaptiveVolume.saveProfile` (`:340`) — **hook-only, no headless callable**. |
| Dead state (H7) | `exercise_performance_snapshots`, `strength_calibrations`, `exercise_history` | — | **no live writer** |

### 2.2 Boundary verdict

| Simulated behavior | Reachable through a canonical domain API? | Notes |
|---|---|---|
| Create program | After extraction (`createMesocycle`) | Stage A §2 |
| Start / resume session | **Yes today** — `startMesocycleWorkoutSession` | |
| Request prescription | After extraction (`getPrescription`) | |
| Log / edit / delete set | After extraction | |
| Skip / unskip block, change target sets, change rep range, swap exercise, reorder | After extraction (optional set, Stage A §2) | Needed for Messy-editor |
| Abandon session mid-workout | **Yes today** — `cancelWorkoutSession`, or simply stop and let `adhocSession`'s auto-discard run | Chaotic persona |
| Complete session (+ all post-session engine updates) | **Yes today** — `submitFinishOptimistic` → `runPostSessionMesoUpdates` | |
| Deload accept/decline | **Yes today** — `deloadRecommendation.ts` | |
| Weekly ±1 set rollover | **Yes today** — `planWeeklySetAdjustments` + `loadWeeklyMuscleSignals` | Verify the caller that applies the plan |
| Adjust adaptive volume tolerance | **No** — `useAdaptiveVolume` only | **Flagged.** Out of scope for v1 personas; if needed later, extract `saveVolumeProfile`. |

**Legitimate bootstrap-only direct inserts** (data that would exist before a
simulation begins, per the harness spec's carve-out): `users`, `user_profiles`,
`exercises` (catalog — `supabase/seed.sql`), `calibrated_lifts` (onboarding output),
`gym_locations`, `user_exercise_preferences`, `dexa_scans`. Everything else must go
through a domain API.

**Nothing engine-owned requires direct store/DB manipulation to drive**, once the
Stage A extractions land — with the single exception of `user_volume_profiles`.

---

## 3. Mutation / idempotency audit (0.6)

| Operation | Idempotent? | Duplicate behavior | Existing operation ID? | Risk |
|---|---|---|---|---|
| **logSet — online** (`page.tsx:2695` `.insert(row)`) | **No, by construction** — each invocation mints a new `crypto.randomUUID()` (`:2612`) and a new `set_number` from the DB-max probe (`:2578`) | A second invocation creates a **second real set**. Neither the PK nor `UNIQUE(exercise_block_id, set_number)` fires, because both differ | **Yes at the row level** (client-generated `set_logs.id`) but it is minted *inside* the operation, so it cannot dedupe a retry | **Medium for the harness, low for the app.** The app is protected only by the component's `isCompletingSet` flag (`ExerciseCard.tsx:501/1993/3913`). See H9: extracted `logSet()` must accept `setId`. |
| **logSet — offline / network-failure** (`enqueueSetInsert` → outbox) | **Yes** | Outbox flush upserts `set_logs` with `{onConflict:'id', ignoreDuplicates:true}` (`setOutbox.ts:52`); a retry after a lost ack is a silent no-op | `set_logs.id` doubles as the outbox entry key | **Low.** Well-designed. |
| **logSet — concurrent (two tabs/devices)** | N/A | Both compute the same `nextSetNumber` from the DB max → the second insert violates `UNIQUE(exercise_block_id, set_number)` → classified as a real rejection → optimistic state rolled back (`page.tsx:2711–2719`) | — | **Low.** The unique constraint is doing real work here. |
| **editSet** (`page.tsx:3147`) | **Yes, semantically** — `UPDATE … WHERE id = ?` with an absolute (not relative) patch | Re-applying the same patch is a no-op | No dedicated op-id; the `setId` is sufficient | **Low.** But the `edited_at` stamp is a **separate second statement** (`:3157–3165`) — if it fails, the row is edited while `staleTargets.isTargetStale` (`_lib/staleTargets.ts:27`) never learns of it, so the "recalc stale targets" prompt is silently skipped. Non-atomic. Reported. |
| **editSet — before sync** (`updateQueuedSet`, `setOutbox.ts:189`) | **Yes** | Merges the patch into the still-queued insert row | Outbox entry id | Low. Flush is careful not to delete an entry whose payload changed mid-write (`setOutbox.ts:352–357`). |
| **deleteSet** (`page.tsx:3210` `.delete().eq('id',…)`) | **Yes at the DB level** — a second delete matches 0 rows and returns no error | — | `setId` | **Medium** — but for a different reason: **local set renumbering is not persisted** (Stage A H4). The in-memory `setNumber` becomes `1..n` while the DB keeps gaps. `handleSetComplete`'s DB-max probe (`:2578`) then floors at the *local* number, so the next set can reuse a `set_number` already taken. Reported, not fixed. |
| **deleteSet — before sync** (`removeQueuedSet`) | **Yes** | Drops the queued entry; second call returns `false` | Outbox entry id | Low. |
| **undo logged set** (`page.tsx:3225`) | Inherits `deleteSet`; additionally decrements `currentSetNumber` | Repeated undo would decrement repeatedly, but the toast action fires once | — | Low. |
| **completeSession** (`submitFinishOptimistic`) | **Yes** | Outbox entry id is `finish:<sessionId>` (`finishWorkout.ts:44`) so re-enqueueing **replaces** rather than duplicates; the entry is `op:'update'`, which is idempotent by construction | **Yes — `sessionFinishEntryId(sessionId)`. The clearest operation ID in the codebase.** | Low. |
| **completeSession → post-processing** (`runFinishPostProcessing`, `finishWorkout.ts:283`) | **Conditionally-once, not exactly-once** | Runs only when *this* call's flush covered the finish entry (`:212–214`). If another flush path (dashboard mount / `online` listener / page poll) drains it first, `completionSynced` is false and **post-processing never runs for that session** — no meso week advance, no deload check. Conversely two overlapping finishes could both run it | — | **Medium. Reported.** The individual sub-operations are idempotent (below), so a double-run is harmless; a *missed* run is the real hazard. |
| ↳ `mesocycles.current_week` advance (`postSessionMeso.ts:130–137`) | **Yes** | `.update({current_week}).lt('current_week', weekNumber)` — advance-only, value derived from the completed-session count | — | Low. Good pattern. |
| ↳ `upsertWeeklyFatigueLog` (`sessionWrites.ts:224–248`) | **Sequentially yes, concurrently no** | Emulated upsert (SELECT → UPDATE-or-INSERT) with **no unique constraint** on `(user_id, mesocycle_id, week_number)`. Two concurrent calls both INSERT | — | **Medium. Reported (H10).** Duplicate weekly rows would be read by `ProgramEngine.checkDeloadTriggers` as separate weeks. |
| ↳ `recordDeloadRecommendationIfTriggered` (`deloadRecommendation.ts:163`) | **Yes** | Guarded read (`if (existing) return false`) **and** a race-safe write filter `.is('deload_recommended_at', null)` — first writer wins | The null-guard *is* the op-id | Low. Best-in-class here. |
| ↳ `calculateAndSaveWorkoutCalories` | Fire-and-forget dynamic import (`finishWorkout.ts:305`) | Not audited — dashboard garnish, out of engine scope | — | None. |
| **muscle feedback upsert** (`upsertSessionMuscleFeedback`, `muscleFeedbackWrites.ts:70`; outbox key `feedback:<sessionId>:<muscle>`) | **Yes** | `{onConflict:'session_id,muscle_group', ignoreDuplicates:false}` — full-value overwrite | Entry id | Low. |
| **claim ad-hoc session** (`confirmClaimOptimistic`, `finishWorkout.ts:345`) | **Yes** | Outbox key `claim:<sessionId>`, `op:'update'` | `sessionClaimEntryId` | Low. |
| **cancelSession** (`cancelWorkout.ts:37`) | Deletes sets → blocks → session | Second call finds nothing | Session id | Low. |
| **startSession** (`startMesocycleWorkoutSession`) | **Yes** | Resumes today's existing `planned`/`in_progress` session; the blockless-shell claim is atomic — `.update(...).eq('state','planned').eq('mesocycle_id',…).select('id')`, and a caller that loses the race returns `resumedExisting:true` instead of inserting duplicate blocks (`:508–520`) | `(user_id, planned_date)` acts as the natural key | Low. Explicitly hardened against double-tap. |
| **exercise_blocks insert** (`startMesocycleSession.ts:926`) | No (bare insert), but only reachable once per session because of the claim above | — | — | Low. |
| **target_sets change** (`page.tsx:3448`, outbox key `block-target-sets:<blockId>`) | **Yes** | Stable synthetic key coalesces repeated toggles to the latest value | Entry id | Low. |
| **deload flag toggle** (`page.tsx:4960`, key `deload:<sessionId>`) | **Yes** | Same pattern; deliberately does *not* roll back the local flag on failure | Entry id | Low. |
| **outbox flush itself** (`flushSetOutbox`, `setOutbox.ts:310`) | **Yes** | Overlapping calls share one in-flight promise (`flushInFlight`); a 10 s per-op timeout is treated as a network error so the entry is retained and retried; late server-side success is harmless because every entry kind is idempotent | Entry ids | Low. `flushInFlight` is a **module global** — an isolation concern for in-process parallel runs (Stage A §3), not a correctness one. |
| **phase change / mesocycle edit** (`mesocycle/page.tsx`, `lib/actions/phase.ts`) | Not audited in depth — outside the v1 driver loop | — | — | Deferred. |

### 3.1 Summary of idempotency posture

The offline/outbox layer is genuinely well engineered: **stable synthetic entry ids,
`ignoreDuplicates` upserts, advance-only updates, and a race-safe null-guard** are all
present and documented. The gaps are all on the *online* fast path, where the UI's
re-entry flag substitutes for a durable operation id — which is exactly what breaks
when a headless driver replaces the UI.

**Per constraint, no idempotency mechanism is being added in Phase 0.** The three
items worth tracking as separate (non-harness) work:
1. H9 — `logSet` online path has no caller-supplied operation id.
2. H10 — `upsertWeeklyFatigueLog` lacks the unique constraint its emulated upsert assumes.
3. `runFinishPostProcessing` can be skipped entirely when a competing flush drains the finish entry first.

---

## 4. Consolidated Phase 0 → Phase 1 decisions

Stage A left three open questions. Recording my calls so Phase 1 has a spec:

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | Isolation: local Supabase vs in-memory fake | **Both.** In-memory fake for the fast CI suite + deterministic regression scenarios; local Supabase (`supabase/config.toml`, ports 54321/54322) for the nightly full suite | The fake is fast and trivially parallel but cannot enforce `UNIQUE(exercise_block_id,set_number)`, `reps <= 100`, or RLS — and §3 shows those constraints are load-bearing (they are what actually prevents concurrent double-logging). Losing them would blind the exact assertions Phase 3.1 exists for. |
| 2 | Does the harness need `ProgramEngine`? | **Yes, for `checkDeloadTriggers` only** (H8). Add an optional `{ supabase?, now? }` constructor parameter in Phase 1 | It is the sole live path, it is reached from the finish flow, and the deload contract assertions depend on it. Two-line change, no behavior change. |
| 3 | Hard-delete semantics for sets | **Assume hard delete is intended** and write the Messy-editor persona and Phase 3.1 assertions against it; H4 (the unpersisted renumbering) is tracked as a **separate suspected bug**, not fixed here | `set_logs` has no `deleted_at` and no migration has ever added one; treating it as an oversight would mean the harness asserts behavior the app does not have. |

**Additional Phase 1 requirements produced by Stage B** (on top of Stage A §4):

- `logSet(deps, input)` takes `setId` **and** `loggedAt` from the caller (H9 + §1.2).
- Every extracted driver function **returns its promise**; no `void` fire-and-forget
  inside the extracted core (§1.1, last row). The component keeps its own
  fire-and-forget wrappers so UI behavior is unchanged.
- The harness pins `TZ` and `LC_ALL`, and records both in every failure header
  alongside persona / seed / simulated timestamp.
- The trace normalizer aliases DB-generated `workout_sessions.id` /
  `exercise_blocks.id` and drops `CoachMessage.greeting`.
- The harness must **not** write `exercise_performance_snapshots`,
  `strength_calibrations`, or `exercise_history` (H7) — doing so would simulate a
  code path production never runs.

---

## 5. Suspected pre-existing bugs found during Phase 0

Reported only. Per constraints 8 and 9 these are **not** fixed as part of harness
work and each should get its own change, with a deterministic Phase 4 scenario
attached when it is fixed.

| # | Where | Symptom |
|---|---|---|
| B1 | `page.tsx:3175–3212` (`handleDeleteSet`) | Surviving sets are renumbered `1..n` in local/Zustand state but no `set_number` UPDATE is issued; in-memory and persisted numbering diverge, and the next `logSet`'s DB-max probe floors at the stale local number. |
| B2 | `_lib/sessionWrites.ts:224–248` (`upsertWeeklyFatigueLog`) | Read-then-write emulated upsert with no backing unique constraint on `(user_id, mesocycle_id, week_number)`; concurrent finishes can double-insert. |
| B3 | `_lib/finishWorkout.ts:212–222` (`runFinishPostProcessing`) | Post-session meso updates + deload check are skipped entirely when a competing outbox flush drains the finish entry first. |
| B4 | `page.tsx:3157–3165` (`handleSetEdit`) | The `edited_at` stamp is a second, non-atomic statement; if it fails the edit lands but `staleTargets` never sees it, silently skipping the target-recalc prompt. |
| B5 | `_lib/sessionWrites.ts:38` / `hooks/useExerciseHistory.ts` | `exercise_performance_snapshots` has a writer and a reader, neither of which is called by anything. Dead code, or a wiring regression. |
| B6 | `lib/training/workoutIntegration.ts` | Five of six exports have no callers; `recordWorkoutExerciseHistory` is the only writer of `exercise_history` and `strength_calibrations`, both of which `ProgramEngine.loadUserData` still reads. |
| B7 (nit) | `services/suggestionEngine/e1rmAnchor.ts:96` | Session-window selection has no explicit tie-break; equal timestamps at the `ANCHOR_QUALIFYING_SESSIONS` boundary resolve by incidental row order. |

---

## 6. Phase 0 verdict

- **Stop condition: not triggered** (established in Stage A, unchanged by Stage B).
  No prescription / fatigue / trend / progression / volume *calculation* needs to change.
- **Determinism: achievable** without touching engine math, given a strictly-advancing
  simulated clock, driver-supplied ids, pinned TZ/locale, awaited side effects, and a
  trace normalizer.
- **Mutation boundary: clean.** Because volume/trend/progression are derived rather
  than stored (H6), the only engine-owned stored state is prescription targets,
  weekly fatigue, session feedback, meso week/deload state, and session completion —
  every one of which has (or, after the Stage A extractions, will have) a canonical
  production mutator. One gap: `user_volume_profiles` (hook-only), out of v1 scope.
- **Idempotency: good offline, thin online.** The outbox layer is exemplary; the
  online fast path relies on a React re-entry flag that a headless driver bypasses.
  Fixed by having the extracted `logSet` accept an operation id.

**Phase 0 is complete.** Recommended Phase 1 sequencing, smallest-risk first:

1. `lib/clock.ts` + route the `localDay`/`getLocalDateString` defaults through it — additive, zero signature churn, zero behavior change.
2. Additive `now`/`today`/`supabase` parameters on the training data layer (Stage A §4B).
3. `logSet` / `editSet` / `deleteSet` extraction from `page.tsx`.
4. `loadSession` + `createMesocycle` extraction.
5. **`getPrescription` extraction from `ExerciseCard.tsx` — its own PR**, guarded by `_lib/__tests__/engineRegressionBaseline.test.ts`.
6. `SessionDriver` assembled from the above.
