# Phase 1 — Investigation findings

Suggestion-engine anchor bug. No code changed for this phase; this documents the
exact suggestion path and confirms/corrects the hypothesis before implementation.

## The failure case, traced end to end

Exercise: **ISO-Lateral Low Row**. Previous session (Jun 26), working sets in
`set_number` order:

| slot | weight | reps | RIR |
|------|--------|------|-----|
| 0    | 90     | 13   | 4   |  ← feeder / ramp
| 1    | 140    | 14   | 2.5 |
| 2    | 160    | 8    | 2.5 |
| 3    | 160    | 11   | 1   |

Stored `estimated_e1rm`: **252.5**. Target: **8–12 reps @ 2 RIR**.

The banner for **set 1 of the new session** rendered:
`92.5 × 13 @ 2 RIR — up 2.5 lbs vs last session — it was clearly too light`.

### Call chain

1. `SuggestionBanner` (`components/workout/SuggestionBanner.tsx:37-42`) renders the
   literal string `{weightLabel} × {repsLabel} @ {rir} RIR — {reason}`. It is
   purely presentational; every number comes from its props.
2. Props are built by `buildSuggestionInfo(...)` in
   `components/workout/ExerciseCard.tsx:1079-1176`, rendered at `:1997-2003`.
3. For the **first set of a session** there is no `lastCompleted`, so the code takes
   the `else` branch at `ExerciseCard.tsx:1118-1157`:
   - `prevSet = previousSets[completedSets.length]` → **`previousSets[0]`** →
     the previous session's **slot-0 set = 90 × 13 @ 4 RIR** (the feeder set).
   - `rec = seedFromPreviousSet(prevSet, targetRepRange)` →
     `recommendSessionStart(...)` (`ExerciseCard.tsx:546-557`).
4. `recommendSessionStart` (`services/setRecommender.ts:210-227`) delegates to
   `recommendSet` with `lastWeightKg=90, lastReps=13, lastRir=4,
   targetRepRange=[8,12], targetRir=2`. **It does not pass `sessionBestE1RMKg`** —
   `SessionStartInput` has no such field.
5. Inside `recommendSet` (`setRecommender.ts:143-171`):
   - Capacity anchor `e1rm = max(0, epleyE1RM(90,13,4)) = 90·(1+17/30) ≈ 141`.
     **Derived solely from the feeder set** — the stored e1RM of 252.5 never
     enters this computation.
   - `dev = lastRir − targetRir = 4 − 2 = 2`, which is `>= DEADBAND_RIR (2)`, and
     `lastReps (13) >= repMax (12)` → **`increase_load`** branch.
   - `ideal = weightForReps(141, 12, 2) ≈ 96`; suggested weight =
     `round(min(96, 90·1.10), inc)` ≈ the low-90s (the exact `92.5` is the display
     unit + `+ inc` floor at `setRecommender.ts:160` when rounding didn't clear the
     anchor).
6. Reps: rationale is `increase_load` (not `maintain`), so `recommendSessionStart`'s
   "repeat last reps" override at `setRecommender.ts:220-225` **does not fire**.
   Reps come from `predictRepsAtWeight(141, ~92.5, 2, 0, 12)` ≈ `13`
   (`setRecommender.ts:109-119, 180-184`).
7. RIR is always the static `targetRir` (`setRecommender.ts:186`), surfaced as
   `effectiveTargetRir` (`ExerciseCard.tsx:279-283`).

## Hypothesis check

> weight = lastSameSlotWeight + minIncrement, reps = copied, RIR = static default

- **Weight — PARTIALLY correct.** It is not simply `last + increment`. It is
  `round(min(idealFromAnchorE1RM, last·1.10), inc)`, where the anchor E1RM is
  recomputed from the single feeder set. `last + inc` is only the floor fallback
  (`setRecommender.ts:159-160`) and happens to fire here. The real defect is the
  **anchor**: capacity is taken from slot-0's 90×13, not from the exercise's true
  e1RM.
- **Reps — CORRECTED.** Not literally copied. `13` is `predictRepsAtWeight`'s output
  from the mis-anchored e1RM. It only *looks* copied because the model predicts ~13
  reps at the bumped weight. Functionally the task's complaint holds: it is a
  model-emitted rep count sitting next to a static RIR target, reading as one
  prescription — and it exceeds `repMax=12`, contradicting the "raise the load to
  bring effort back into the 8–12 range" action it is paired with.
- **RIR — correct.** Always the static prescribed target; never derived from the
  set actually performed.

## The three defects (mapping to the task)

1. **Category error — working-set progression applied to a feeder/ramp set.**
   Slot-0 (90 lbs vs 160-lb top sets) is a ramp set. `recommendSessionStart` grades
   it against "cleared 8–12 @ 2 RIR with reserve → too light → add load," which is
   only meaningful for a working set. This is the root cause.
2. **Stored e1RM (252.5) is displayed but unused.** The provenance line
   `Best estimated 1RM on record: …` (`ExerciseCard.tsx:1152-1156`) shows 252.5, but
   the session-start weight math re-derives capacity from the feeder set (~141).
   Anchoring on 252.5 gives `weightForReps(252.5, 12, 2) = 252.5/(1+14/30) ≈ 172`
   and `weightForReps(252.5, 8, 2) ≈ 202` → a **~170–200** working range, matching
   the user's actual 180×9 @1 RIR. Confirmed the e1RM was valid and ignored.
