# Muscle Attribution — Proposed Corrections (Phases 2 & 4, AWAITING REVIEW)

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

---

## F. Phase 4 — triceps split by head (PROPOSED, not applied; blocked on A–C sign-off)

Two sub-groups (long head; lateral + medial combined), following the
traps/calves precedent exactly: coarse `triceps` remains a valid standard
muscle, the two fine members are fed ONLY by fine-grained tags, and
reachability gating hides the split from users whose library can't feed it
(no permanently-amber bar a user can't clear).

### Taxonomy changes (types/schema.ts + services/volumeBands.ts)

- `STANDARD_MUSCLE_GROUPS` += `triceps_long`, `triceps_lat_med`
- `DETAILED_TO_STANDARD_MAP`: `triceps_long → triceps_long`;
  `triceps_lateral`, `triceps_medial → triceps_lat_med` (today all three
  collapse into coarse `triceps`)
- `COARSE_CHILDREN.triceps = ['triceps', 'triceps_long', 'triceps_lat_med']`;
  both new members join `FINE_CHILD_MUSCLES`
- `FINE_MUSCLE_PARENTS`: `triceps_long`/`triceps_lat_med → ['triceps']`
  (coarse-tag credit stays on coarse `triceps`, never leaks into a head)
- Legacy `'triceps'` keeps resolving to `['triceps']` — NO uniform head
  smear; that mechanism is exactly what Phase 1 flagged for shoulders

### Proposed bands (values as data — review before applying)

| Muscle | MEV | MRV | Rationale |
|---|---|---|---|
| `triceps_long` | 4 | 18 | Near the direct-work literature: pressing gives the long head little, so no total-inclusive discount |
| `triceps_lat_med` | 6 | 20 | Receives the pressing inflow once press secondaries are retagged (below) — MEV stated total-inclusive, like front_delts |

Group band `triceps {8, 24}` unchanged. Enhanced MRV tier inherits ×1.35
from the coarse group.

### Proposed retags (attribution rule: shoulder position at the elbow-extension)

| Shoulder position | Exercises (seed names) | Proposed primary | Proposed secondaries |
|---|---|---|---|
| Overhead / flexed — long head lengthened, credits substantially | Overhead Tricep Extension, Cable Overhead Tricep Extension, Katana Tricep Extension | `triceps_long` | + `triceps_lat_med` |
| ~90° flexed (lying extensions) — long head still meaningfully lengthened | Skull Crusher, Triceps Extension (Dumbbell), Machine Tricep Extension | `triceps_long` | + `triceps_lat_med` — **medium confidence, review** |
| Neutral — long head credit drops sharply (0.5 secondary is the coarsest available step) | Tricep Pushdown, Cable Tricep Pushdown, Rope Tricep Pushdown | `triceps_lat_med` | + `triceps_long` |
| Extended — long head maximally shortened, ~no credit | Dumbbell Kickback | `triceps_lat_med` | (none) |
| Pressing — lateral/medial do the elbow work | Close Grip Bench Press, Dips (Tricep Focus), Assisted Dip Machine | `triceps_lat_med` | keep existing |
| Pressing secondaries | every press/dip with secondary `triceps` (benches, OHP variants, machine presses, push-up, L-Sit) | — | secondary `triceps` → `triceps_lat_med` |

### Effect on the reported week (rope pushdown + triceps press + 4 pressing movements, 11 eff total)

Group stays ~11 vs 8–24 (mid-zone, unchanged). `triceps_long` collects only
the pushdowns' 0.5 secondaries (≈1.5–2 credited) → **below its MEV 4, amber,
pinned open** — the zero-overhead-work gap becomes visible instead of hiding
inside a mid-range group number. `triceps_lat_med` lands comfortably in
zone.

---

## G. Phase 5 — zone units: provenance + recommendation

### Where the numbers come from

- **Group zones are ALREADY stated in the blended (credited) metric.** The
  v2 "convention conversion" (documented at `services/volumeBands.ts:50-77`)
  shifted the direct-set literature bands by measured indirect inflow:
  triceps {6,18}→**{8,24}**, shoulders {8,22}→**{12,26}**, biceps
  {6,20}→{10,26}, etc. So the panel is NOT comparing a blended number
  against direct-set literature zones — the zones were converted for exactly
  this comparison. What's missing is any UI statement of that unit.
- **Sub-group zones** (`getEffectiveBand` for a standard muscle: MEV from
  `MEV_TARGETS`, MRV from `FINE_BAND_TOTAL_INCLUSIVE_MRV` else the
  intermediate `DEFAULT_VOLUME_LANDMARKS` table):
  - front delts **2–14**: both ends deliberately total-inclusive (MEV 2 is
    below direct literature because pressing supplies 4–6 indirect sets;
    MRV 14 is an explicit total-inclusive override).
  - rear delts **3–20**: same construction (MEV 3; MRV 20 override).
  - side delts **6–20**: MEV 6 total-inclusive, but MRV 20 comes from the
    UN-converted intermediate landmarks table — converted by omission, not
    decision. Defensible (side delts receive almost no secondary inflow, so
    direct ≈ credited), but it should be recorded as such.
- **RIR weighting never moves a zone.** `volumeZone` judges the credited RAW
  set count (`row.sets`); the eff number is informational display only. So
  the comparison is credited-sets vs credited-zones — units already agree.

### Recommendation (pick one): STATE THE UNIT EXPLICITLY

Rescaling zones again would double-count the v2 conversion, and comparing
direct-only against the literature zone would throw away the reason
secondary credit exists. The remaining defect is labeling, so:

1. Zone labels / the panel footnote state the unit once: "zones are stated
   in credited sets (direct + ½-credit secondary work)".
2. Keep the existing "(2.2 direct)" annotation as the direct-sets view — it
   already gives the literature-comparable number alongside.
3. Record side delts' MRV 20 as "direct ≈ credited, adopted as-is" in
   volumeBands (or nudge it in review if you disagree with that equivalence).
4. No zone value changes.
