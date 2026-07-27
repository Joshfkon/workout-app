# Muscle Attribution Audit — Phase 1 (2026-07-27)

Audit of the per-exercise → per-muscle volume attribution, triggered by the
Progress > volume panel showing inverted per-head credit for Shoulders
(Arnold Press appearing to credit rear delts 4.0 vs front delts 1.3; Lateral
Raise (Cable) appearing to credit rear delts 2.6 vs side delts 0.9).

**REPORT ONLY. No coefficient was changed in this phase.** Corrections are
Phase 2, gated on explicit review (same protocol as progression_model /
rom_demands).

Reproducible: `AUDIT_VERBOSE=1 npx jest muscleAttributionAudit` — the audit
module is `services/muscleAttributionAudit.ts`; the pinned failure lists live
in `services/__tests__/__snapshots__/muscleAttributionAudit.test.ts.snap`
(a NEW failure anywhere fails CI; the lists may only shrink via review).

---

## 1. Where the attribution table lives

There is no single stored coefficient table. Per-muscle credit is **derived
at count time** from each exercise's `primary_muscle` / `secondary_muscles[]`
tags through two constants:

| Piece | Location |
|---|---|
| Secondary credit (0.5/set) | `services/volumeTracker.ts:35` (`SECONDARY_MUSCLE_CREDIT`) |
| Legacy-primary head split | `services/volumeTracker.ts:53-61` (`LEGACY_PRIMARY_VOLUME_WEIGHTS`) |
| Derivation (primary split + 0.5 secondary) | `services/volumeTracker.ts:76-93` (`resolvePrimaryMuscleCredits`) + `app/(dashboard)/dashboard/_lib/weeklyVolume.ts:305-385` (`accumulateExerciseVolume`) |
| Token → standard muscle resolution | `types/schema.ts:2022-2040` (`resolveMuscleToStandard`) |

Exercise tags themselves live in FOUR places:

1. **Live DB `exercises` rows** — the only source the volume panel actually
   reads. Stock rows were retagged fine-grained by
   `supabase/migrations/20260702000001_fix_exercise_muscle_mappings.sql`;
   snapshot = `services/generated/seedExerciseTags.ts` (148 exercises,
   audited below as `seed-db`).
2. **`services/exerciseService.ts` `FALLBACK_EXERCISES`** (offline/static
   fallback; seed tags overlaid by name — entries the seed doesn't know keep
   authored legacy tags). Audited as `service-fallback` (~119 entries).
3. **`lib/training/constants.ts:471` `EXERCISE_DATABASE`** (program
   generator candidate pool) — **never retagged**, still coarse
   'chest'/'back'/'shoulders' throughout. Audited as `program-template`
   (67 entries).
4. **User-created custom exercises** (DB only, per user) — the old picker
   stored coarse primaries. Not auditable statically; covered at runtime by
   the dry-run report in `lib/migrations/coarsePrimaryRetag.ts`
   (report-only; an apply path does not exist yet).

The observed Arnold Press and Lateral Raise (Cable) are user-library rows
carrying `primary_muscle = 'shoulders'` — both names are absent from the
retagged stock corpus ("Lateral Raise (Cable)" is not a stock name; stock
Arnold Press never received a retag), so the 20260702000001 migration never
touched them.

## 2. Mechanism: uniform vs weighted head split — **UNIFORM, CONFIRMED**

`LEGACY_PRIMARY_VOLUME_WEIGHTS` splits a coarse legacy primary **uniformly**
across the group's heads, identically for every exercise:

```
shoulders → front ⅓ · side ⅓ · rear ⅓
chest     → upper ½ · lower ½
back      → lats ½ · upper_back ½
```

The exercise's identity plays no role — a lateral raise tagged 'shoulders'
credits the rear delts exactly as much as the side delts. This is the
confirmed mechanism behind both observed defects:

- **Arnold Press** (4 sets, 'shoulders'): ⅓ each → 1.33/head. Rear-delt
  credit should be ~0; it gets a full third.
- **Lateral Raise (Cable)** (3 sets, 'shoulders'): ⅓ each → side delts get
  **1 set** of credit from THE side-delt exercise; rear and front each get
  the same 1 set.

Compounding it: the uniform ⅓ (0.33) is **less than** the 0.5 secondary
credit, so any secondary tag on a 'shoulders' exercise out-credits every
head the exercise nominally targets (see the inverted list below).

Reconstruction check against the observed panel (7-day window):

```
                      front   side    rear
Arnold Press (4)       1.33    1.33    1.33   ('shoulders' ⅓ split)
Lateral Raise (3)      0.87    0.87    0.87   ('shoulders' ⅓ split, RIR-weighted 2.6)
Rear Delt Machine (3)     –       –    3.0    (fine-tagged, correct)
benches+fly+machine    7.0        –      –    (0.5 secondary front_delts)
                      ─────   ─────   ─────
                       9.2     2.2     5.2    = the displayed headers, exactly
```

The header numbers are internally consistent with the uniform-split model —
the coefficients are wrong, not the arithmetic.

## 3. The 15.6-vs-5.2 discrepancy: neither pre- nor post-normalization — a UI adjacency defect

Per-head panels show **post-split** values and reconcile exactly (front:
list Σ = 9.2 = header; side: 2.2 = header). The seven-row list that "sums to
~15.6" under Rear Delts is **not the rear-delt panel at all** — it is the
**group-level** contributing-sets panel for Shoulders (Σ = 16.6 = the group
header), which `MuscleGroupList` renders inside the same indented block
**directly beneath the last child row** (`components/muscle/MuscleGroupList.tsx:257-265`,
`renderRowDetail` after `visibleChildren`), with no label saying which scope
it belongs to. Children sort below-MEV-first, so Rear Delts happens to be
last and visually adopts the group panel. That's why "rear delts" shows
Arnold 4.0 (= 1.33 × 3 heads, the group-merged value) and secondary-only
chest work that credits **only front delts**.

Fix (Phase 3, with the performed→credited rendering): label each
contributing-sets panel with its muscle scope so a group panel cannot be
read as the last child's.

## 4. Invariant failures — primary target NOT the largest coefficient

334 entries audited; **58 failures** (10 inverted across 6 distinct
exercises, 48 tied), plus **65 uniform-split primaries** (the full mechanism
class). Every failure is a legacy-coarse-primary artifact; the retagged
seed corpus's only outright inversion is Overhead Carry.

### Inverted (a non-target out-credits the primary target)

