# Calibration Bias Audit — Findings (Seated Calf Raise, live session Jul 25 2026)

**Status: INVESTIGATION ONLY. No code changes, no data changes, workout
session store untouched. Fixes proposed at the end are NOT implemented.**

Supersedes parts of `docs/E1RM_PRESCRIPTION_AUDIT_FINDINGS.md` (the
"first audit"). Scorecard against your hypothesis at the end; short
version: **calibration is the root cause of the load cascade, but it is
NOT inside the e1RM — the 232.5 is a separate, still-standing bug, and
your 125×(1+26/30) reconstruction is a numerical coincidence that is
causally impossible** (232.5 was on the card before set 2 existed — it
appeared with the identical value against the Jul 20 history earlier the
same day).

## The one state that reproduces everything

With per-exercise calibration **bias = −10 reps** loaded at page start,
every observed number in your repro reproduces exactly:

| Observation | Reproduction |
|---|---|
| Popover "Adjusted up by 10 … push 10 reps closer to failure" | `getAdjustedRIR`: bias −10 → adjustment −10 → reason string (`services/rpeCalibration.ts:478,493-495`) |
| Popover "Target: 12–20 leaving 4 in reserve (RIR 4)" | prescribedRIR = 2−(−10) = **12** (`rpeCalibration.ts:479`), then ExerciseCard clamps to **4** (`ExerciseCard.tsx:392-396`) |
| Set-1 banner "@ 3 RIR" (earlier today) | the banner has its **own display clamp to ≤3**: `rir={Math.max(0, Math.min(3, loggerTargetRir))}` (`ExerciseCard.tsx:2685`) → min(3, 4) = 3. Not a different bias — the same 4, shown as 3 |
| Set-1 prefill 10 reps (first audit's unresolved ±1) | `prescribe(e1RM 87.77 kg, 60 kg, rir **4**)` = round(9.885) = **10** ✓ — resolved: the prefill ran with the clamped RIR 4 |
| Set-3 "down 15 lbs — last set was harder than the target effort" | set 2 logged 1 RIR; dev = 1 − 4 = −3 ≤ −DEADBAND(2) → `reduce_load` (`setRecommender.ts:551-556`); ideal = weightForReps(86.94 kg, 16, 4) = 52.2 kg → round to 5 kg grid → 50 kg = **110 lbs** ✓ |
| "× 17" | `predictRepsAtWeight(86.94, 50 kg, rir 4, 2 sets done)` = round(17.12) = **17** ✓ |
| Banner "@ 0 RIR" | AMRAP override: `loggerTargetRir = activeIsAmrap ? 0 : …` (`ExerciseCard.tsx:2597`) |
| Prefill 16 vs banner 17 | AMRAP prefill effect overwrites with `predictAmrapReps` = 15+1 = **16** (`ExerciseCard.tsx:1150-1165`), while the banner shows `max(rec.reps 17, amrap 16)` (`ExerciseCard.tsx:1561-1563`) |
| 132.5 → 125 → 110 cascade | every honestly-rated 1-RIR set reads as "3 harder than target" against the poisoned RIR-4 target → reduce_load each set. **The cascade is driven by the RIR target, not by e1RM.** |

So: one poisoned number (bias −10), amplified by a deadband
comparison against a clamped target, with three different display
clamps making it look like three different bugs.

---

## Item 1 — The calibration "accumulator" (PRIMARY): root cause, but not an accumulator

**Where stored & units.** Per-exercise `CalibrationResult.bias`, in
**reps**, in an in-memory `Map` keyed by lowercased exercise **name**
(`rpeCalibration.ts:272,375`). It is **not persisted at all** — the
engine is rebuilt on every workout-page load by replaying the last **28
days** of `set_logs` (`page.tsx:1445-1537`). (An `amrap_calibrations`
table exists but is a write-only audit trail for in-session AMRAP events
— inserted at `page.tsx:2419-2434`, read back only for completed-session
summaries at `page.tsx:1256-1279`. The live engine never reads it.)

**Update rule.** Not a running mean, EWMA, or cumulative sum —
**last-AMRAP-wins replacement**:
`bias = actualReps − fatigueAdjustedPredictedMax` computed fresh per
AMRAP event and the whole record replaced
(`rpeCalibration.ts:358,375`). The prediction is the mean of
`reps + reportedRIR` over non-AMRAP sets of the same exercise at
±10% of the AMRAP's weight within 4 weeks, fatigue-decayed by set
position (`:316-322`, `:212-254`).

**Clamp / decay / half-life: none.**
- No bound on `bias` magnitude.
- No bound on the applied `adjustment = Math.round(bias)`; only
  gates are confidence ≠ low, method = v2, and a ±1 dead zone
  (`:463-468`). `prescribedRIR = max(0, target − adjustment)` has a
  floor but **no ceiling** (`:479`) — hence 12.
- No per-event movement limit: bias can jump −1 → −10 in **one**
  event.
- No staleness decay: `needsCalibration()` (14-day check, `:502-512`)
  exists but **nothing on the prescription path calls it** — a
  months-old bias prescribes forever (within the 28-day replay window,
  the triggering set ages out naturally, which is the only implicit
  decay).

**So "runaway accumulation" is refuted — it's worse in a different
way:** an unbounded *snapshot* that a single bad event can set to any
value, recomputed silently on every page load.

**The actual poison — "AMRAP" is inferred, not declared.** On replay,
*any* stored set with `rpe >= 9.5` on a `push_freely` exercise is
treated as an AMRAP calibration event:
`page.tsx:1500` — and Seated Calf Raise defaults to `push_freely`
(`exerciseSafety.ts:108-109`). A set rated with the "Maxed Out" chip
(RIR 0 → stored RPE 10, `types/schema.ts:2575-2576`) or logged through
the **auto-prefilled RPE 9.5 AMRAP suggestion** becomes a "measured
max". A fatigued 8-rep grinder rated 0-RIR at a weight where 4 weeks of
sets implied ~18 reps ⇒ bias ≈ −10. In-session the same inference
applies (`rpe >= 9.5 && last set && push_freely`, `page.tsx:2385`).

**Write history:** replay-inferred events write nothing anywhere — the
−10 may have *no* audit row. Only live in-session AMRAP events persist
to `amrap_calibrations`. The dump script reconstructs the full replay
(each inferred event, its comparison pool, and the bias delta) and
cross-references the audit table; identifying the exact triggering set
requires running it against the database (no credentials exist in this
environment).

**Verdict: ROOT CAUSE of the load cascade — confirmed, with the
mechanism corrected: mislabeled max tests + unbounded single-shot bias,
not gradual accumulation.**

---

## Item 2 — Sign correctness: internally consistent; REFUTED as a bug

Convention (`rpeCalibration.ts:356-358`): `bias = actual − predicted`;
**positive = sandbagging** (did more than reports implied), **negative
= overreaching** (did less). Bias −10 ⇒ your AMRAP fell 10 reps short
of what your RIR reports predicted ⇒ the engine concludes your reported
RIR **overstates** your reserve ⇒ "you push ~10 reps closer to failure
than you report." Copy direction matches the math.

The prescription response is also coherent *given the bias*: if
reported RIR ≈ true RIR + 10, then to land a true RIR 2 you must be
told to stop at a *felt* 12 (`:476-479`). Reported-RIR and true-RIR are
never swapped at any boundary I traced (report → `10 − rpe` at
ingestion, compared against actual reps; adjustment applied to the
displayed target only).

**And the key negative result: the bias does NOT inflate e1RM.**
A −10 bias raises the *shown* RIR target; the only places the target
RIR touches an e1RM are fallbacks for sets with **no logged effort
signal** (`resolveLastRir` 3rd branch, `setRecommender.ts:134-142`;
`sessionBestE1RM`/`lastSessionE1RM` fallbacks, `ExerciseCard.tsx:543,566`)
— and those are fed `effectiveTargetRir`, already clamped to ≤4. Your
sets all carried RIR/RPE, so contamination was zero. The 192→232.5 gap
is the **first audit's** anchor bug (uncapped `historySetE1RM` +
non-`normal` set types in the anchor pool), unchanged and still open.

