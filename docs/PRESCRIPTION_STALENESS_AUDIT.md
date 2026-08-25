# Within-session prescription staleness — Phase 1 audit

Reported case: Abdominal Crunch Machine, rep_total mode.

| | load | reps | RIR |
|---|---|---|---|
| Last session | 175 lb | 10 / 10 / 10 | 2 |
| Today, plan | 180 lb | 9 / 9 / 9 (27 total) | 2 |
| Set 1 logged | 180 lb | 9 | 2 |
| → rx for set 2 | 180 lb | 9 | 2 |
| Set 2 logged | 180 lb | **7** | **1** |
| → rx for set 3 | 180 lb | **9** | 2 | ← the complaint |

Rest timer reacted (`+30s — last set ran hotter than target`); the
prescription did not.

**Status: reproduced, root cause identified, fixed. Phases 1–3 complete.**
The audit below is preserved as written (Phase 1); §9 records what shipped.

---

## 0. Headline

**This is not a staleness bug.** There is no cache, no stale memo, no
missing invalidation, and no second data path. `recommendRepTotalNextSet`
was called with set 2 in `observedSets`, read its 7 reps and its 1 RIR,
correctly classified it `effortVsTarget: 'harder'` — and then returned
`180 × 9` anyway, because **every reactive term in the rep_total policy is
one-directional (raise-only), and the one term that can lower the ask is
gated behind a threshold set 2 did not cross.**

The rest timer and the prescription read the *same* set, the *same* RIR,
and the *same* effective target. They diverge on **threshold**, not on data:

| consumer | fires when | set 2 (dev = −1) |
|---|---|---|
| `prescribeRestSeconds` | `dev ≤ −1` | **fires** (+30 s) |
| `recommendRepTotalNextSet` reduce branch | `dev ≤ −DEADBAND_RIR` (= −2) **AND** `reps < repMin` | does not fire |