```
Arnold Press          [service-fallback + program-template]  heads 0.33 vs triceps 0.5
Machine Shoulder Press [service-fallback + program-template] heads 0.33 vs triceps 0.5
Seated DB Shoulder Press [service-fallback + program-template] heads 0.33 vs triceps 0.5
Standing Overhead Press [service-fallback + program-template] heads 0.33 vs triceps 0.5
Reverse Fly           [service-fallback]                     heads 0.33 vs traps 0.5
Overhead Carry        [seed-db]                              heads 0.33 vs traps/abs/forearms 0.5
```

(The user-DB Arnold Press / Lateral Raise (Cable) rows are the same class:
runtime instances of the 'shoulders' uniform split.)

### Tied (coarse ½ primary equals a 0.5 secondary)

All flat pressing/fly tagged 'chest' (chest heads 0.5 vs front_delts and/or
triceps 0.5) and all rows/pulls tagged 'back' (lats/upper_back 0.5 vs biceps
0.5) — 48 entries; full list in §6. These reflect the deliberate
"intentionally coarse" stock policy, but under the current constants the
*byproduct* muscle legally ties the *target*: a bench press credits front
delts and triceps exactly as much as either chest head. Also notable:
program-template Conventional Deadlift is tagged **'back'** (lats/upper_back
0.5) with hamstrings/glutes 0.5 secondaries — the seed retag moved deadlifts
to glutes-primary, this pool was never updated.

### Dropped tokens

None — every tag in all three static sources resolves.

## 5. Adjacent divergences found (Phase 2 scope)

- **`services/muscleRecovery.ts` (readiness/recovery dose)** resolves a
  legacy 'shoulders' primary to involvement **1.0 for every head**
  (`involvementFactor`, line 336-352) — not ⅓ — and uses its own
  `secondaryDoseFactor: 0.5` constant rather than `SECONDARY_MUSCLE_CREDIT`.
  Volume and recovery disagree on what one Arnold Press set does to a rear
  delt (0.33 vs 1.0 credited sets).
- **`lib/training/constants.ts` EXERCISE_DATABASE** — fully legacy-tagged
  candidate pool feeding the program engine (`programEngine.ts:1300,1314`
  filters on these tags).
- **Latent double-count** in
  `app/(dashboard)/dashboard/_lib/weeklyVolume.ts:852-874`
  (`setsByStandardMuscle`): a legacy-KEYED stat's per-exercise list is merged
  into each covered standard muscle **unscaled** (the numeric share is
  scaled by `1/standards.length`, the exercise rows are not). Currently
  unreachable (the accumulator only emits standard keys), but it is the
  exact bug shape the panel symptom suggested — worth closing while in here.
- `lib/migrations/coarsePrimaryRetag.ts` `perSetCredit` now delegates to the
  shared `perSetStandardCredit` (this phase's only code change: one credit
  formula everywhere; behavior identical, tests green).

## 6. Full table

Format: `name [source] primary + [secondaries] → per-set standard-muscle credit`.
`⚠ INVERTED/TIED` = invariant failure; `uniform-split` = coarse primary smeared
uniformly across heads.

