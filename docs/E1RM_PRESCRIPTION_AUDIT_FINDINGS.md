# e1RM / Prescription Audit — Findings (Seated Calf Raise repro, Jul 25 2026)

**Status: INVESTIGATION ONLY. No code changes, no data changes. Fixes are
proposed at the end but NOT implemented — awaiting approval.**

Repro case: Seated Calf Raise (soleus). Last session (Jul 20):
135×12 @9, 135×10 @7.5, 135×8 @7.5. Card: "Estimated 1RM 232.5 lbs ·
5 sessions", badge "Ahead", prescription "132.5 lbs × 12–20 @ 3 RIR —
working weight from your ~232.5 lbs est. 1RM (held near recent working
weight) · calibration-adjusted", set-1 defaults 132.5 lbs / 10 reps.

All engine math is done in kg. 135 lbs = **61.23 kg** stored;
232.5 lbs = **105.46 kg**. Seated Calf Raise's seed row
(`supabase/seed.sql:341`) carries `defaultRepRange [12,20]`,
`defaultRir 2`, `minWeightIncrementKg 5.0` — all three matter below.

---

## 1. The e1RM estimator ("Estimated 1RM 232.5")

**Where computed.** The card's number is
`exerciseHistory.estimatedE1RM`, computed client-side at workout-page
load in `computeHistoryFromBlocks` —
`app/(dashboard)/dashboard/workout/[id]/_lib/suggestions.ts:353-356`:

```
estimatedE1RM = softenOtherLocationEstimate(decayedE1RMMax(anchorEntries), …)
```

**Exact per-set formula.** `historySetE1RM` —
`services/suggestionEngine/e1rmAnchor.ts:37-43`:

- `effectiveReps = reps + (10 − rpe)` (raw arithmetic, **not** the
  bucketed `rpeToRir`)
- `effectiveReps > 12` → **linear Epley: `weight × (1 + effectiveReps/30)`**
- `effectiveReps ≤ 12` → Brzycki: `weight × 36/(37 − effectiveReps)`

**Does it consume RIR/RPE?** Yes — via `10 − rpe`. The Jul 20 sets
compute to: 12@9 → eff 13 → **193.5 lbs**; 10@7.5 → eff 12.5 → 191.2;
8@7.5 → eff 10.5 → 183.4. Your Epley arithmetic (~193) is what the code
produces for the visible sets. 232.5 did not come from them.

**Rep ceiling: NONE on this path.** `historySetE1RM` extrapolates
linearly without bound. This is unique to the anchor/display path — the
app's other formulas do cap: `services/shared/strengthCalculations.ts:76`
clamps effective reps at 15; `lib/utils.ts:405` clamps at 12. Backing
out 232.5 from 135 requires effectiveReps ≈ 21.7 — i.e. a ~20-rep set,
which both other formulas would have refused to extrapolate.

**Which set produced it — the candidate pool is contaminated.** The
aggregation loop (`suggestions.ts:292-339`) pushes an anchor entry for
**every non-warmup set** — `filter((s) => !s.is_warmup)` at
`suggestions.ts:295` — including `set_type` `dropset`, `myorep`,
`rest_pause`, and AMRAP burnouts. Meanwhile the "last session" display
and `previousSets` use `workingSetsOf` (`suggestions.ts:249-252`),
which filters to `set_type === 'normal'`. So a high-rep dropset/myorep/
AMRAP set can be the e1RM anchor **while being invisible in the header
chips**. (135×20 @~RPE 8–9 → eff ~21.7 → ≈232.5 lbs. The dump script
will identify the exact row.)

**Aggregation.** Recency-decayed max over the last
`HISTORY_SESSIONS_PER_EXERCISE = 10` sessions
(`services/suggestionEngine/constants.ts:86`), deloads excluded
(`suggestions.ts:213`): each candidate weighted
`exp(−age_days / 45)` with age relative to the **newest** session
(`decayedE1RMMax`, `e1rmAnchor.ts:60-79`; τ at `constants.ts:96`), then
max. A high-rep set from the newest or a recent session decays little
(5 days ≈ ×0.90), so one outlier set anchors everything.