3. **"× 13" reads as a prescription.** It is next to `@ 2 RIR` in a single
   `font-medium` span; a user reads "13 reps @ 2 RIR." It is a predicted rep count at
   an above-range load, not a prescribed rep range, and it is internally incoherent
   with the increase action.

### Why `sessionBestE1RMKg` doesn't save it

`recommendSet` *does* accept and prefer `sessionBestE1RMKg` (`setRecommender.ts:145`),
but only the **within-session** path (`recommendNext`, `ExerciseCard.tsx:418-428`)
passes it, computed from sets completed **this** session (`ExerciseCard.tsx:406-416`).
The **cross-session** entry point (`recommendSessionStart`) has no e1RM input at all,
so set 1 — which has no completed sets yet this session — is always anchored to a
single previous-session set, which for slot 0 is the feeder.

## e1RM recalibration: fresh set-1 vs fatigued grinder?

**Everything is flat with respect to intra-session fatigue position — no set-role or
set-order weighting anywhere in the e1RM path.**

- Stored snapshot: `sessionWrites.ts:74-101` writes `estimated_e1rm` = **max**
  E1RM across working sets (top-set), and calls `estimateE1RM(weight, reps)` **without
  RPE** → assumes every top set was to failure.
- Live suggestion history: `suggestions.ts:computeHistoryFromBlocks` (76-128) keeps
  `if (e1rm > bestE1RM)` across all non-warmup sets — **max**, position-agnostic —
  but here it **does** pass RPE.
- Engine recalibration: `weightEstimationEngine.updateFromWorkout` (1307-1364) →
  `findBestSet` (690-705) keeps the highest single-set estimate; `selectBestEstimate`
  (665-688) pools all sets, takes top-3 by value, and applies recency weighting by
  **session date only** — two sets from the same session get identical weight
  regardless of being set 1 vs set 4.

So a fresh near-failure set-1 and a fatigued 4th-set grinder are pooled; the higher
estimate simply wins. The **only** implicit fatigue signal is RPE→RIR (a set left
further from failure yields a higher e1RM), and it is applied **inconsistently**: the
live suggestion path passes RPE, but the persisted snapshot / lift-trend path
(`sessionWrites.ts`, `services/liftTrends.ts`) do not. This is the recalibration hook
Phase 4 must use: a fresh, heavy, near-failure set is high-quality e1RM evidence and
should be weighted with less intra-session fatigue discount than a late set.

## Reference map

| Concern | Location |
|---|---|
| Banner display string | `components/workout/SuggestionBanner.tsx:37-42` |
| Provenance bottom sheet | `components/workout/SuggestionBanner.tsx:43-64` |
| Banner props / render | `components/workout/ExerciseCard.tsx:1997-2003` |
| Reason + explanation + weight/reps builder | `components/workout/ExerciseCard.tsx:1079-1176` |
| "too light" / "vs last session" copy | `ExerciseCard.tsx:1108-1114, 1131-1143` |
| e1RM shown in provenance | `ExerciseCard.tsx:1115-1117, 1152-1156` |
| Session-start engine call | `ExerciseCard.tsx:546-557` |
| Within-session engine call (has e1RM) | `ExerciseCard.tsx:418-428` |
| `sessionBestE1RM` (session only) | `ExerciseCard.tsx:406-416` |
| Core math + constants | `services/setRecommender.ts:29-227` |
| e1RM stored (max, no RPE) | `app/(dashboard)/dashboard/workout/[id]/_lib/sessionWrites.ts:74-101` |
| e1RM live history (max, w/ RPE) | `app/(dashboard)/dashboard/workout/[id]/_lib/suggestions.ts:76-128` |
| e1RM recalibration | `services/weightEstimationEngine.ts:665-705, 1307-1364` |
| `set_type` enum (persistence precedent) | `supabase/migrations/20241218000002_supersets_dropsets.sql` |
| Design doc | `docs/next-set-recommender-design.md` |

## Implementation implications (feeds Phases 2–5)

- Introduce a **set role** (`working | ramp`); infer `ramp` when a set's load is
  `< RAMP_ROLE_MAX_FRACTION` (0.75) of the session top-set load; allow a user tag that
  beats inference; persist per exercise-slot; version records; backfill history.
- `recommendSessionStart` must take the exercise's **e1RM anchor** and, for a
  **working** slot, prescribe `weightForReps(e1rm, …)` clamped to **±10%**
  (`WORKING_WEIGHT_CLAMP_FRACTION`) of the best recent working weight, and show a rep
  **range**, not a predicted count.
- **Ramp** slots get `RAMP_LOAD_FRACTION` (~0.55–0.60) of today's top working set, no
  RIR claim, no "too light" copy, excluded from junk-volume detection.
- Logged sets deviating `> OVERRIDE_DEVIATION_FRACTION` (0.20) from the suggestion
  re-anchor the rest of the session and next session, and feed recalibration with
  fresh-set weighting.
- All thresholds live in one constants module; every suggestion record carries an
  engine version.
</content>
</invoke>