```
Ab Wheel Rollout [program-template] abs → abs 1
Arnold Press [program-template] shoulders + [triceps] → triceps 0.5, front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ INVERTED uniform-split
Barbell Back Squat [program-template] quads + [glutes, hamstrings] → quads 1, glutes 0.5, hamstrings 0.5
Barbell Bench Press [program-template] chest + [triceps, shoulders] → chest_lower 0.5, chest_upper 0.5, triceps 0.5, front_delts 0.17, lateral_delts 0.17, rear_delts 0.17  ⚠ TIED uniform-split
Barbell Curl [program-template] biceps → biceps 1
Barbell Row [program-template] back + [biceps, shoulders] → biceps 0.5, lats 0.5, upper_back 0.5, front_delts 0.17, lateral_delts 0.17, rear_delts 0.17  ⚠ TIED uniform-split
Bulgarian Split Squat [program-template] quads + [glutes] → quads 1, glutes 0.5
Cable Crunch [program-template] abs → abs 1
Cable Curl [program-template] biceps → biceps 1
Cable Fly [program-template] chest → chest_lower 0.5, chest_upper 0.5  ⚠ uniform-split
Cable Lateral Raise [program-template] shoulders → front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ uniform-split
Cable Pull-Through [program-template] glutes + [hamstrings] → glutes 1, hamstrings 0.5
Cable Row [program-template] back + [biceps] → biceps 0.5, lats 0.5, upper_back 0.5  ⚠ TIED uniform-split
Chin-Up [program-template] back + [biceps] → biceps 0.5, lats 0.5, upper_back 0.5  ⚠ TIED uniform-split
Close-Grip Bench Press [program-template] triceps + [chest] → triceps 1, chest_lower 0.25, chest_upper 0.25
Conventional Deadlift [program-template] back + [hamstrings, glutes] → glutes 0.5, hamstrings 0.5, lats 0.5, upper_back 0.5  ⚠ TIED uniform-split
Dip [program-template] chest + [triceps, shoulders] → chest_lower 0.5, chest_upper 0.5, triceps 0.5, front_delts 0.17, lateral_delts 0.17, rear_delts 0.17  ⚠ TIED uniform-split
Dumbbell Bench Press [program-template] chest + [triceps, shoulders] → chest_lower 0.5, chest_upper 0.5, triceps 0.5, front_delts 0.17, lateral_delts 0.17, rear_delts 0.17  ⚠ TIED uniform-split
Dumbbell Curl [program-template] biceps → biceps 1
Dumbbell RDL [program-template] hamstrings + [glutes] → hamstrings 1, glutes 0.5
Dumbbell Row [program-template] back + [biceps] → biceps 0.5, lats 0.5, upper_back 0.5  ⚠ TIED uniform-split
Dumbbell Tricep Kickback [program-template] triceps → triceps 1
Face Pull [program-template] shoulders + [back] → front_delts 0.33, lateral_delts 0.33, rear_delts 0.33, lats 0.25, upper_back 0.25  ⚠ uniform-split
Front Raise [program-template] shoulders → front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ uniform-split
Front Squat [program-template] quads + [glutes] → quads 1, glutes 0.5
Glute Bridge [program-template] glutes + [hamstrings] → glutes 1, hamstrings 0.5
Goblet Squat [program-template] quads + [glutes] → quads 1, glutes 0.5
Good Morning [program-template] hamstrings + [back, glutes] → hamstrings 1, glutes 0.5, lats 0.25, upper_back 0.25
Hack Squat [program-template] quads + [glutes] → quads 1, glutes 0.5
Hammer Curl [program-template] biceps → biceps 1
Hanging Leg Raise [program-template] abs → abs 1
Hip Thrust [program-template] glutes + [hamstrings] → glutes 1, hamstrings 0.5
Incline Barbell Press [program-template] chest + [triceps, shoulders] → chest_lower 0.5, chest_upper 0.5, triceps 0.5, front_delts 0.17, lateral_delts 0.17, rear_delts 0.17  ⚠ TIED uniform-split
Incline Dumbbell Curl [program-template] biceps → biceps 1
Incline Dumbbell Press [program-template] chest + [triceps, shoulders] → chest_lower 0.5, chest_upper 0.5, triceps 0.5, front_delts 0.17, lateral_delts 0.17, rear_delts 0.17  ⚠ TIED uniform-split
Kettlebell Swing [program-template] glutes + [hamstrings, back] → glutes 1, hamstrings 0.5, lats 0.25, upper_back 0.25
Lat Pulldown [program-template] back + [biceps] → biceps 0.5, lats 0.5, upper_back 0.5  ⚠ TIED uniform-split
Lateral Raise [program-template] shoulders → front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ uniform-split
Leg Extension [program-template] quads → quads 1
Leg Press [program-template] quads + [glutes] → quads 1, glutes 0.5
Leg Press Calf Raise [program-template] calves → calves 1
Lying Leg Curl [program-template] hamstrings → hamstrings 1
Machine Chest Press [program-template] chest + [triceps] → chest_lower 0.5, chest_upper 0.5, triceps 0.5  ⚠ TIED uniform-split
Machine Shoulder Press [program-template] shoulders + [triceps] → triceps 0.5, front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ INVERTED uniform-split
Overhead Tricep Extension [program-template] triceps → triceps 1
Plank [program-template] abs → abs 1
Preacher Curl [program-template] biceps → biceps 1
Pull-Up [program-template] back + [biceps] → biceps 0.5, lats 0.5, upper_back 0.5  ⚠ TIED uniform-split
Push-Up [program-template] chest + [triceps, shoulders] → chest_lower 0.5, chest_upper 0.5, triceps 0.5, front_delts 0.17, lateral_delts 0.17, rear_delts 0.17  ⚠ TIED uniform-split
Reverse Fly [program-template] shoulders + [back] → front_delts 0.33, lateral_delts 0.33, rear_delts 0.33, lats 0.25, upper_back 0.25  ⚠ uniform-split
Romanian Deadlift [program-template] hamstrings + [glutes, back] → hamstrings 1, glutes 0.5, lats 0.25, upper_back 0.25
Seated Calf Raise [program-template] calves → calves 1
Seated Dumbbell Shoulder Press [program-template] shoulders + [triceps] → triceps 0.5, front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ INVERTED uniform-split
Seated Leg Curl [program-template] hamstrings → hamstrings 1
Skull Crusher [program-template] triceps → triceps 1
Standing Calf Raise [program-template] calves → calves 1
Standing Overhead Press [program-template] shoulders + [triceps] → triceps 0.5, front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ INVERTED uniform-split
T-Bar Row [program-template] back + [biceps] → biceps 0.5, lats 0.5, upper_back 0.5  ⚠ TIED uniform-split
Tricep Pushdown [program-template] triceps → triceps 1
Walking Lunge [program-template] quads + [glutes] → quads 1, glutes 0.5
45° Preacher Curl [seed-db] biceps → biceps 1
Ab Wheel Rollout [seed-db] abs → abs 1
Adductor Side Lunge [seed-db] adductors + [glutes, quads] → adductors 1, glutes 0.5, quads 0.5
Assisted Dip Machine [seed-db] triceps + [chest_lower, front_delts] → triceps 1, chest_lower 0.5, front_delts 0.5
Assisted Pull-Up [seed-db] lats + [biceps, upper_back, rear_delts] → lats 1, biceps 0.5, rear_delts 0.5, upper_back 0.5
Assisted Pull-Up Machine [seed-db] lats + [biceps, upper_back, rear_delts] → lats 1, biceps 0.5, rear_delts 0.5, upper_back 0.5
Back Extension [seed-db] glutes + [hamstrings, erectors] → glutes 1, erectors 0.5, hamstrings 0.5
Band Pull-Apart [seed-db] upper_back + [rear_delts] → upper_back 1, rear_delts 0.5
Banded Lateral Walk [seed-db] glute_med + [glutes] → glute_med 1, glutes 0.5
Barbell Back Squat [seed-db] quads + [glutes, adductors, erectors] → quads 1, adductors 0.5, erectors 0.5, glutes 0.5
Barbell Bench Press [seed-db] chest + [front_delts, triceps] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5, triceps 0.5  ⚠ TIED uniform-split
Barbell Curl [seed-db] biceps → biceps 1
Barbell Reverse Wrist Curl [seed-db] forearms → forearms 1
Barbell Row [seed-db] back + [biceps, rear_delts, forearms] → biceps 0.5, forearms 0.5, lats 0.5, rear_delts 0.5, upper_back 0.5  ⚠ TIED uniform-split
Barbell Shrug [seed-db] upper_traps → upper_traps 1
Barbell Wrist Curl [seed-db] forearms → forearms 1
Bayesian Cable Curl [seed-db] biceps → biceps 1
Behind-the-Back Cable Lateral Raise [seed-db] lateral_delts → lateral_delts 1
Behind-the-Back Wrist Curl [seed-db] forearms → forearms 1
Bulgarian Split Squat [seed-db] quads + [glutes, glute_med, adductors] → quads 1, adductors 0.5, glute_med 0.5, glutes 0.5
Cable Bicep Curl [seed-db] biceps → biceps 1
Cable Cross Body Lateral Raise [seed-db] lateral_delts → lateral_delts 1
Cable Crunch [seed-db] abs → abs 1
Cable Curl [seed-db] biceps → biceps 1
Cable Fly [seed-db] chest + [front_delts] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5  ⚠ TIED uniform-split
Cable Hip Abduction [seed-db] glute_med + [glutes] → glute_med 1, glutes 0.5
Cable Hip Adduction [seed-db] adductors → adductors 1
Cable Overhead Tricep Extension [seed-db] triceps → triceps 1
Cable Pull Through [seed-db] glutes + [hamstrings, erectors] → glutes 1, erectors 0.5, hamstrings 0.5
Cable Row [seed-db] back + [biceps, rear_delts, forearms] → biceps 0.5, forearms 0.5, lats 0.5, rear_delts 0.5, upper_back 0.5  ⚠ TIED uniform-split
Cable Tricep Pushdown [seed-db] triceps → triceps 1
Cable Upright Row [seed-db] lateral_delts + [upper_traps, biceps] → lateral_delts 1, biceps 0.5, upper_traps 0.5
Cable Woodchop [seed-db] obliques + [abs] → obliques 1, abs 0.5
Cable Y-Raise [seed-db] lateral_delts + [mid_lower_traps] → lateral_delts 1, mid_lower_traps 0.5
Calf Press Machine [seed-db] gastrocnemius + [soleus] → gastrocnemius 1, soleus 0.5
Captain's Chair Leg Raise [seed-db] abs + [obliques] → abs 1, obliques 0.5
Chest Supported Row [seed-db] back + [biceps, rear_delts, forearms] → biceps 0.5, forearms 0.5, lats 0.5, rear_delts 0.5, upper_back 0.5  ⚠ TIED uniform-split
Clamshell [seed-db] glute_med → glute_med 1
Close Grip Bench Press [seed-db] triceps + [chest, front_delts] → triceps 1, front_delts 0.5, chest_lower 0.25, chest_upper 0.25
Close Grip Lat Pulldown [seed-db] lats + [biceps, upper_back, rear_delts] → lats 1, biceps 0.5, rear_delts 0.5, upper_back 0.5
Concentration Curl [seed-db] biceps → biceps 1
Copenhagen Plank [seed-db] adductors + [obliques, abs] → adductors 1, abs 0.5, obliques 0.5
Cossack Squat [seed-db] adductors + [quads, glutes] → adductors 1, glutes 0.5, quads 0.5
Dead Bug [seed-db] abs → abs 1
Dead Hang [seed-db] forearms + [lats] → forearms 1, lats 0.5
Deadlift [seed-db] glutes + [hamstrings, erectors, traps, forearms, quads] → glutes 1, erectors 0.5, forearms 0.5, hamstrings 0.5, quads 0.5, traps 0.5
Decline Barbell Press [seed-db] chest_lower + [chest_upper, front_delts, triceps] → chest_lower 1, chest_upper 0.5, front_delts 0.5, triceps 0.5
Decline Crunch [seed-db] abs → abs 1
Dips (Chest Focus) [seed-db] chest_lower + [chest_upper, front_delts, triceps] → chest_lower 1, chest_upper 0.5, front_delts 0.5, triceps 0.5
Dips (Tricep Focus) [seed-db] triceps + [chest_lower, front_delts] → triceps 1, chest_lower 0.5, front_delts 0.5
Donkey Calf Raise [seed-db] gastrocnemius + [soleus] → gastrocnemius 1, soleus 0.5
Dumbbell Bench Press [seed-db] chest + [front_delts, triceps] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5, triceps 0.5  ⚠ TIED uniform-split
Dumbbell Curl [seed-db] biceps → biceps 1
Dumbbell Fly [seed-db] chest + [front_delts] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5  ⚠ TIED uniform-split
Dumbbell Kickback [seed-db] triceps → triceps 1
Dumbbell Row [seed-db] back + [biceps, rear_delts, forearms] → biceps 0.5, forearms 0.5, lats 0.5, rear_delts 0.5, upper_back 0.5  ⚠ TIED uniform-split
Dumbbell Shoulder Press [seed-db] front_delts + [triceps, chest_upper] → front_delts 1, chest_upper 0.5, triceps 0.5
Dumbbell Shrug [seed-db] upper_traps → upper_traps 1
Dumbbell Side Bend [seed-db] obliques → obliques 1
Dumbbell Wrist Curl [seed-db] forearms → forearms 1
EZ Bar Curl [seed-db] biceps → biceps 1
EZ Bar Reverse Curl [seed-db] forearms + [biceps] → forearms 1, biceps 0.5
Face Pull [seed-db] rear_delts + [upper_back, mid_lower_traps] → rear_delts 1, mid_lower_traps 0.5, upper_back 0.5
Farmer's Carry [seed-db] forearms + [traps, abs, glutes] → forearms 1, abs 0.5, glutes 0.5, traps 0.5
Front Raise [seed-db] front_delts → front_delts 1
Glute Bridge [seed-db] glutes + [hamstrings] → glutes 1, hamstrings 0.5
Glute Bridge Hold [seed-db] glutes + [hamstrings] → glutes 1, hamstrings 0.5
Glute Drive Machine [seed-db] glutes + [hamstrings] → glutes 1, hamstrings 0.5
Good Morning [seed-db] hamstrings + [glutes, erectors] → hamstrings 1, erectors 0.5, glutes 0.5
Hack Squat [seed-db] quads + [glutes, adductors] → quads 1, adductors 0.5, glutes 0.5
Hammer Curl [seed-db] biceps + [forearms] → biceps 1, forearms 0.5
Hammer Strength Ab Crunch [seed-db] abs → abs 1
Hanging Leg Raise [seed-db] abs + [obliques] → abs 1, obliques 0.5
Hip Abduction Machine [seed-db] glute_med + [glutes] → glute_med 1, glutes 0.5
Hip Adduction Machine [seed-db] adductors → adductors 1
Hip Thrust [seed-db] glutes + [hamstrings] → glutes 1, hamstrings 0.5
Hollow Body Hold [seed-db] abs → abs 1
Incline Dumbbell Curl [seed-db] biceps → biceps 1
Incline Dumbbell Press [seed-db] chest_upper + [chest_lower, front_delts, triceps] → chest_upper 1, chest_lower 0.5, front_delts 0.5, triceps 0.5
Incline Leg Press [seed-db] quads + [glutes, adductors] → quads 1, adductors 0.5, glutes 0.5
Jefferson Curl [seed-db] erectors + [hamstrings] → erectors 1, hamstrings 0.5
Katana Tricep Extension [seed-db] triceps → triceps 1
L-Sit [seed-db] abs + [triceps] → abs 1, triceps 0.5
Lat Pulldown [seed-db] lats + [biceps, upper_back, rear_delts] → lats 1, biceps 0.5, rear_delts 0.5, upper_back 0.5
Lateral Raise [seed-db] lateral_delts → lateral_delts 1
Leg Extension [seed-db] quads → quads 1
Leg Press [seed-db] quads + [glutes, adductors] → quads 1, adductors 0.5, glutes 0.5
Leg Press Calf Raise [seed-db] gastrocnemius + [soleus] → gastrocnemius 1, soleus 0.5
Lying Leg Curl [seed-db] hamstrings → hamstrings 1
Machine Ab Crunch [seed-db] abs → abs 1
Machine Back Extension [seed-db] erectors + [glutes] → erectors 1, glutes 0.5
Machine Bicep Curl [seed-db] biceps → biceps 1
Machine Chest Press [seed-db] chest + [front_delts, triceps] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5, triceps 0.5  ⚠ TIED uniform-split
Machine Lateral Raise [seed-db] lateral_delts → lateral_delts 1
Machine Tricep Extension [seed-db] triceps → triceps 1
Meadows Row [seed-db] back + [biceps, rear_delts, forearms] → biceps 0.5, forearms 0.5, lats 0.5, rear_delts 0.5, upper_back 0.5  ⚠ TIED uniform-split
Nordic Curl [seed-db] hamstrings → hamstrings 1
Overhead Carry [seed-db] shoulders + [traps, abs, forearms] → abs 0.5, forearms 0.5, traps 0.5, front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ INVERTED uniform-split
Overhead Press [seed-db] front_delts + [triceps, chest_upper] → front_delts 1, chest_upper 0.5, triceps 0.5
Overhead Tricep Extension [seed-db] triceps → triceps 1
Pallof Press [seed-db] obliques + [abs] → obliques 1, abs 0.5
Pec Deck [seed-db] chest + [front_delts] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5  ⚠ TIED uniform-split
Pendulum Squat [seed-db] quads + [glutes, adductors] → quads 1, adductors 0.5, glutes 0.5
Plank [seed-db] abs + [obliques] → abs 1, obliques 0.5
Plate Pinch Hold [seed-db] forearms → forearms 1
Preacher Curl [seed-db] biceps → biceps 1
Prone Y-Raise [seed-db] upper_back + [rear_delts, mid_lower_traps] → upper_back 1, mid_lower_traps 0.5, rear_delts 0.5
Pull-Ups [seed-db] lats + [biceps, upper_back, rear_delts, forearms] → lats 1, biceps 0.5, forearms 0.5, rear_delts 0.5, upper_back 0.5
Rear Delt Fly [seed-db] rear_delts + [upper_back] → rear_delts 1, upper_back 0.5
Rear Delt Machine [seed-db] rear_delts + [upper_back] → rear_delts 1, upper_back 0.5
Reverse Cable Crossover [seed-db] rear_delts + [upper_back] → rear_delts 1, upper_back 0.5
Reverse Lunge [seed-db] quads + [glutes, glute_med, adductors] → quads 1, adductors 0.5, glute_med 0.5, glutes 0.5
Reverse Wrist Curl [seed-db] forearms → forearms 1
RKC Plank [seed-db] abs + [glutes, obliques] → abs 1, glutes 0.5, obliques 0.5
Romanian Deadlift [seed-db] hamstrings + [glutes, erectors, forearms, traps] → hamstrings 1, erectors 0.5, forearms 0.5, glutes 0.5, traps 0.5
Rope Tricep Pushdown [seed-db] triceps → triceps 1
Russian Twist [seed-db] obliques + [abs] → obliques 1, abs 0.5
Seal Row [seed-db] upper_back + [lats, biceps, rear_delts] → upper_back 1, biceps 0.5, lats 0.5, rear_delts 0.5
Seated Cable Fly [seed-db] chest + [front_delts] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5  ⚠ TIED uniform-split
Seated Calf Raise [seed-db] soleus + [gastrocnemius] → soleus 1, gastrocnemius 0.5
Seated Leg Curl [seed-db] hamstrings → hamstrings 1
Seated Machine Row [seed-db] back + [biceps, rear_delts, forearms] → biceps 0.5, forearms 0.5, lats 0.5, rear_delts 0.5, upper_back 0.5  ⚠ TIED uniform-split
Side Plank [seed-db] obliques + [abs] → obliques 1, abs 0.5
Side-Lying Hip Abduction [seed-db] glute_med → glute_med 1
Single Leg Calf Raise [seed-db] gastrocnemius + [soleus] → gastrocnemius 1, soleus 0.5
Single Leg Hip Thrust [seed-db] glutes + [hamstrings, glute_med] → glutes 1, glute_med 0.5, hamstrings 0.5
Single Leg RDL [seed-db] hamstrings + [glutes, erectors, glute_med] → hamstrings 1, erectors 0.5, glute_med 0.5, glutes 0.5
Sissy Squat [seed-db] quads → quads 1
Skull Crusher [seed-db] triceps → triceps 1
Smith Machine Bench Press [seed-db] chest + [front_delts, triceps] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5, triceps 0.5  ⚠ TIED uniform-split
Smith Machine Calf Raise [seed-db] gastrocnemius + [soleus] → gastrocnemius 1, soleus 0.5
Smith Machine Incline Press [seed-db] chest_upper + [chest_lower, front_delts, triceps] → chest_upper 1, chest_lower 0.5, front_delts 0.5, triceps 0.5
Smith Machine Shoulder Press [seed-db] front_delts + [triceps, chest_upper] → front_delts 1, chest_upper 0.5, triceps 0.5
Smith Machine Squat [seed-db] quads + [glutes, adductors] → quads 1, adductors 0.5, glutes 0.5
Standing Calf Raise [seed-db] gastrocnemius + [soleus] → gastrocnemius 1, soleus 0.5
Step Up [seed-db] quads + [glutes, glute_med] → quads 1, glute_med 0.5, glutes 0.5
Stiff Leg Deadlift [seed-db] hamstrings + [glutes, erectors, forearms, traps] → hamstrings 1, erectors 0.5, forearms 0.5, glutes 0.5, traps 0.5
Straight Arm Pulldown [seed-db] lats → lats 1
Suitcase Carry [seed-db] abs + [obliques, traps, forearms, erectors] → abs 1, erectors 0.5, forearms 0.5, obliques 0.5, traps 0.5
Sumo Deadlift [seed-db] glutes + [hamstrings, quads, adductors, erectors, traps, forearms] → glutes 1, adductors 0.5, erectors 0.5, forearms 0.5, hamstrings 0.5, quads 0.5, traps 0.5
Superman Hold [seed-db] erectors + [glutes] → erectors 1, glutes 0.5
Tricep Pushdown [seed-db] triceps → triceps 1
Triceps Extension (Dumbbell) [seed-db] triceps → triceps 1
Upright Row [seed-db] lateral_delts + [upper_traps, biceps] → lateral_delts 1, biceps 0.5, upper_traps 0.5
Walking Lunges [seed-db] quads + [glutes, glute_med, adductors] → quads 1, adductors 0.5, glute_med 0.5, glutes 0.5
Wall Sit [seed-db] quads + [glutes] → quads 1, glutes 0.5
Wide-Grip Seated Cable Row [seed-db] upper_back + [lats, biceps, rear_delts] → upper_back 1, biceps 0.5, lats 0.5, rear_delts 0.5
Wrist Roller [seed-db] forearms → forearms 1
45° Preacher Curl [service-fallback] biceps → biceps 1
Ab Wheel Rollout [service-fallback] abs → abs 1
Arnold Press [service-fallback] shoulders + [triceps] → triceps 0.5, front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ INVERTED uniform-split
Assisted Dip Machine [service-fallback] triceps + [chest_lower, front_delts] → triceps 1, chest_lower 0.5, front_delts 0.5
Assisted Pull-Up Machine [service-fallback] lats + [biceps, upper_back, rear_delts] → lats 1, biceps 0.5, rear_delts 0.5, upper_back 0.5
Back Extension [service-fallback] glutes + [hamstrings, erectors] → glutes 1, erectors 0.5, hamstrings 0.5
Barbell Back Squat [service-fallback] quads + [glutes, adductors, erectors] → quads 1, adductors 0.5, erectors 0.5, glutes 0.5
Barbell Bench Press [service-fallback] chest + [front_delts, triceps] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5, triceps 0.5  ⚠ TIED uniform-split
Barbell Curl [service-fallback] biceps → biceps 1
Barbell Row [service-fallback] back + [biceps, rear_delts, forearms] → biceps 0.5, forearms 0.5, lats 0.5, rear_delts 0.5, upper_back 0.5  ⚠ TIED uniform-split
Barbell Shrug [service-fallback] upper_traps → upper_traps 1
Barbell Wrist Curl [service-fallback] forearms → forearms 1
Bayesian Cable Curl [service-fallback] biceps → biceps 1
Behind-the-Back Cable Lateral Raise [service-fallback] lateral_delts → lateral_delts 1
Bulgarian Split Squat [service-fallback] quads + [glutes, glute_med, adductors] → quads 1, adductors 0.5, glute_med 0.5, glutes 0.5
Cable Crunch [service-fallback] abs → abs 1
Cable Curl [service-fallback] biceps → biceps 1
Cable Fly [service-fallback] chest + [front_delts] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5  ⚠ TIED uniform-split
Cable Glute Kickback [service-fallback] glutes → glutes 1
Cable Lateral Raise [service-fallback] shoulders → front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ uniform-split
Cable Pull-Through [service-fallback] glutes + [hamstrings] → glutes 1, hamstrings 0.5
Cable Row [service-fallback] back + [biceps, rear_delts, forearms] → biceps 0.5, forearms 0.5, lats 0.5, rear_delts 0.5, upper_back 0.5  ⚠ TIED uniform-split
Cable Upright Row [service-fallback] lateral_delts + [upper_traps, biceps] → lateral_delts 1, biceps 0.5, upper_traps 0.5
Cable Woodchop [service-fallback] obliques + [abs] → obliques 1, abs 0.5
Cable Y-Raise [service-fallback] lateral_delts + [mid_lower_traps] → lateral_delts 1, mid_lower_traps 0.5
Captain's Chair Leg Raise [service-fallback] abs + [obliques] → abs 1, obliques 0.5
Chest Supported Row [service-fallback] back + [biceps, rear_delts, forearms] → biceps 0.5, forearms 0.5, lats 0.5, rear_delts 0.5, upper_back 0.5  ⚠ TIED uniform-split
Chin-Up [service-fallback] back + [biceps] → biceps 0.5, lats 0.5, upper_back 0.5  ⚠ TIED uniform-split
Close Grip Lat Pulldown [service-fallback] lats + [biceps, upper_back, rear_delts] → lats 1, biceps 0.5, rear_delts 0.5, upper_back 0.5
Close-Grip Bench Press [service-fallback] triceps + [chest, shoulders] → triceps 1, chest_lower 0.25, chest_upper 0.25, front_delts 0.17, lateral_delts 0.17, rear_delts 0.17
Concentration Curl [service-fallback] biceps → biceps 1
Conventional Deadlift [service-fallback] hamstrings + [glutes, back, quads] → hamstrings 1, glutes 0.5, quads 0.5, lats 0.25, upper_back 0.25
Dead Bug [service-fallback] abs → abs 1
Decline Barbell Press [service-fallback] chest_lower + [chest_upper, front_delts, triceps] → chest_lower 1, chest_upper 0.5, front_delts 0.5, triceps 0.5
Decline Crunch [service-fallback] abs → abs 1
Dip [service-fallback] chest + [triceps, shoulders] → chest_lower 0.5, chest_upper 0.5, triceps 0.5, front_delts 0.17, lateral_delts 0.17, rear_delts 0.17  ⚠ TIED uniform-split
Donkey Calf Raise [service-fallback] gastrocnemius + [soleus] → gastrocnemius 1, soleus 0.5
Dumbbell Bench Press [service-fallback] chest + [front_delts, triceps] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5, triceps 0.5  ⚠ TIED uniform-split
Dumbbell Curl [service-fallback] biceps → biceps 1
Dumbbell Kickback [service-fallback] triceps → triceps 1
Dumbbell RDL [service-fallback] hamstrings + [glutes] → hamstrings 1, glutes 0.5
Dumbbell Row [service-fallback] back + [biceps, rear_delts, forearms] → biceps 0.5, forearms 0.5, lats 0.5, rear_delts 0.5, upper_back 0.5  ⚠ TIED uniform-split
Dumbbell Shrug [service-fallback] upper_traps → upper_traps 1
Dumbbell Side Bend [service-fallback] obliques → obliques 1
Dumbbell Wrist Curl [service-fallback] forearms → forearms 1
EZ Bar Curl [service-fallback] biceps → biceps 1
EZ Bar Reverse Curl [service-fallback] forearms + [biceps] → forearms 1, biceps 0.5
Face Pull [service-fallback] rear_delts + [upper_back, mid_lower_traps] → rear_delts 1, mid_lower_traps 0.5, upper_back 0.5
Farmer's Carry [service-fallback] forearms + [traps, abs, glutes] → forearms 1, abs 0.5, glutes 0.5, traps 0.5
Front Raise [service-fallback] front_delts → front_delts 1
Front Squat [service-fallback] quads + [glutes] → quads 1, glutes 0.5
Glute Bridge [service-fallback] glutes + [hamstrings] → glutes 1, hamstrings 0.5
Glute Drive Machine [service-fallback] glutes + [hamstrings] → glutes 1, hamstrings 0.5
Goblet Squat [service-fallback] quads + [glutes] → quads 1, glutes 0.5
Good Morning [service-fallback] hamstrings + [glutes, erectors] → hamstrings 1, erectors 0.5, glutes 0.5
Hack Squat [service-fallback] quads + [glutes, adductors] → quads 1, adductors 0.5, glutes 0.5
Hammer Curl [service-fallback] biceps + [forearms] → biceps 1, forearms 0.5
Hanging Leg Raise [service-fallback] abs + [obliques] → abs 1, obliques 0.5
Hip Abduction Machine [service-fallback] glute_med + [glutes] → glute_med 1, glutes 0.5
Hip Adduction Machine [service-fallback] adductors → adductors 1
Hip Thrust [service-fallback] glutes + [hamstrings] → glutes 1, hamstrings 0.5
Incline Barbell Press [service-fallback] chest + [triceps, shoulders] → chest_lower 0.5, chest_upper 0.5, triceps 0.5, front_delts 0.17, lateral_delts 0.17, rear_delts 0.17  ⚠ TIED uniform-split
Incline Dumbbell Curl [service-fallback] biceps → biceps 1
Incline Dumbbell Press [service-fallback] chest_upper + [chest_lower, front_delts, triceps] → chest_upper 1, chest_lower 0.5, front_delts 0.5, triceps 0.5
Jefferson Curl [service-fallback] erectors + [hamstrings] → erectors 1, hamstrings 0.5
Katana Tricep Extension [service-fallback] triceps → triceps 1
Lat Pulldown [service-fallback] lats + [biceps, upper_back, rear_delts] → lats 1, biceps 0.5, rear_delts 0.5, upper_back 0.5
Lateral Raise [service-fallback] lateral_delts → lateral_delts 1
Leg Extension [service-fallback] quads → quads 1
Leg Press [service-fallback] quads + [glutes, adductors] → quads 1, adductors 0.5, glutes 0.5
Leg Press Calf Raise [service-fallback] gastrocnemius + [soleus] → gastrocnemius 1, soleus 0.5
Lying Leg Curl [service-fallback] hamstrings → hamstrings 1
Machine Ab Crunch [service-fallback] abs → abs 1
Machine Back Extension [service-fallback] erectors + [glutes] → erectors 1, glutes 0.5
Machine Bicep Curl [service-fallback] biceps → biceps 1
Machine Chest Press [service-fallback] chest + [front_delts, triceps] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5, triceps 0.5  ⚠ TIED uniform-split
Machine Lateral Raise [service-fallback] lateral_delts → lateral_delts 1
Machine Shoulder Press [service-fallback] shoulders + [triceps] → triceps 0.5, front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ INVERTED uniform-split
Machine Tricep Extension [service-fallback] triceps → triceps 1
Meadows Row [service-fallback] back + [biceps, rear_delts, forearms] → biceps 0.5, forearms 0.5, lats 0.5, rear_delts 0.5, upper_back 0.5  ⚠ TIED uniform-split
Nordic Curl [service-fallback] hamstrings → hamstrings 1
Overhead Tricep Extension [service-fallback] triceps → triceps 1
Pallof Press [service-fallback] obliques + [abs] → obliques 1, abs 0.5
Pec Deck [service-fallback] chest + [front_delts] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5  ⚠ TIED uniform-split
Pendulum Squat [service-fallback] quads + [glutes, adductors] → quads 1, adductors 0.5, glutes 0.5
Plank [service-fallback] abs + [obliques] → abs 1, obliques 0.5
Preacher Curl [service-fallback] biceps → biceps 1
Pull-Up [service-fallback] back + [biceps] → biceps 0.5, lats 0.5, upper_back 0.5  ⚠ TIED uniform-split
Push-Up [service-fallback] chest + [triceps, shoulders] → chest_lower 0.5, chest_upper 0.5, triceps 0.5, front_delts 0.17, lateral_delts 0.17, rear_delts 0.17  ⚠ TIED uniform-split
Rear Delt Machine [service-fallback] rear_delts + [upper_back] → rear_delts 1, upper_back 0.5
Reverse Cable Crossover [service-fallback] rear_delts + [upper_back] → rear_delts 1, upper_back 0.5
Reverse Fly [service-fallback] shoulders + [traps, back] → traps 0.5, front_delts 0.33, lateral_delts 0.33, rear_delts 0.33, lats 0.25, upper_back 0.25  ⚠ INVERTED uniform-split
Reverse Lunge [service-fallback] quads + [glutes, glute_med, adductors] → quads 1, adductors 0.5, glute_med 0.5, glutes 0.5
Reverse Wrist Curl [service-fallback] forearms → forearms 1
Romanian Deadlift [service-fallback] hamstrings + [glutes, erectors, forearms, traps] → hamstrings 1, erectors 0.5, forearms 0.5, glutes 0.5, traps 0.5
Rope Tricep Pushdown [service-fallback] triceps → triceps 1
Russian Twist [service-fallback] obliques + [abs] → obliques 1, abs 0.5
Seal Row [service-fallback] upper_back + [lats, biceps, rear_delts] → upper_back 1, biceps 0.5, lats 0.5, rear_delts 0.5
Seated Cable Fly [service-fallback] chest + [front_delts] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5  ⚠ TIED uniform-split
Seated Calf Raise [service-fallback] soleus + [gastrocnemius] → soleus 1, gastrocnemius 0.5
Seated Dumbbell Shoulder Press [service-fallback] shoulders + [triceps] → triceps 0.5, front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ INVERTED uniform-split
Seated Leg Curl [service-fallback] hamstrings → hamstrings 1
Seated Machine Row [service-fallback] back + [biceps, rear_delts, forearms] → biceps 0.5, forearms 0.5, lats 0.5, rear_delts 0.5, upper_back 0.5  ⚠ TIED uniform-split
Side Plank [service-fallback] obliques + [abs] → obliques 1, abs 0.5
Single Leg Hip Thrust [service-fallback] glutes + [hamstrings, glute_med] → glutes 1, glute_med 0.5, hamstrings 0.5
Single Leg RDL [service-fallback] hamstrings + [glutes, erectors, glute_med] → hamstrings 1, erectors 0.5, glute_med 0.5, glutes 0.5
Sissy Squat [service-fallback] quads → quads 1
Skull Crusher [service-fallback] triceps → triceps 1
Smith Machine Bench Press [service-fallback] chest + [front_delts, triceps] → chest_lower 0.5, chest_upper 0.5, front_delts 0.5, triceps 0.5  ⚠ TIED uniform-split
Smith Machine Calf Raise [service-fallback] gastrocnemius + [soleus] → gastrocnemius 1, soleus 0.5
Smith Machine Incline Press [service-fallback] chest_upper + [chest_lower, front_delts, triceps] → chest_upper 1, chest_lower 0.5, front_delts 0.5, triceps 0.5
Smith Machine Shoulder Press [service-fallback] front_delts + [triceps, chest_upper] → front_delts 1, chest_upper 0.5, triceps 0.5
Smith Machine Squat [service-fallback] quads + [glutes, adductors] → quads 1, adductors 0.5, glutes 0.5
Standing Calf Raise [service-fallback] gastrocnemius + [soleus] → gastrocnemius 1, soleus 0.5
Standing Overhead Press [service-fallback] shoulders + [triceps] → triceps 0.5, front_delts 0.33, lateral_delts 0.33, rear_delts 0.33  ⚠ INVERTED uniform-split
Step Up [service-fallback] quads + [glutes, glute_med] → quads 1, glute_med 0.5, glutes 0.5
Stiff Leg Deadlift [service-fallback] hamstrings + [glutes, erectors, forearms, traps] → hamstrings 1, erectors 0.5, forearms 0.5, glutes 0.5, traps 0.5
Straight Arm Pulldown [service-fallback] lats → lats 1
Suitcase Carry [service-fallback] abs + [obliques, traps, forearms, erectors] → abs 1, erectors 0.5, forearms 0.5, obliques 0.5, traps 0.5
Sumo Deadlift [service-fallback] glutes + [hamstrings, quads, adductors, erectors, traps, forearms] → glutes 1, adductors 0.5, erectors 0.5, forearms 0.5, hamstrings 0.5, quads 0.5, traps 0.5
Superman Hold [service-fallback] erectors + [glutes] → erectors 1, glutes 0.5
T-Bar Row [service-fallback] back + [biceps] → biceps 0.5, lats 0.5, upper_back 0.5  ⚠ TIED uniform-split
Tricep Pushdown [service-fallback] triceps → triceps 1
Triceps Dip [service-fallback] triceps + [chest, shoulders] → triceps 1, chest_lower 0.25, chest_upper 0.25, front_delts 0.17, lateral_delts 0.17, rear_delts 0.17
Upright Row [service-fallback] lateral_delts + [upper_traps, biceps] → lateral_delts 1, biceps 0.5, upper_traps 0.5
Walking Lunge [service-fallback] quads + [glutes] → quads 1, glutes 0.5
```