---

## Item 3 — Injection point: REFUTED (offset is not inside e1RM)

The offset is **never added to reps-to-failure before Epley**, and
there is no "calibrated e1RM" field — no field is shared. Complete
consumer list of the bias:

1. `getAdjustedRIR` → `adjustedRir` prop (`page.tsx:5514-5519`) →
   `effectiveTargetRir` (`ExerciseCard.tsx:390-396`) → within-session
   `recommendSet` targets, seed targets, rep predictions, banner/popover
   copy. **This is the sole prescription-path consumer.**
2. Display-only: `SessionSummary` / `CalibrationResultCard` (verdict
   badges), from per-session results — not from the live bias.
3. `analyzeOverallBias` — tests only; no app surface currently calls it.

`startMesocycleSession` (stored plan builder) does **not** apply
calibration — persisted block targets are clean.

The causal impossibility, restated: the card read "Estimated 1RM 232.5
lbs · 5 sessions" **before today's set 2 was performed** (identical
value earlier the same day against the Jul 20 history — first audit).
`estimatedE1RM` is computed at page load from *completed* sessions only
(`suggestions.ts:341-362`); an in-progress session cannot feed it. So
232.5 cannot be 125×15 with +10 injected. The arithmetic match
(233 ≈ 232.5) is coincidence; the real producer is the uncapped anchor
formula on a hidden high-rep set (first audit, item 1).