**Cached/persisted?** **No.** The 232.5 value is recomputed in memory on
every page load (`page.tsx:1215-1230`) — there is nothing to expire or
backfill. Separately, `exercise_performance_snapshots.estimated_e1rm`
IS persisted at session completion
(`app/(dashboard)/dashboard/workout/[id]/_lib/sessionWrites.ts:78-95`)
but with a **different formula** — `lib/utils.estimateE1RM`
(`lib/utils.ts:400-411`), Epley capped at 12 effective reps and
**RPE-blind** (rir defaults to 0). That table feeds the history page and
`hooks/useExerciseHistory.ts`, not this card.

**Verdict: defective (root cause #1).** Uncapped linear extrapolation +
non-normal set types in the candidate pool. Either alone inflates; both
together produced 232.5.

---

## 2. Header "@ 1 RIR" vs chips "@9 / @7.5"

**Where.** `lastSessionMeta`, `ExerciseCard.tsx:1749-1772`. Line 1756:

```ts
const rir = lastSets[0].rpe != null ? Math.max(0, Math.round(10 - lastSets[0].rpe)) : null;
```

The single collapsed RIR is the **first set only** — not best, mean, or
mode — while the reps list shows the first three sets. The expanded
chips (`ExerciseCard.tsx:2043-2056`) print raw stored RPE (`@9`,
`@7.5`). So "×12, ×10, ×8 @ 1 RIR" applies set 1's effort to a line that
lists all three sets.

**Conversion consistency: three sources of truth, confirmed.**

| Consumer | Conversion | RPE 7.5 → |
|---|---|---|
| Header meta line (`ExerciseCard.tsx:1756`) | `Math.round(10 − rpe)` | **3** (`Math.round(2.5)` rounds up) |
| Anchor estimator (`e1rmAnchor.ts:40`) | raw `10 − rpe` | 2.5 |
| Engine read paths (`setRecommender.resolveLastRir`, `lastSessionE1RM` at `ExerciseCard.tsx:566`, gating at `:786`) | `rpeToRir` bucket (`types/schema.ts:2589-2595`) | **2** |

A first set logged @7.5 would header-display "@ 3 RIR" while the engine
grades it as 2 RIR. In your repro set 1 was @9, where all three agree
(1), so the header happened to be right — but the mechanism is wrong.

**Verdict: defective display (downstream symptom).** Misleads the reader
into treating one set's observed effort as a session-level target (this
is exactly what made item 9's premise look like a phase change).

---

## 3. Prescription engine: e1RM → 132.5 × 12–20 @ 3 RIR

**Full path.** `page.tsx:5511` passes `exerciseHistories[id]` →
`ExerciseCard.anchorE1RMKg` (`ExerciseCard.tsx:844`) →
`buildSlotSeed` (`:852-877`) → `recommendSeedForSlot`
(`services/setRecommender.ts:983-1198`) → `workingWeightFromAnchor`
(`:932-964`).

**No %1RM table.** The load is the inverse-Epley curve answer for the
**middle of the rep range** at the target RIR
(`setRecommender.ts:940-942`, `weightForReps` at `:154-156`):

```
mid = round((12+20)/2) = 16
raw = e1RM / (1 + (16 + 3)/30) = 105.46 kg / 1.6333 = 64.57 kg (142.4 lbs)
```

Your 57%-of-e1RM observation is this: mid-range 16 reps + 3 RIR = 19
effective reps → 1/1.633 = 61% pre-clamp; the clamp dragged it to 57%.
An inflated e1RM and a ~19-effective-rep target %1RM partially cancel —
your read was correct.

**Where 12–20 comes from.** `block.targetRepRange`, stored on the
`exercise_blocks` row when the session was built; for this exercise it
matches the library default `ARRAY[12,20]` (`supabase/seed.sql:341`).
(`repRangeEngine` — calves classed slow-twitch, `repRangeEngine.ts:38`,
`+2/+3` adjustment at `:93-96` — produces similar ranges when the
builder derives instead of using the default.) It is per-exercise
static, not phase-switched at render.

**Where 3 RIR comes from.** `block.targetRir` (library default **2**) →
`getAdjustedRIR` (`services/rpeCalibration.ts:457-497`): with a stored
calibration bias of −1, `prescribedRIR = 2 − (−1) = 3` →
`effectiveTargetRir = clamp(prescribed + readinessDelta, 0, 4)`
(`ExerciseCard.tsx:390-396`; readiness delta is 0 or 1,
`services/fatigueEngine.ts:694-728`). The "· calibration-adjusted"
suffix (`ExerciseCard.tsx:1659-1662`) renders **iff** the calibration
adjustment fired, so in your repro the 3 is calibration-driven
(2 + 1 from your AMRAP calibration bias), not a phase target and not
hardcoded per muscle.

**Verdict: mechanism sound, inputs poisoned.** The curve math is
self-consistent; it was fed a fictional 232.5 anchor.

---

## 4. The clamp ("held near recent working weight")

**Location.** `workingWeightFromAnchor`, `setRecommender.ts:944-961`;
copy at `ExerciseCard.tsx:1613-1614` (the parenthetical renders when
`seed.clamped` is true); "calibration-adjusted" is a separate,
unrelated suffix (see item 3).

**Two distinct mechanisms share the copy:**

1. **±band clamp** (`:947-950`): prescribed weight bounded to
   ±`WORKING_WEIGHT_CLAMP_FRACTION = 0.10` (`constants.ts:72`) of the
   best recent working weight (61.23 kg → band [55.11, 67.36] kg).
   Raw 64.57 kg is **inside** the band — this clamp did NOT bind.
2. **All-sets bump gate** (`:955-960`): if the previous session didn't
   earn a bump, the prescription is ceilinged at the recent working
   weight exactly. `earnedSessionBump` → `sessionMetPrescription` →
   `gradeSession` (`setRecommender.ts:236-278`): the 12-rep top set is
   graded, 12 < repMax 20 → not met → gate binds. (The ×10 and ×8 sets
   fall below repMin 12 and are excluded from grading entirely by the
   scheme window at `:255-259`.)

**Pre-clamp load in this case: 64.57 kg = 142.4 lbs** (would have
displayed 142.5 lbs). Post-gate: 61.23 kg →
`roundToIncrement(61.23, 5.0)` = **60 kg** → displayed **132.5 lbs**.

**Logging/surfacing when it fires:** none beyond the `clamped` boolean →
the "(held near recent working weight)" parenthetical and one extra
info-sheet line (`ExerciseCard.tsx:1619-1623` — which, note, describes
the ±10% band even when the actual binder was the bump gate). No
console warning, no magnitude reported, no plausibility check on the
anchor.

**Verdict: yes — the gate is silently masking a bad upstream number.**
It is doing its job (it contained a 232.5-lb fiction to a sane load),
but per the no-silent-failures rule, a raw prescription 5.5% above the
recent working weight off an anchor 20% above any visible set's e1RM
should be surfaced, not smoothed. Downstream symptom; root cause is
item 1.

---

## 5. "Ahead" badge

**What it compares.** `getExerciseProgression`
(`services/progressionInsights.ts:181-276`), rendered at
`ExerciseCard.tsx:1954-1958`. It fits a linear-regression slope over
per-session best e1RMs (up to 12 sessions) and compares weekly %
change against the experience-level expectation:
intermediate 0.3%/week (`progressionInsights.ts:32-36`), "ahead" at
≥ 1.25× = **0.375%/week** (`:39`, `:255`). Goal-aware: on a cut,
*any* gain ≥ 0.1%/week reads "ahead" (`:107-122`).

**Its e1RM is a THIRD formula.** Snapshots are built live from history
blocks (`page.tsx:1235-1236` → `components/workout/exercisePerformance.ts:69`)
using `plateauDetector.calculateE1RM` → `strengthCalculations.estimate1RM`
(`services/shared/strengthCalculations.ts:61-90`): Brzycki/Epley/Lombardi
average, effective reps **capped at 15**. So the badge's trend is
computed on numbers that can disagree with the card's 232.5 (item 1
formula) and with the persisted snapshot table (item 1, RPE-blind
formula #4).

**How "Ahead" coexists with a load decrease.** They measure different
things with different formulas: the badge is a **backward-looking trend
of session-best e1RMs** (high-rep sets, capped at 15 eff reps, still
reward rep gains — 3 sessions of climbing reps at 135 produce a
strongly positive slope); the prescription is a **forward-looking load
decision** whose −2.5 lbs isn't even a decision — it's a rounding
artifact (item 7). Neither surface checks the other. The badge is
arguably *correct* here (reps did trend up); the prescription line is
the broken one. But because the two share no e1RM definition, they
cannot be reconciled even in principle — that's the defect.

**Verdict: not independently wrong, but built on formula sprawl
(root cause #2) and unreconciled with the prescription surface.**

---

## 6. Set 1 defaults to 10 reps against a 12–20 target

**Origin.** Initialization effect `ExerciseCard.tsx:1090-1095`
(`prevSet` branch): weight = `seed.weightKg` (60 kg), reps =
`seedRepsForWeight(60, seed)` (`:885-903`) → `prescribe()`
(`setRecommender.ts:427-444`):

```
reps = round(30 × (e1RM/weight − 1) − targetRir)
```

**Critically, the e1RM here is NOT the 232.5 anchor.** By design
(comment at `ExerciseCard.tsx:906-912`), rep answers use the
"prescription ladder": `lastSessionE1RM` — best Epley-with-`rpeToRir`
over last session's sets (`:561-572`) = 61.23 × (1 + 13/30) =
**87.77 kg (193.5 lbs)**. At 60 kg, RIR 3:
`round(30 × (87.77/60 − 1) − 3) = round(10.885) = 11` — computed 11 vs
observed 10; the ±1 depends on the exact stored kg/RPE values (the dump
script prints the observed inputs; a stored weight of ~60.6 kg or a
half-point of RPE moves it to 10).

**Why it isn't clamped to the 12 floor: deliberate.** `prescribe()`'s
contract ("honest reps", `setRecommender.ts:415-425`, design §7): reps
are strictly the curve answer, "NEVER a range max, range mid, or any
other constant fallback" — a mis-matched load must show its honest
out-of-range prediction. That rule is sound.

**The actual defect is the dual anchor.** The **weight** was picked so
you'd land ~16 reps on the 232.5 anchor; the **reps** were predicted
from the 193.5 anchor at that weight. One prescription line, two
capacity models → "132.5 × (12–20 banner) with a 10-rep default", which
is self-contradictory to the user. With a single honest anchor
(~193.5), the weight pick for mid-range would have been
87.77/1.633 = 53.7 kg (~118 lbs) — or, more sensibly with the gate,
hold 135 and ask for reps.

**Verdict: symptom of root cause #2 (multiple anchors), not a missing
clamp.**

---

## 7. −2.5 lbs on 135: increment and rounding

**Is equipment granularity modeled?** Partially. Each exercise carries
`minWeightIncrementKg` (Seated Calf Raise: **5.0 kg**,
`supabase/seed.sql:341`); engine paths default to 2.5 kg when absent
(`setRecommender.ts:497,984`). There is no per-implement model beyond
this scalar, and **no lb-native grid** for lb users.

**Where the −2.5 lbs actually comes from.** The bump gate resolved to
"hold at the recent working weight" — 61.23 kg exactly — but
`workingWeightFromAnchor` then re-rounds that held value to the kg
increment grid: `roundToIncrement(61.23, 5.0)` = **60 kg**
(`setRecommender.ts:963`), displayed via `formatWeightValue`'s 2.5-lb
display rounding (`lib/utils.ts:290-300`) as **132.5 lbs**. So the app
did not decide to reduce the load; it decided to HOLD and then
corrupted the held value by snapping a lb-native weight (61.23 kg is
not on the 5-kg grid) to the machine grid. Note the contrast:
`recommendSessionStart`'s `holdVerbatim` (`setRecommender.ts:689-696`)
deliberately returns the previous weight **unrounded** — the seed path
lacks that rule.

**Minimum-meaningful-change threshold:** none on the session-start seed
path. (Within-session there is an effort deadband — `DEADBAND_RIR = 2`,
`constants.ts:133` — but nothing suppresses sub-increment or
sub-noise-floor deltas produced by rounding at session start.)

**Verdict: defective (root cause #3).** A hold must reproduce the held
weight exactly; and a 1.85% delta on a calf machine with a 5-kg
(11-lb) actual increment is below any meaningful granularity —
it's pure grid aliasing.

---

## 8. Double progression

**It exists — but not on the path that ran.** The v4 session-start
logic (`recommendSessionStart`, `setRecommender.ts:741-784`;
version notes `constants.ts:32-38`) is textbook double progression:
prescription met (top set at repMax) → bump load, reseed reps at
repMin; not met → **same load, prevReps + 1** capped at the ceiling;
2-session stall → hold; 3rd → deload flag.

**But** `recommendSeedForSlot` only routes there as the **no-anchor
fallback** (`setRecommender.ts:1163-1185`). With any positive stored
e1RM (`hasAnchor`, `:1053`), the working slot takes the anchor path
(`:1141-1161`): weight from the curve + clamp/gate, reps from the
curve. The "hold 135, target the rep floor on all sets" ask — your
correct call for 12/10/8 vs a 12 floor — is never generated on the
anchor path. The bump gate does *grade* per §10 (top set must reach
repMax — so it correctly withheld a load increase here), but the rep
**seeding** side of double progression (ask for 12s, then +1) is absent
whenever an anchor exists — which is essentially always after 2+
sessions.

**Verdict: partially implemented; the dominant (anchor) path is
%-of-e1RM-driven for reps and bypasses rep-progression seeding.
Downstream of root cause #2, but an independent design gap.**

---

## 9. Training phase / RIR 1 → 3

**No phase transition occurred in the code path.** The render-time RIR
is `block.targetRir` (static per block, library default 2 for this
exercise) modified only by (a) RPE-calibration bias
(`rpeCalibration.getAdjustedRIR`) and (b) readiness easing (0 or +1).
Your card said "calibration-adjusted" — that suffix renders only when
(a) fired (`ExerciseCard.tsx:1659-1662`), so the 3 = 2 + 1 from your
calibration bias. Whether the block's stored `target_rir` itself
changed between Jul 20 and Jul 25 (e.g. a new mesocycle week writing
different block targets at session build) is a data question the dump
script answers by printing both sessions' block rows.

**More importantly, the premise doesn't hold:** last session's "@ 1
RIR" was never a target — it's the header's collapse of set 1's
**observed** RPE 9 (item 2). The evidence does not show a 1→3 target
move; it shows an observed-effort label being read as a target because
the copy formats them identically.

**On the copy critique:** agreed in principle — if/when an intentional
backoff drives the number, the reason line should say so. Today
"calibration-adjusted" correctly names the RIR adjustment but sits next
to a load delta it did not cause (the −2.5 lbs is item 7's rounding),
inviting exactly this misattribution.

**Verdict: no phase logic involved; display/copy defect (item 2) plus
rounding artifact (item 7) manufactured the appearance of a deliberate
backoff.**

---

## Defect ranking

### Root causes

| # | Defect | Where | Effect in repro |
|---|--------|-------|-----------------|
| **R1** | e1RM anchor: (a) uncapped linear Epley above 12 effective reps, (b) candidate pool includes non-`normal` set types (dropset/myorep/rest_pause/AMRAP) that the UI never shows | `e1rmAnchor.ts:37-43`; `suggestions.ts:295` | The 232.5 fiction |
| **R2** | Five e1RM formulas / two anchors on one card: anchor+display (`historySetE1RM`), rep-seed (`lastSessionE1RM`, Epley+`rpeToRir`), badge (`strengthCalculations.estimate1RM`), persisted snapshots (`lib/utils.estimateE1RM`, RPE-blind), coaching (`coachingEngine.estimate1RM`). Known debt: `docs/WEIGHT_REP_ENGINE_AUDIT.md` §Still open | multiple | Weight picked for 16 reps, default says 10; badge irreconcilable with card |
| **R3** | Held weight re-rounded to the kg increment grid (no hold-verbatim rule on the seed path; no lb-aware grid; no min-meaningful-change threshold) | `setRecommender.ts:963`; contrast `:689-696` | The −2.5 lbs "decrease" |

### Downstream symptoms

| # | Symptom | Of |
|---|---------|----|
| S1 | Bump gate silently corrects implausible anchors; no warning, and the info-sheet line describes the ±10% band even when the gate was the binder | R1 |
| S2 | Set-1 reps default (10) contradicts advertised range (12–20) | R2 |
| S3 | Header "@ 1 RIR": first-set-only collapse, `Math.round(10−rpe)` vs `rpeToRir` inconsistency; reads like a target | display |
| S4 | "Ahead" badge coexists with an apparent load decrease | R2, R3 |
| S5 | "calibration-adjusted" adjacent to a rounding-caused load delta implies causation | R3 + copy |
| S6 | Double-progression rep seeding absent on the anchor path (never asks 12/12/12) | design gap |

---

## Proposed fixes (NOT implemented — awaiting approval)

1. **Cap the anchor formula & clean the pool (fixes R1).** In
   `historySetE1RM`, clamp effective reps (suggest 15, matching
   `strengthCalculations`); in `computeHistoryFromBlocks`, restrict
   anchor entries to `set_type === 'normal'` (matching `workingSetsOf`).
   *Blast radius:* every stored-anchor prescription and the "Estimated
   1RM" display, plus the mesocycle session build
   (`lib/training/startMesocycleSession.ts:325` shares the function) —
   high-rep exercises' displayed e1RMs and pre-clamp picks drop
   (intended). `engineRegressionBaseline.test.ts` and
   `anchorRecencyDecay.test.ts` pin current outputs and will need
   updating. Low-rep exercises: bit-identical.

2. **Single anchor per card (fixes R2 locally).** Feed the same e1RM
   into the weight pick and `seedRepsForWeight` (i.e. make the rep-seed
   ladder and `anchorE1RMKg` agree, or pick the weight from the ladder).
   *Blast radius:* `ExerciseCard` seeding + banner + its tests; no
   engine change. (Full formula unification is the larger, already-
   documented TODO — audit doc §Still open.)

3. **Hold-verbatim on the seed path + unit-aware rounding (fixes R3).**
   When the gate ceilings at `recentWorkingWeightKg`, return it
   **unrounded** (mirror `holdVerbatim`); round only genuinely new
   prescriptions, and round in the user's display unit (or treat
   |Δ| < minIncrement as "hold, show last weight verbatim").
   *Blast radius:* seed weights everywhere; small numeric shifts on
   lb-user seeds; several `ExerciseCard`/`setRecommender` tests.

4. **Loud clamp (fixes S1).** When the gate/clamp moves the raw
   prescription by more than some fraction (suggest >10–15%), emit a
   `console.warn` with the pre/post values and add a provenance line
   ("est. 1RM looks high vs recent working sets — held at recent
   weight"); fix the info-sheet line to name the binder that actually
   fired. *Blast radius:* copy + one flag; trivial.

5. **Header honesty (fixes S3).** Per-set effort chips via `rpeToRir`,
   or copy like "top set left ~1 RIR"; never a bare "@ N RIR" that
   parses as a target. *Blast radius:* one component block; trivial.

6. **Rep-progression seeding on the anchor path (fixes S6).** When
   `bumpEarned === false` and no regression: hold the recent working
   weight and seed reps per the §10 rule (repMin floor / prevTopReps+1)
   instead of the raw curve answer. *Blast radius:* medium —
   `recommendSeedForSlot` behavior change for every returning exercise;
   needs design sign-off against the "honest reps" principle (a seeded
   *ask* is a plan, arguably exempt from the honest-curve rule that
   governs *predictions*).

7. **Badge/snapshot formula alignment (S4, R2).** Compute badge
   snapshots and the persisted `exercise_performance_snapshots` rows
   with the same capped formula chosen in (1). *Blast radius:* trend
   surfaces (plateau, pace, history page); persisted historical rows
   were written RPE-blind and would need a decision (leave stale vs
   backfill — backfill touches stored data, so it is explicitly out of
   scope until you approve).

---

## Instrumentation (observed values)

`scripts/auditE1rmPrescriptionDump.ts` (added alongside the existing
read-only audit scripts; SELECT-only, mutates nothing, imports the
app's own pure functions so printed numbers are the app's numbers, not
re-derivations). It dumps, for one exercise:

- every stored set for the last 5 completed sessions: raw `weight_kg`,
  `reps`, `rpe`, `set_type`, `feedback.repsInTank`, `is_warmup`;
- per-set `historySetE1RM`, its decay weight and decayed value, and
  which row wins the max (⇒ the exact set behind 232.5);
- the block's stored `target_rep_range` / `target_rir` for each of the
  sessions (answers item 9's data question);
- the seed replay: `recommendSeedForSlot` inputs, raw pre-clamp load,
  ±band, bump-gate verdict (`sessionMetPrescription` per set), post-gate
  and post-rounding loads;
- the rep-seed replay: `lastSessionE1RM`, `prescribe()` answer at the
  seeded weight (⇒ the exact source of the 10);
- badge inputs: per-session `strengthCalculations` e1RMs and the fitted
  weekly slope vs the "ahead" threshold.

Run (read-only creds; no env vars are present in this environment, so
it must run where Supabase keys exist):

```bash
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
AUDIT_USER_ID=<uuid> AUDIT_EXERCISE_NAME="Seated Calf Raise" \
npx -y tsx scripts/auditE1rmPrescriptionDump.ts
```

It intentionally does not touch `workoutStore` or write any table.
