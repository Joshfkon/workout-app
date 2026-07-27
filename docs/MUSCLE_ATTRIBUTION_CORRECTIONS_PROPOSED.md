# Muscle Attribution — Proposed Corrections (Phase 2, AWAITING REVIEW)

Companion to `docs/MUSCLE_ATTRIBUTION_AUDIT.md` (Phase 1). **Nothing in
sections A–D is applied.** Values are data; each block below is the full
proposed diff for one attribution source, derived from the audit failure
list (not one-off patches). Apply only after explicit sign-off, per source.

Convention used throughout: the stock library's 20260702000001 retag
decisions (presses → `front_delts`; lateral raises → `lateral_delts`;
rear-delt work → `rear_delts`; rows keep coarse `back`; flat pressing keeps
coarse `chest`; Arnold keeps a real side-delt secondary).

---

## A. User-DB exercise rows (the observed panel defect) — runtime apply path

The two observed exercises are user-library rows with `primary_muscle =
'shoulders'`. `lib/migrations/coarsePrimaryRetag.ts` already computes these
proposals at runtime (report-only). Proposed: build the **apply step** —
per-exercise, review-listed, reversible (store the previous tags alongside
the update; no silent bulk migration):

| Exercise | Current (per set) | Proposed (per set) |
|---|---|---|
| Arnold Press | shoulders → front ⅓ · side ⅓ · rear ⅓ | `front_delts` + [`lateral_delts`] → front 1.0 · side 0.5 · **rear 0** |
| Lateral Raise (Cable) | shoulders → front ⅓ · side ⅓ · rear ⅓ | `lateral_delts` → **side 1.0**, front 0, rear 0 |

Only `name_pattern`-rule proposals are eligible for apply;
`ai_completion_default` / `needs_review` rows surface for a human decision.

**Effect on the observed week** (recomputed):

| Head | Now | After | Zone |
|---|---|---|---|
| Side delts | 2.2 eff | **4.6 eff** (Arnold 2.0 + Lateral Raise 2.6) | 6–20, still below MEV — honest amber |
| Front delts | 9.2 eff | **11.0 eff** (Arnold 4.0 + presses 7.0) | 2–14 |
| Rear delts | 5.2 eff | **3.0 eff** (Rear Delt Machine only) | 3–20, at MEV — no longer false green |

The panel would now point at side delts (and marginal rear delts) instead
of telling you rear delts are covered by an Arnold press.

## B. `services/exerciseService.ts` fallback entries the seed doesn't cover

These entries keep authored legacy tags because their names are absent from
the SQL corpus. Proposed retags (data-only edit in `FALLBACK_EXERCISES_RAW`):

| Exercise | Current | Proposed |
|---|---|---|
| Arnold Press | shoulders + [triceps] | `front_delts` + [triceps, `lateral_delts`] |
| Standing Overhead Press | shoulders + [triceps] | `front_delts` + [triceps, chest_upper] (matches seed 'Overhead Press') |
| Seated Dumbbell Shoulder Press | shoulders + [triceps] | `front_delts` + [triceps, chest_upper] |
| Machine Shoulder Press | shoulders + [triceps] | `front_delts` + [triceps] |
| Cable Lateral Raise | shoulders | `lateral_delts` |
| Reverse Fly | shoulders + [traps, back] | `rear_delts` + [`upper_back`, traps] (coarse 'back' secondary → the muscle actually hit) |

## C. `lib/training/constants.ts` `EXERCISE_DATABASE` (program-template pool)

Never retagged; every coarse tag below smears. Proposed: align with the
seed tags where the name exists in the corpus, else the same name rules.
Secondary `'shoulders'` on presses/rows becomes the specific head.

| Exercise | Current | Proposed |
|---|---|---|
| Standing Overhead Press | shoulders + [triceps] | `front_delts` + [triceps, chest_upper] |
| Seated Dumbbell Shoulder Press | shoulders + [triceps] | `front_delts` + [triceps, chest_upper] |
| Machine Shoulder Press | shoulders + [triceps] | `front_delts` + [triceps] |
| Arnold Press | shoulders + [triceps] | `front_delts` + [triceps, `lateral_delts`] |
| Lateral Raise | shoulders | `lateral_delts` (seed match) |
| Cable Lateral Raise | shoulders | `lateral_delts` |
| Front Raise | shoulders | `front_delts` (seed match) |
| Face Pull | shoulders + [back] | `rear_delts` + [`upper_back`, `mid_lower_traps`] (seed match) |
| Reverse Fly | shoulders + [back] | `rear_delts` + [`upper_back`] |
| Conventional Deadlift | back + [hamstrings, glutes] | `glutes` + [hamstrings, `erectors`, traps, forearms] (seed 'Deadlift' match) |
| Barbell/DB Bench, Incline presses, Dip, Push-Up | secondary `shoulders` | secondary `front_delts` (drop the side/rear-delt ⅙ leak) |
| Barbell Row | secondary `shoulders` | secondary `rear_delts` (seed row convention) |

Rows / pulldowns / flat pressing keep their coarse primaries
(intentionally-coarse policy — see D).

## D. The tied class (48 entries) — recommendation: NO value change

Flat pressing tagged `chest` and rows tagged `back` split their primary ½/½
across two heads, which *per head* ties the 0.5 secondaries (bench:
chest_upper 0.5 = front_delts 0.5). At the **group** level the primary still
dominates (chest 1.0 vs front_delts 0.5) — the tie is an artifact of
half-splitting a deliberately-coarse tag, not a wrong ranking. Options were:
lower `SECONDARY_MUSCLE_CREDIT`, retag every press/row to a single head, or
accept the per-head tie. Recommendation: **accept**, keep the intentionally-
coarse policy, and treat the audit's `tied` class as informational (the
snapshot pins it so it can't grow). Revisit only if the Phase 5 unit
decision changes what a credited set means.

## E. Attribution-source unification — status

- **Volume counting** (panel, MEV summary, mesocycle allocator, rollover):
  already one source — `resolvePrimaryMuscleCredits` +
  `SECONDARY_MUSCLE_CREDIT` (`services/volumeTracker.ts`).
- **Effort weighting** (RIR-weighted effective volume): already one source —
  `services/effectiveVolume.ts`, used by both panel paths. No change needed.
- **Recovery/readiness dose** (`services/muscleRecovery.ts`): its
  `secondaryDoseFactor` now READS `SECONDARY_MUSCLE_CREDIT` (applied in this
  phase — same value 0.5, zero behavior change, one constant).
- **PROPOSED (behavior change, needs review):** `involvementFactor` in
  muscleRecovery gives a legacy `'shoulders'` primary involvement **1.0 to
  every head** (vs the volume counter's ⅓). Unifying it on
  `resolvePrimaryMuscleCredits` weights would make one Arnold set dose a
  rear delt at 0.33 instead of 1.0 for recovery purposes. Flagging rather
  than applying: it lengthens/shortens readiness windows for coarse-tagged
  exercises and deserves its own sign-off. (Once user/static tags are
  retagged per A–C, the divergence mostly vanishes on its own.)