### Invariant failures (verbatim audit output)

```
Arnold Press [service-fallback] inverted: primary peak 0.33 (front_delts/lateral_delts/rear_delts) vs triceps 0.5
Arnold Press [program-template] inverted: primary peak 0.33 (front_delts/lateral_delts/rear_delts) vs triceps 0.5
Machine Shoulder Press [service-fallback] inverted: primary peak 0.33 (front_delts/lateral_delts/rear_delts) vs triceps 0.5
Machine Shoulder Press [program-template] inverted: primary peak 0.33 (front_delts/lateral_delts/rear_delts) vs triceps 0.5
Overhead Carry [seed-db] inverted: primary peak 0.33 (front_delts/lateral_delts/rear_delts) vs traps 0.5
Reverse Fly [service-fallback] inverted: primary peak 0.33 (front_delts/lateral_delts/rear_delts) vs traps 0.5
Seated Dumbbell Shoulder Press [service-fallback] inverted: primary peak 0.33 (front_delts/lateral_delts/rear_delts) vs triceps 0.5
Seated Dumbbell Shoulder Press [program-template] inverted: primary peak 0.33 (front_delts/lateral_delts/rear_delts) vs triceps 0.5
Standing Overhead Press [service-fallback] inverted: primary peak 0.33 (front_delts/lateral_delts/rear_delts) vs triceps 0.5
Standing Overhead Press [program-template] inverted: primary peak 0.33 (front_delts/lateral_delts/rear_delts) vs triceps 0.5
Barbell Bench Press [seed-db] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Barbell Bench Press [service-fallback] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Barbell Bench Press [program-template] tied: primary peak 0.5 (chest_upper/chest_lower) vs triceps 0.5
Barbell Row [seed-db] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Barbell Row [service-fallback] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Barbell Row [program-template] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Cable Fly [seed-db] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Cable Fly [service-fallback] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Cable Row [seed-db] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Cable Row [service-fallback] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Cable Row [program-template] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Chest Supported Row [seed-db] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Chest Supported Row [service-fallback] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Chin-Up [service-fallback] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Chin-Up [program-template] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Conventional Deadlift [program-template] tied: primary peak 0.5 (lats/upper_back) vs hamstrings 0.5
Dip [service-fallback] tied: primary peak 0.5 (chest_upper/chest_lower) vs triceps 0.5
Dip [program-template] tied: primary peak 0.5 (chest_upper/chest_lower) vs triceps 0.5
Dumbbell Bench Press [seed-db] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Dumbbell Bench Press [service-fallback] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Dumbbell Bench Press [program-template] tied: primary peak 0.5 (chest_upper/chest_lower) vs triceps 0.5
Dumbbell Fly [seed-db] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Dumbbell Row [seed-db] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Dumbbell Row [service-fallback] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Dumbbell Row [program-template] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Incline Barbell Press [service-fallback] tied: primary peak 0.5 (chest_upper/chest_lower) vs triceps 0.5
Incline Barbell Press [program-template] tied: primary peak 0.5 (chest_upper/chest_lower) vs triceps 0.5
Incline Dumbbell Press [program-template] tied: primary peak 0.5 (chest_upper/chest_lower) vs triceps 0.5
Lat Pulldown [program-template] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Machine Chest Press [seed-db] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Machine Chest Press [service-fallback] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Machine Chest Press [program-template] tied: primary peak 0.5 (chest_upper/chest_lower) vs triceps 0.5
Meadows Row [seed-db] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Meadows Row [service-fallback] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Pec Deck [seed-db] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Pec Deck [service-fallback] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Pull-Up [service-fallback] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Pull-Up [program-template] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Push-Up [service-fallback] tied: primary peak 0.5 (chest_upper/chest_lower) vs triceps 0.5
Push-Up [program-template] tied: primary peak 0.5 (chest_upper/chest_lower) vs triceps 0.5
Seated Cable Fly [seed-db] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Seated Cable Fly [service-fallback] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Seated Machine Row [seed-db] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Seated Machine Row [service-fallback] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
Smith Machine Bench Press [seed-db] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
Smith Machine Bench Press [service-fallback] tied: primary peak 0.5 (chest_upper/chest_lower) vs front_delts 0.5
T-Bar Row [service-fallback] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5
T-Bar Row [program-template] tied: primary peak 0.5 (lats/upper_back) vs biceps 0.5

```