---

## Item 4 — Feedback loop: CONFIRMED, via the RIR target; no damping anywhere

The loop, corrected to what the code actually does:

```
bad "AMRAP" event (rpe≥9.5 grinder or tapped-through prefill)
  → bias −10 (one shot, unbounded)              rpeCalibration.ts:358
  → prescribedRIR 12 → effectiveTargetRir 4      ExerciseCard.tsx:392-396
  → every honest 1-RIR set: dev = −3 → reduce_load   setRecommender.ts:551
  → −10…15% per set (132.5 → 125 → 110)
  → last set: AMRAP suggested, RPE 9.5 + predicted reps PRE-FILLED
  → if tapped through unedited: a fabricated "max" enters set_logs
  → next page load replays it as a calibration event (rpe≥9.5)
```

- **Damping / gain limit / per-session cap: none.** Bias is replaced
  wholesale per event; a mid-session AMRAP (`page.tsx:2387-2400`)
  updates the ref'd engine immediately, so subsequent sets in the same
  session re-prescribe off the new bias with no rate limit.
- **Is the AMRAP excluded from calibration input?** From the
  *comparison pool*, yes (`!s.wasAMRAP`, `rpeCalibration.ts:318`). But
  the deeper problem is the converse: sets that were never max tests
  are *included as AMRAPs* by the rpe≥9.5 inference. And the AMRAP
  suggestion pre-fills both RPE 9.5 (`ExerciseCard.tsx:1036,1102-1103`)
  and the predicted rep count (`:1150-1165`) — **the app pre-fills the
  answer to its own calibration test**; a lazy confirm logs a
  fabricated max that then drives the bias. Self-reinforcing loop:
  confirmed explicitly.
- One accidental circuit breaker: the ±10% weight filter. An AMRAP at
  110 lbs has no comparison sets (125 is 13.6% away) → "First
  calibration — no prior data" → **bias silently resets to 0**
  (`rpeCalibration.ts:324-340`). The loop is therefore not monotone —
  it lurches, which is arguably worse for trust: the offset can vanish
  as mysteriously as it appeared.

---

## Item 5 — RIR target disagreement: CONFIRMED — four presentations of one number

| Surface | Value shown | Source |
|---|---|---|
| Set-1 banner "@ 3 RIR" | min(**3**, effectiveTargetRir 4) | banner's own `[0,3]` clamp, `ExerciseCard.tsx:2685` |
| Set-3 banner "@ 0 RIR" | **0** | AMRAP override `loggerTargetRir = activeIsAmrap ? 0 : …`, `:2597` (correct in intent) |
| Popover "leaving 4 in reserve (RIR 4)" | **4** | `effectiveTargetRir` raw, `:1655` — not AMRAP-aware, so it contradicts the "push to failure" line (`:1667-1669`) on the same sheet |
| Popover "Adjusted up by 10" | **±10** | unclamped `adjustment`, `rpeCalibration.ts:493-495` — reports an adjustment of which only +2 was actually applied (2→4); the clamp silently ate 8 |

So "3 vs 4" is not two biases at two times — it is one value (4) passing
through two different display clamps. There is no single source of
truth; the engine math uses `effectiveTargetRir` (4), and three copies
diverge from it in three directions. The set-3 "0" is the only one
that's arguably right, and even it contradicts the popover's target
line.

---

## Item 6 — Prefill off-by-one: CONFIRMED, two writers per field

