# Finding 001, step 4 — can the engine be told what it asked for?

**Audit only. No code changed.**

The Set-3 contract is stated in terms the engine cannot currently evaluate:

> When a working set MISSES its prescribed rep target and reported RIR is at or
> below target, the next same-session prescription must not be the identical
> (load, reps) pair.

"Misses its prescribed rep target" needs two facts. The engine has one of them.

```
prescribed:  80 kg × 10 @ RIR 2     ← the engine never sees this
performed:   80 kg ×  9 @ RIR 1     ← this is all it gets
```

All 32 violations in the sweep share this: by every signal `recommendSet`
receives, the failed set was *fine* — reps inside the range, effort at or near
target. In every case `lastReps ≥ repMin` and `dev ∈ {0, −1, −2}`. The miss
only exists relative to an ask the engine is not given.

---

## 1. Where the previous prescription currently exists

**Nowhere, by the time it is needed.**

| Location | Holds it? | Notes |
|---|---|---|
| `recommendSet` / `nextSetPrescription` | Computed, returned, not retained | Two production callers |
| `ExerciseCard.recommendNext` (line 684) | Recomputed per render | Deliberate — see below |
| `ExerciseCard.buildSuggestionInfo` | Recomputed per render | Fresh so the banner keeps showing the engine's ask after the user edits the inputs |
| `pendingInputs` | Seeded from it, then user-editable | Not the prescription once touched |
| Page `activeSuggestionLabel` | A display **string** (`"60 kg × 7"`) | For the sticky rest bar |
| `workoutStore` (Zustand) | No | Sessions, blocks, set logs, timers, soreness |
| `set_logs` | No column | See §5 |
| `SessionDriver.logSet` | **Yes** — `prescribedFor` | Harness only; returned in `LogSetOutcome`, written to the trace, never persisted |

The comment on `buildSuggestionInfo` is explicit that recomputation is a
feature: it keeps the banner honest after the user edits the logger fields.
That is right for display, and it is exactly why nothing survives.

**The consequence.** At the moment set N+1 is prescribed, `completedSets`
already contains set N. Recovering set N's *ask* would mean replaying the
engine against a truncated `completedSets` — reconstruction, and not a faithful
one: the target RIR is readiness- and calibration-adjusted per set, so a replay
can produce a number that was never actually served.

---

## 2. Can it reach `SetRecommenderInput` without reconstruction?

**Yes — the value is in scope at the moment it would need capturing.**

`ExerciseCard` both computes the prescription and owns the set-submit handler.
The prescription served for set N is live when set N is submitted; capturing it
there (per block) makes it available for set N+1 with no derivation.

The harness needs no change at all: `SessionDriver.logSet` already takes
`prescribedFor` and the runner already threads it.

So this is a **capture at the log site**, not a new computation. That matters —
it is the difference between recording a fact and inferring one.

Shape, conceptually (naming to be decided):

```ts
previousPrescription?: {
  loadKg: number;
  reps: number;
  /** The target RIR THAT set was asked at — not the current one. */
  targetRir: number;
};
```

The `targetRir` field is not padding. The contract's condition is "reported RIR
at or below **the target RIR**", and target RIR moves per set with readiness and
calibration. Grading set N's outcome against set N+1's target would be a subtle,
permanent off-by-one.

---

## 3. Callers needing changes

| File | Change | Size |
|---|---|---|
| `services/setRecommender.ts` | Optional field on `SetRecommenderInput`; `recommendSet` reads it | Small |
| `services/prescription/sessionPrescription.ts` | Same optional field, passed through — this module computes nothing and must stay a conduit | Trivial |
| `components/workout/ExerciseCard.tsx` | Capture the served prescription at log time, feed it back | **The real work** |
| `simulation/sessionDriver.ts` | Pass the `prescribedFor` it already receives into `getPrescription` | Trivial |
| `scripts/auditProgressionDiff.ts` | None — optional field | — |

`recommendSessionStart` calls `recommendSet` with
`setsCompletedThisExercise: 0`. A session start has no previous *same-session*
prescription, so it passes nothing, and the field stays absent there by
construction rather than by omission.

---

## 4. Does provenance need to come too?

**No — keep `PrescriptionProvenance` out of the input.**

Provenance is an artefact of how the engine reasoned last time. Feeding it back
would let the engine branch on its own prior reasoning, which is a feedback loop
that is hard to reason about and harder to test: the same inputs could produce
different outputs depending on a path taken two sets ago.

What the decision needs is what was **asked** and what **happened**. The second
is already available through `last`.

Provenance remains valuable for *diagnosis*, and the harness already captures it
in the Set-3 findings. Keep it there.

---

## 5. Does any persisted representation already provide the fields?

**No.** `set_logs` in full:

```
id · exercise_block_id · set_number · weight_kg · reps · rpe · rest_seconds
is_warmup · quality · quality_reason · note · logged_at
+ set_type · parent_set_id · bodyweight_data · edited_at · set_role
+ suggestion_engine_version · location_id · feedback
```

`set_role` and `suggestion_engine_version` record *that* the engine classified
and versioned the set — not what it asked for. `exercise_blocks.target_weight_kg`
and `target_rep_range` are session-level plan values, not per-set asks (the
harness relies on exactly that: the stored target can only ever act as a
cold-start fallback).

**A migration is not needed for the contract**, because the contract is
within-session and about the *immediately* preceding set — in-memory scope.

**One deliberate gap, worth naming rather than discovering later:** resuming a
session (reload, second device, app restart mid-block) loses the captured
prescription. The engine must then treat absence as **"unknown"**, never as
"no miss". If we later decide the app should behave identically across a reload,
that is when a column earns its place — and it would be a separate change.

---

## 6. Blast radius

**Small, and it can be made zero for one landing.**

- The field is optional. No existing caller breaks.
- Absent → identical behaviour to today. So the plumbing can land **inert**,
  with the behaviour change as a separate, independently testable step. That is
  the ordering I would recommend: it keeps "the engine can now see the ask" and
  "the engine now acts on the ask" from failing as one indivisible thing.
- The risk concentrates in **ExerciseCard's capture**. It must record what was
  actually *served* — not what is in the editable inputs — at submit time, per
  block, surviving re-renders and edits. A stale or wrong value there makes the
  engine's new branch fire on a false premise, which is worse than not having it:
  a wrong "you just failed this" is a silent mis-prescription.
- Dropsets, supersets and AMRAP sets all submit through the same handler and
  will need deciding: an AMRAP has no meaningful rep target to miss, so it
  should probably capture nothing rather than capture a nominal one.

### Recommended sequence

1. Land the optional input + the capture, **inert** — engine behaviour byte-identical, verified by the pinned `engineRegressionBaseline` and an unchanged full sweep.
2. Then the clear-miss/load-lever regression (step 6), which is the narrowest genuinely-wrong case.
3. Then position-match (step 7), which is the one this input actually unblocks.
4. The monotonicity-floor audit (step 9) stays independent — it is about the constraint set, not the inputs, and 21 of 21 `load_lever` cases point at it.

---

## What this does not answer

Whether the engine *should* change its decision once it can see the ask. That is
steps 6–9. This audit establishes only that the information can be delivered
honestly — captured, not reconstructed — and at what cost.