So the user-visible contradiction ("the timer knows, the prescription
doesn't") is real, but the cause is a threshold mismatch between two
sibling policies plus a raise-only rep model — not two data paths.

### Reproduction

Simulated against the real engines with last-session 3 × 10 @ 175 lb / 2 RIR:

```
range  6-10   plan 180 lb [9,9,9] = 27, bumped
  after set 1 (180×9 @2) -> 180 × 9    follow_plan  on_target
  after set 2 (180×7 @1) -> 180 × 9    follow_plan  harder
                                        clamped=false  totalSoFar=16  target=27  remaining=11
range  8-12   identical
range  5-10   identical
range 10-15   plan does NOT bump (175, [11,10,10]); reduce_load fires; not the reported case
```

Exact match to the report, including the `16 of 27` counter. The defect is
independent of the configured rep range for any range whose floor is ≤ 7.

---

## 1. Prescription lifecycle

### Where it lives

**One production component owns every prescription in the app:**
`components/workout/ExerciseCard.tsx`. Verified by grep — the only
non-test call sites of `recommendSet`, `recommendRepTotalSessionStart`
and `recommendRepTotalNextSet` are all in that file. There is no server
component, no store, and no API route holding a prescription.

### Data flow

```
workoutStore / page local state
  page.tsx:5296  getSetsForBlock(block.id)   ← completedSets, appended
        │                                      synchronously on log
        │                                      (offline-first; never waits on DB)
  page.tsx:6061  <ExerciseCard sets={blockSets} …>
        │
  ExerciseCard:623  completedSets = sets.filter(not warmup)   [new array every render]
        │
        ├─ repTotalMode? ─ resolveProgressionModel(exercise.progressionModel,
        │                    history.estimableSetCount, history.inestimableSetCount)
        │
        ├─ YES ──► repTotalPlan      useMemo   [prevSession, priorSession, range, targetSets, …]
        │                                       ↑ deliberately NOT keyed on completedSets:
        │                                         it is the session-START baseline
        │          repTotalNextSet   useMemo   [repTotalPlan, completedSets, range, targetRir, …]
        │                                       ↑ recomputes every render (array identity)
        │
        └─ NO  ──► recommendSet({ …, sessionObservedSets: completedSets,
                                  positionContext: { prevSessionSets, todaySets, plannedSetCount } })

  consumers (all read the same memo, same render):
    ExerciseCard:690   recommendNext()            → pending-row prefill
    ExerciseCard:2150  suggestion banner copy
    ExerciseCard:1640  cold-start seed (plan only — no sets logged yet)
```

### Answers to the audit questions

**When is it computed?** Every render, per set. `repTotalNextSet` is a
`useMemo` whose `completedSets` dependency is a fresh `.filter()` array on
every render, so the memo never actually holds a value across renders. Same
for the `recommendSet` path, which is a plain function call in render.

**What inputs does it read?** Both. `recommendRepTotalNextSet` receives
`observedSets` = today's logged sets with resolved RIR; the plan it grades
against comes from last session. `recommendSet` receives
`sessionObservedSets` and `positionContext.todaySets` for today plus
`prevSessionSets` for last session.

**Is it cached? Does anything invalidate on set-log?** Not cached. And the
prefill *is* explicitly re-driven on log: `ExerciseCard:1550`'s effect
compares `prevCompletedCountRef` to `completedSets.length`, and on an
increase clears `manualEditsRef` (the dirty-field guard), cancels in-flight
weight-edit recalcs, and rewrites every pending row from `recommendNext`.

**Conclusion:** the invalidation machinery the Phase 2 brief asks for is
already in place and already correct. The number is wrong on arrival.

---

## 2. Rest-timer path, and where it actually diverges

```
ExerciseCard set-log tap
  → page.tsx:2500  handleSetComplete(data)      ← the RAW event payload
      → page.tsx:2550  prescribeRestSeconds({
            baseSeconds: currentBlock.targetRestSeconds,
            lastSetRir:  data.feedback?.repsInTank ?? rpeToRir(data.rpe),
            targetRir:   effectiveTargetRirForBlock(currentBlock),
          })
      → restTimer.start(rx.seconds); setRestAdjustmentNote(rx.note)
  → (same handler) set appended to completedSets → ExerciseCard re-renders
      → repTotalNextSet recomputes from completedSets
```

The two consumers **do** read from different *objects*: rest reads the
in-flight event payload synchronously inside the handler; the prescription
reads the persisted set once it lands in state. But they read the same
*values*, via the same read-order convention (`feedback.repsInTank` →
`rpe`), graded against the same effective target — `effectiveTargetRirForBlock`
carries an explicit comment that it must mirror `ExerciseCard`'s
`effectiveTargetRir` for exactly this reason.

Structurally this is still worth fixing (see §6, silent-failure S1: if the
set never lands in state, rest reacts and the prescription silently doesn't),
but **it is not the cause of the reported bug.** The cause is §3.

Divergence that *is* real and user-visible: `recommendRepTotalNextSet`
returns `effortVsTarget: 'harder'`, and the rep_total banner branch
(`ExerciseCard:2150-2200`) never reads it. Only the e1RM branch
(`:2314-2319`) renders "last set ran a bit harder than target". So on
rep_total exercises the engine computes the very sentence the rest bar
displays and throws it away.

---

## 3. Root cause — the rep_total ask is raise-only

`services/suggestionEngine/repTotalPolicy.ts`, `recommendRepTotalNextSet`
(:594). Trace with set 2 = 180 × 7 @ 1 RIR, target 2 RIR, range floor ≤ 7:

**a. Baseline (:647).** `planSlotReps = perSetRepTargets[2] = 9`. The plan's
per-set targets are flat — last session's observed 10/10/10 exchanged onto
the +5 lb load gives [9,9,9]. **There is no within-session fatigue decline in
the rep_total plan at all**, unlike the e1RM path's `HOLD_DROP_RATE` /
`FATIGUE_E1RM_PER_SET`. Slot 3 asks exactly what slot 1 asked.

**b. Reduce-load branch (:667).** Requires `last.reps < repMin` **and**
`dev ≤ −DEADBAND_RIR` (−2). Set 2 was 7 reps at dev = −1. Both conditions
fail for a floor ≤ 7; the `dev` condition fails regardless of range. **Not
taken.**

**c. Evidence floor (:696).** `reps = min(repMax, max(reps, ceiling − 1))`.
`Math.max` — by construction it can only *raise* the ask. Set 2's ceiling is
`(7 + 1) − 2 = 6`, so it contributes `5`, which loses to 9. The comment says
so explicitly: *"it can only RAISE the ask — banked reps never reduce a
later prescription."* **No effect.**

**d. Session-capacity clamp, INV-2 analog (:704).** Takes the **maximum**
`observedAskCeiling` over *all* of today's sets:

- set 1 (9 @ 2 RIR) → `(9+2) − 2 = 9`
- set 2 (7 @ 1 RIR) → `(7+1) − 2 = 6`
- ceiling = **max = 9**

`reps (9) > ceiling (9)` is false → not clamped. **The clamp is a ceiling
against the session's *best* set, so a declining session never trims it.**
It was designed for "did 6 @ 0 RIR, engine re-asked 10" — a *first*-set
miss. It is structurally blind to a *decline* after a good first set.

**e. Below-floor load step (:719).** Guarded by `reps < repMin`. `reps` is 9.
**Not taken.**

Result: `180 × 9`, `rationale: 'follow_plan'`, `sessionCapacityClamped:
false`, `effortVsTarget: 'harder'`. Identical to set 2's prescription.

> **Root cause, one sentence:** in rep_total mode the next-set ask is a flat
> last-session target that only three mechanisms can move — a reduce branch
> gated at 2 RIR past target *and* below the range floor, a floor that only
> raises, and a capacity clamp anchored to the session's **best** set — so a
> set that is short and hot but not both-past-threshold moves nothing, and
> the previous ask is re-served verbatim.

---

## 4. Rep-total math — where "16 of 27" comes from, and why 11 never reaches the ask

`totalSoFar` (16) and `remainingToTarget` (11) are both computed correctly at
`repTotalPolicy.ts:600` / `:788`, and rendered by
`ExerciseCard:2170` as `` `${soFar} of ${next.sessionRepTotalTarget} planned` ``.

**They are never used to derive `reps`.** This is deliberate and documented
(spec §2, the comment at `:696`): *"no ask is ever remainder arithmetic
against the session total."* The remaining-reps figure is a **progress
counter only**. Set 3 gets `planSlotReps` (9), not `remaining / remaining
sets` (11 / 1 = 11).

⚠️ **This is a direct conflict with the Phase 2 brief**, which asks to
"redistribute remaining reps across remaining sets". That is precisely the
budget semantics the current spec forbids, and it was forbidden for a
reason: with a *fixed* set count, remainder arithmetic makes a strong early
set *reduce* the later asks (bank 12 when you asked 9 → set 3 asks 6), which
is the silent-volume-cut failure the "target is a FLOOR, not a budget" rule
exists to prevent. See §7 for the reconciliation I recommend.

**Bonus finding (same area):** in rep_total mode `recommendNext(last,
positionOffset)` at `ExerciseCard:687` **ignores `positionOffset` entirely** —
it returns the single `repTotalNextSet` for every pending slot. On the e1RM
path each pending row gets its own positional target (Phase A). So with 2
sets pending, rep_total shows the same target twice. Silent.

---

## 5. Is it rep-total-specific? — Yes.

Same scenario run through `recommendSet` (e1RM path, 8–12 range, positional
context populated):

```
after set 1 (180×9 @2)  ->  180 lb × 10   maintain
after set 2 (180×7 @1)  ->  175 lb ×  9   reduce_load
```

The e1RM path reacts correctly and in both dimensions. It has the terms
rep_total lacks: per-set fatigue decay (`FATIGUE_E1RM_PER_SET`,
`HOLD_DROP_RATE`), a `rangeFloorLoadDrop` rule, and a reduce branch that
keys on the e1RM curve rather than a floor-plus-deadband conjunction.

**Scope of the defect: rep_total exercises only.** Which exercises route
there: explicit `exercises.progression_model = 'rep_total'`, or NULL
auto-classified when a majority of recent sets are inestimable (> 12
effective reps) — i.e. most high-rep machine/isolation work. Not a narrow
slice.

---

## 6. Silent-failure inventory

Places where wrong or missing data produces a plausible-looking number with
no user-visible signal. Ordered by severity.

| # | Location | Failure | Why it's silent |
|---|---|---|---|
| **S1** | `ExerciseCard:690` | `repTotalPlan` is null (no usable history) → `repTotalNextSet` is null → `next?.weightKg ?? last.weightKg`, `next?.reps ?? clamp(last.reps)`, `rationale: 'maintain'` | Renders as a normal confident prescription. Nothing says "no plan — echoing your last set". This is the exact fallback the Phase 2 brief forbids. |
| **S2** | `repTotalPolicy:704` | Capacity clamp takes `max` over observed sets | A declining session is indistinguishable from a flat one. No flag, no copy. **The reported bug.** |
| **S3** | `repTotalPolicy:696` | Evidence floor is `Math.max` | Downward evidence is discarded with no record that it was seen. |
| **S4** | `ExerciseCard:2150-2200` | `effortVsTarget` computed, never rendered on the rep_total path | Engine says "harder", banner says "rep-total — 16 of 27 planned". The rest bar becomes the *only* surface that acknowledges the miss — precisely the split that prompted this report. |
| **S5** | `setRecommender.ts:283` `resolveLastRir` | No effort signal → returns `targetRir` | A set logged with no RIR reads as *exactly on target*. Feeds `sessionBestE1RM`, `observedAskCeiling`, and the clamp. Indistinguishable from a genuine on-target set. |
| **S6** | `ExerciseCard:687` | `positionOffset` ignored in rep_total mode | Multiple pending rows show one target; looks intentional. |
| **S7** | `ExerciseCard:1546` (`recommendNext` inside `recalculatePendingInputs`) | `recommendNext` is a plain closure, not in the `useCallback` dep list (`exhaustive-deps` disabled at `:1547` and `:1618`) | Not currently a live bug — `completedSets` identity changes every render — but the suppression means a future memoization of `completedSets` would reintroduce genuine staleness with no test catching it. |

Note that **none of S1–S7 is a caching bug.** S7 is the only latent
staleness risk and it is not currently firing.

---

## 7. Complete consumer list

Production (all in `components/workout/ExerciseCard.tsx`):

| line | consumer | reads |
|---|---|---|
| 690 | `recommendNext` rep_total branch | `repTotalNextSet` |
| 703 | `recommendNext` e1RM branch | `recommendSet(...)` |
| 1546 | `recalculatePendingInputs` → pending-row prefill | `recommendNext(last, i)` |
| 1640 | first-set seed (nothing logged yet) | `repTotalPlan.perSetRepTargets[setIndex]` |
| 1673 | first-set seed, e1RM | `buildSlotSeed(setIndex)` |
| 2150 | suggestion banner, rep_total copy | `repTotalNextSet` + `repTotalPlan` |
| 2266+ | suggestion banner, e1RM copy | `recommendSet(...)` |
| 2353 | banner, rep_total session start | `repTotalPlan` |

Parallel consumer of the same set event, different module:
`app/(dashboard)/dashboard/workout/[id]/page.tsx:2550` → `prescribeRestSeconds`.

Non-production: `scripts/auditProgressionDiff.ts`,
`scripts/auditE1rmPrescriptionDump.ts`, and the test suites listed by grep.
`app/(dashboard)/dashboard/mesocycle/_lib/planPreview.ts` uses the
session-start seed only, never the within-session ask.

---

## 8. What I'd propose for Phase 2 (not implemented — for approval)

Framed against the brief's constraints, flagging the two places where the
brief and the shipped spec disagree.

**Already satisfied, no work needed:**

- *"Single source of truth … one function taking (last session sets +
  current session sets + planned targets)"* — that is
  `recommendRepTotalNextSet(sessionPlan, observedSets, …)` today.
- *"Recompute on every set-log; no cached prescription survives"* — already
  true (§1).

**The actual fix — make the rep ask two-directional (fixes S2/S3):**

1. **Session-decline term.** Replace the `max`-over-all-sets ceiling with a
   ceiling that respects recency: clamp the ask to the capacity demonstrated
   by the **most recent** set (with the existing `max` retained as a *floor*
   guard so one fluke low rep doesn't collapse the session). Set 3 then asks
   from set 2's `observedAskCeiling` of 6 rather than set 1's 9, and the
   natural set-to-set decline the brief describes falls out.
2. **Lower the reduce-branch gate to match the rest timer.** Introduce a
   distinct rep_total reduce threshold at `dev ≤ −1` (the timer's threshold),
   and drop the *conjunction* with `reps < repMin` — a set that is both short
   of its slot target *and* hotter than target is evidence regardless of
   where the range floor sits. Per the brief, prefer dropping reps at held
   load; step the load only when the ask would fall below `repMin` (that
   branch at `:719` already exists and would then start firing).
3. **Flag it.** Add a `sessionDeclineTrimmed` flag alongside
   `sessionCapacityClamped`, and render `effortVsTarget` in the rep_total
   banner branch (fixes S4). The prescription and the rest bar then say the
   same thing about the same set.
4. **Surface S1 loudly** — a null plan must render "no comparable history —
   echoing your last set", not a silent confident number.
5. **Honor `positionOffset`** in the rep_total branch (S6).

**Where I need your call (brief vs. shipped spec):**

- **Rep redistribution.** The brief asks for remaining-reps redistribution;
  spec §2 forbids remainder arithmetic, because with a fixed set count it
  makes a *strong* set cut later targets. My recommendation: implement the
  brief's *intent* — "after a short set the later asks should move" — via
  the decline term in (1), which lowers the ask from observed capacity, and
  keep the total as a progress counter. If you want literal redistribution,
  it should be **one-directional** (a shortfall may raise later asks; a
  surplus may never lower them) and that is a deliberate spec amendment I'd
  want written down.
- **Volume interaction.** (1) and (2) both *lower* rep asks, which lowers
  projected tonnage, which is adjacent to `applyVolumeConstraint` /
  `volumeShortfall` in `recommendRepTotalSessionStart` and to the
  double-counting/volume-accounting systems the brief says not to touch. I
  do **not** intend to change any volume code — but the shortfall banner
  will start appearing more often as a *consequence*. Flagging per the
  brief's instruction to stop and check before working near those systems.

**Phase 3 verification** would then be: the §0 reproduction table asserted
as a test (set 3 rx ≠ set 1 rx after a short set 2); a test that
`prescribeRestSeconds` and `recommendRepTotalNextSet` classify the same set
identically at the same threshold; and the manual log-a-set check.

---

## 9. Phase 2/3 — what shipped

### The fix: a live capacity anchor

`services/suggestionEngine/repTotalPolicy.ts`. The INV-2 capacity ceiling
kept its original max-over-all-sets form — it still gates the **load** lever
— and a second, tighter **live** ceiling was layered on top of the **rep**
ask:

```
bestCeiling  = max over today's sets   →  gates the LOAD (unchanged)
repsAtBestCeiling                      →  the value the load lever is judged on
liveCeiling  = the MOST RECENT set     →  caps the REP ask (new)
```

Rationale: within-session capacity is non-increasing, so the latest
observation estimates what the *next* set can do, while the max estimates
what the lifter could do at the session's *start*. With one set logged the
two anchors are identical — this only diverges once a later set comes in
under an earlier one, i.e. exactly the defect and nothing else.

The reported case now returns **180 lb × 6 @ 2 RIR** for set 3 (set 2's 7
reps with 1 left = 8 in the tank → 6 at the 2-RIR target), carrying
`sessionDeclineTrimmed`.

**Load behavior is deliberately unchanged.** The first attempt let the live
trim reach the load lever, which turned one weak set into an 11% mid-session
deload (caught by an existing test). Gating the load step on
`repsAtBestCeiling` restores the brief's ordering exactly: **reps absorb
fatigue at a held load; the load only moves when today's *best* set can't
hold the range.**

### Threshold parity: one set, one verdict

New module `services/suggestionEngine/effortGrade.ts`. The rest timer, the
rep_total policy and `recommendSet` each re-implemented the effort
comparison with three different clamps; all three now grade through
`gradeEffort`, which names `hotterThanTarget` (≤ −1, the timer's threshold)
and `pastDeadband` (≤ −DEADBAND_RIR, the load lever's). Consumers still
*act* at different thresholds by design, but they read them off one object,
so a set can no longer be described two ways. `gradeEffort` returns `null`
for an unrated set rather than defaulting to on-target.

### Silent failures closed

- **S1** — a null plan now renders *"rep-total — no comparable history yet,
  echoing your last set"* instead of an unbacked echo dressed as a
  prescription.
- **S2/S3** — a trimmed ask carries `sessionDeclineTrimmed` and the banner
  says *"trimmed — your last set came in under"*. A silently *shrinking*
  ask would be the same class of bug in the other direction.
- **S4** — the rep_total banner now renders `effortVsTarget`, so the
  prescription and the rest bar acknowledge the same hot set.
- **S6** — `recommendNext` honors `positionOffset` on the rep_total path via
  `repTotalNextSetAt(offset)`, projecting intervening slots as met exactly
  (the same assumption the e1RM path makes). Pending rows no longer show one
  number repeated.

S5 and S7 are **not** fixed — S5 (`resolveLastRir`'s target-RIR fallback) is
load-bearing for existing call sites and needs its own change; S7 is a
latent risk, not a live bug. Both remain listed above.

### Not touched

No volume-accounting or double-counting code was modified, per the brief.
`applyVolumeConstraint` / `volumeShortfall` are untouched — but note the
consequence flagged in §8: trimmed rep asks lower projected tonnage, so the
existing shortfall banner will surface more often on declining sessions.
That is the honest signal firing, not a regression.

### Verification

- `services/__tests__/repTotalIntraSessionReaction.test.ts` (24 tests) — the
  §0 scenario across three rep ranges, plus over-correction guards (a steady
  session must not trim; a strong set must still raise the ask), the
  held-load assertion, counter/ask decoupling, and timer↔prescription parity
  across six effort cases.
- `components/workout/__tests__/ExerciseCardRepTotalReaction.test.tsx` (3
  tests) — the manual check, automated: one mounted `ExerciseCard`,
  `rerender` with one more set, assert the on-screen prescription changes.
  This is the "log a set, no navigating away and back" case, and it also
  fails if a future memo re-freezes the component's view of the session.
- Both suites were confirmed to **fail** with the live trim disabled (4 and
  2 tests respectively), so neither is vacuous.
- One pre-existing test changed: `repTotalPolicy.test.ts` "follows the plan
  slot when today matches it" → "trims the plan slot to the LIVE ceiling
  when the session is declining". Its fixture's set 2 (11 reps) was *below*
  the 12-rep range floor, so "today matches it" was never true; the old
  expectation of 12 encoded the raise-only behavior. Load assertion
  unchanged at 61.23 kg.
- Full suite: **4721 passing / 262 suites**. `tsc --noEmit` clean, `npm run
  lint` clean for touched files, `npm run build` succeeds.