- **Set 3 (17 vs 16):** banner reps = `max(recommendSet 17, predictAmrapReps 16)`
  (`ExerciseCard.tsx:1561-1563`); the input was then overwritten by the
  AMRAP-prefill effect with `predictAmrapReps` **alone** = 15 + 1 RIR =
  16 (`:1150-1165`; `predictAmrapReps` at `setRecommender.ts:827-835`).
  Two formulas for the same concept; the banner takes the max, the
  prefill doesn't.
- **Set 1 earlier (12–20 banner vs 10 prefill):** resolved above — the
  prefill is the honest curve answer at RIR 4 (round(9.885) = 10)
  computed once at mount and frozen by dirty-tracking, while the banner
  renders the range and a display-clamped "3". Same defect class:
  prescription, banner, and prefill are computed by different code at
  different times with different clamps.

---

## Item 7 — "Ahead" badge: independent of calibration; "symptom of item 1" REFUTED

The badge never reads the bias and never reads the 232.5 anchor. It is
a linear-regression slope over per-session best e1RMs computed with a
**third** formula (`strengthCalculations.estimate1RM`, capped at 15
effective reps) via `buildPerformanceSnapshots`
(`exercisePerformance.ts:69`, `progressionInsights.ts:243-263`;
"ahead" ≥ 0.375%/week for intermediate). It reads only **completed**
sessions, so today's 135→110 cascade is invisible to it; and multi-week
rep gains at constant load legitimately produce a positive e1RM slope.
It coexists with the load drop because it measures a different quantity
over a different window with a different formula — the first audit's
formula-sprawl finding (its root cause #2), not a calibration symptom.

---

## Item 8 — Data quality: CONFIRMED — no plausibility gating anywhere

- The comparison-pool filter is name + ±10% weight + 4 weeks + non-AMRAP
  — nothing else (`rpeCalibration.ts:316-322`). No rep-scheme window,
  no monotonicity check, no outlier rejection; the mean (not median) of
  implied maxes is taken (`:249-252`), so one 20-rep set skews it.
- Set 2's 15@125-after-11@132.5 is ingested as-is. A sanity checker
  exists (`checkSetSanity`, called at `page.tsx:2377`) but its result
  only drives a UI prompt — **calibration ingestion at `:2446-2458`
  runs regardless of the sanity verdict.**
- The replay's RIR conversion adds its own noise:
  `Math.round(10 − rpe)` (`page.tsx:1499`) turns the "Good (2–3 RIR)"
  chip's stored RPE 7.5 into RIR **3** (JS rounds 2.5 up), while the
  engine's canonical `rpeToRir` says **2** (`types/schema.ts:2589-2595`).
  Every 7.5-RPE comparison set's implied max is inflated ~0.5–1 rep,
  systematically pushing bias negative. (Note set 2's 15@125 ≈ e1RM 192
  is consistent with the *first audit's* honest capacity estimate —
  the "noise" here largely reflects real capacity that the RIR-4 target
  misreads.)

---

## Corrected causal map (vs your hypothesis)

Your map: 1 root; 3/4/8 mechanism; 2/5/6/7 independent/downstream.

| Item | Your call | Verdict |
|---|---|---|
| 1 calibration | root | **ROOT — confirmed**, mechanism corrected: unbounded snapshot from *inferred* AMRAPs, not an accumulator |
| 3 e1RM injection | mechanism | **REFUTED** — bias never enters e1RM; 232.5 is the first audit's anchor bug (still open, separate root) |
| 4 feedback loop | mechanism | **CONFIRMED** — but routed through the RIR target → reduce_load cascade; AMRAP prefill is an extra fabrication vector |
| 8 data quality | mechanism | **CONFIRMED** — no gating; plus the round(2.5)→3 conversion skew |
| 2 sign | independent | **NOT A BUG** — direction consistent end-to-end; magnitude is the problem |
| 5 RIR surfaces | independent | **CONFIRMED downstream** — one value, three display clamps + unclamped copy |
| 6 prefill | independent | **CONFIRMED downstream** — dual writers per field |
| 7 badge | independent | **INDEPENDENT confirmed** — first audit's formula sprawl; not calibration |

Two coexisting roots overall: **RC-A** (this audit): the calibration
bias pipeline; **RC-B** (first audit, still standing): uncapped
`historySetE1RM` + contaminated anchor pool → the 232.5 display.
"The estimator is fine" is half-true: Epley on your honest sets is
sound; the *displayed* 232.5 is still RC-B's artifact.

---

## Proposed fixes (NOT implemented — awaiting approval)

1. **Stop inferring AMRAPs (RC-A kill shot).** Calibration events only
   from explicitly-declared max tests: persist an `is_amrap` marker at
   log time (additive `set_logs` column, or treat `amrap_calibrations`
   as the source of truth) and delete the `rpe >= 9.5` inference at
   `page.tsx:1500` and `:2385`'s implicit variant. *Blast radius:*
   calibration only; one additive migration; users lose replay-derived
   biases (intended — see recoverability).
2. **Bound the adjustment.** Cap applied adjustment (suggest ±2), cap
   per-event bias movement (suggest 1 rep/event toward the new value),
   require ≥2 concordant events beyond ±1, and gate `getAdjustedRIR` on
   staleness (`needsCalibration` already exists, unused). Also clamp
   `prescribedRIR` at the source and make the reason copy report the
   **applied** adjustment. *Blast radius:* `rpeCalibration.ts` +
   its tests; any user currently carrying |bias| > 2 gets saner targets.
3. **Pool hygiene.** Median (not mean) of implied maxes; restrict
   comparisons to the block's rep-scheme window (reuse `gradeSession`'s
   logic); use `rpeToRir` (kill `Math.round(10 − rpe)` at
   `page.tsx:1499,2359,2390,2447`); optionally require the sanity check
   to pass before a set feeds calibration. *Blast radius:* calibration
   + readiness paths that share the raw conversion.
4. **Stop pre-filling the exam answers.** AMRAP sets: prefill neither
   RPE 9.5 nor predicted reps (or mark a fully-unedited prefilled set
   as non-calibrating). *Blast radius:* AMRAP UX +
   `ExerciseCard.tsx:1127-1174`.
5. **One RIR, shown once.** Derive a single display target (AMRAP-aware)
   and feed banner, popover target line, and logger from it; remove the
   banner's private `[0,3]` clamp (`:2685`) or make it the *only* clamp;
   make the popover's target line AMRAP-aware. *Blast radius:*
   `ExerciseCard` copy/props; trivial logic.
6. **Prefill = banner, verbatim.** Single computation feeding both
   (also fixes the first audit's S2). *Blast radius:* `ExerciseCard`
   effects; medium (touches the dirty-tracking rules).

**Recoverability: recomputation, automatically — nothing to invalidate.**
The bias is not persisted; it is a pure function of the last 28 days of
`set_logs` evaluated at page load. Deploying fixes 1–3 changes the
function and every user's bias corrects itself on next load. No stored
offsets exist to reset. Two data caveats: (a) `amrap_calibrations` rows
are an audit trail with no live readers — they can stay as history;
(b) stored RPE-9.5/10 rows from prefilled or misrated "AMRAPs" remain
in `set_logs` and are only neutralized by removing the inference
(fix 1) — under the current code they re-poison on every load.

---

## Instrumentation

`scripts/auditE1rmPrescriptionDump.ts` (extended; still SELECT-only,
uses the app's own functions — `RPECalibrationEngine`,
`computeFatigueAdjustedPrediction`, `getFailureSafetyTier`, the exact
`page.tsx` ingestion conversions — so printed values are the app's, not
re-derivations). New sections:

- **Calibration replay** for the target exercise: every `normal` set of
  the last 28 days in chronological order with raw RPE/RIR, per-set raw
  e1RM, whether the replay flags it as an AMRAP event, the bias
  **before → after** each event (the delta you asked for), and for each
  event the full comparison pool with implied maxes and the
  raw/fatigue-adjusted predictions. Final: stored bias, applied
  adjustment, prescribedRIR, and the post-clamp effective target.
- **Per-session prescription replay** (prescribed load + prefill value
  at each session's state, from the seed/recommend functions).
- **`amrap_calibrations` audit rows** for cross-reference (timestamps,
  triggering `set_log_id`, bias) — noting replay-inferred events have
  no rows there.
- **All-exercise bias distribution**: replays the same 28-day window
  for every exercise trained in it and prints each exercise's bias,
  confidence, applied adjustment, and a histogram — answers whether
  Soleus is an outlier or the fleet is drifting, and sizes fix 2's
  blast radius.

Run (needs Supabase read creds — none exist in this environment):

```bash
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
AUDIT_USER_ID=<uuid> AUDIT_EXERCISE_NAME="Seated Calf Raise" \
npx -y tsx scripts/auditE1rmPrescriptionDump.ts
```

No writes are performed by the script under any code path.
