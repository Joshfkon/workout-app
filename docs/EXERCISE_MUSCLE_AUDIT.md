# Exercise Muscle-Mapping Audit (2026-07-02)

Audit of every stock exercise's `primary_muscle` / `secondary_muscles` against the
two-tier muscle taxonomy (`types/schema.ts`), triggered by the user-facing bug:
*muscle groups like `chest_upper` show as "not worked" even after obvious chest
sessions*.

**Effective dataset** = `supabase/seed.sql` + `20241209000003_additional_exercises`
+ `20241212000002_add_new_exercises` (both `ON CONFLICT DO NOTHING`, so the earliest
insert wins for duplicate names). ~108 stock exercises.

**Fixes** live in `supabase/migrations/20260702000001_fix_exercise_muscle_mappings.sql`
(keyed by exercise name, idempotent) with matching edits to `supabase/seed.sql`.

---

## Root causes found

### Data bugs
1. **Every stock exercise used legacy coarse muscles** (`chest`, `back`, `shoulders`),
   which cannot express the upper/lower chest, lats/upper-back, or delt-head splits
   the 20-muscle tracking system reports on.
2. **Broken secondary tokens**: `'rear delts'` (space) and `'hip flexors'` resolve to
   nothing in every credit path → rows, face pulls and leg raises silently dropped
   that credit.
3. **Missing synergists**: presses had no `front_delts`, rows no `forearms`, squats no
   `adductors`/`erectors`, hinges no `erectors`/`traps`/`forearms`, flys nothing at all.
4. **Wrong primaries**: shrugs were `shoulders` (credited **front delts**), Hip
   Adduction Machine was `glutes`, Deadlift/Back Extension were `back` (credited lats).

### Credit-path bugs (fixed in code)
1. **Winner-takes-all legacy resolution** — `volumeTracker.resolveToStandardMuscle`
   and `lib/migrations/muscle-groups.toStandardMuscleForVolume` mapped a legacy
   primary to only the FIRST standard muscle: `chest`→`chest_upper`,
   `shoulders`→`front_delts`, `back`→`lats`. So lateral raises credited front delts,
   and `chest_lower`, `upper_back`, `lateral_delts`, `rear_delts` were structurally
   unreachable from primaries. **Fix**: `resolvePrimaryMuscleCredits()` in
   `services/volumeTracker.ts` splits legacy primaries (`chest` → 0.5/0.5,
   `back` → 0.5/0.5, `shoulders` → ⅓/⅓/⅓; `glutes`/`abs` intentionally do NOT leak
   onto `glute_med`/`obliques`). All display aggregations now use it.
2. **`hooks/useWeeklyVolume.ts` fallback path fetched `secondary_muscles` but never
   counted them** — only primary sets were tallied. Rows contributed zero biceps
   volume on that path. Fixed (0.5 credit, matching `SECONDARY_MUSCLE_CREDIT`).
3. **DashboardClient fast path** (cached/native load) counted only primaries, keyed by
   raw legacy names. Now shares one accumulator with the main path (weighted primary
   + 0.5 secondary).
4. **`hooks/useMuscleRecovery.ts`** mapped a legacy primary to a single muscle, so a
   chest session marked only `chest_upper` as trained and `chest_lower` showed
   "Ready"/never-trained forever. Now resolves to every covered muscle.
5. **Token normalization** — `resolveMuscleToStandard()` (new, `types/schema.ts`)
   lowercases and converts spaces/hyphens to underscores, so `'Rear Delts'` now
   resolves instead of being dropped.

### Compatibility layer (so precise tags don't break selection)
`muscleMatchesGroup()` / `toLegacyMuscleGroup()` / `expandMuscleGroupForFilter()`
(`types/schema.ts`) make all muscle *matching* overlap-aware. Updated call sites:
`exerciseService` (muscle filters), `mesocycleBuilder` + `sessionBuilderWithFatigue`
(program generation, warmups, ab rest periods), `exerciseSwapper` +
`injuryAwareSwapper` (swap pools, injury heuristics), `ExerciseCard` (swap muscle
chips, added traps/adductors chips), `workout/new` (muscle queries + suggester).
A legacy `shoulders` filter still matches `lateral_delts` exercises, and injury
heuristics still see `chest_upper` as "chest".

---

## Changed exercises (69)

Legend: **P** = primary_muscle, **S** = secondary_muscles.

### Chest (12)

| Exercise | Before → After | Why |
|---|---|---|
| Barbell Bench Press | S `[triceps, shoulders]` → `[front_delts, triceps]` | 'shoulders' smeared credit over all 3 delt heads; flat pressing works front delts specifically |
| Dumbbell Bench Press | S `[triceps, shoulders]` → `[front_delts, triceps]` | same |
| Machine Chest Press | S `[triceps, shoulders]` → `[front_delts, triceps]` | same |
| Smith Machine Bench Press | S `[triceps, shoulders]` → `[front_delts, triceps]` | same |
| Cable Fly | S `[]` → `[front_delts]` | horizontal adduction recruits anterior delt |
| Dumbbell Fly | S `[]` → `[front_delts]` | same |
| Seated Cable Fly | S `[]` → `[front_delts]` | same |
| Pec Deck | S `[]` → `[front_delts]` | same |
| Incline Dumbbell Press | P `chest` → `chest_upper`; S `[shoulders, triceps]` → `[chest_lower, front_delts, triceps]` | incline is clavicular-dominant; sternal head still assists |
| Smith Machine Incline Press | P `chest` → `chest_upper`; S → `[chest_lower, front_delts, triceps]` | same |
| Decline Barbell Press | P `chest` → `chest_lower`; S `[triceps]` → `[chest_upper, front_delts, triceps]` | decline is sternal-dominant; clavicular gets partial credit |
| Dips (Chest Focus) | P `chest` → `chest_lower`; S `[triceps, shoulders]` → `[chest_upper, front_delts, triceps]` | dips emphasize lower chest |

Flat pressing and flys deliberately KEEP `chest`: both heads work hard and the volume
tracker now splits legacy `chest` 0.5/0.5 across `chest_upper`/`chest_lower` — this is
what fixes "chest_upper not worked after flat pressing".

### Back (10)

| Exercise | Before → After | Why |
|---|---|---|
| Barbell Row | S `[biceps, 'rear delts']` → `[biceps, rear_delts, forearms]` | 'rear delts' resolved to nothing; grip work is real |
| Dumbbell Row | same | same |
| Cable Row | same | same |
| Chest Supported Row | same | same |
| Seated Machine Row | S `[biceps]` → `[biceps, rear_delts, forearms]` | rows train rear delts + grip |
| Meadows Row | S `[biceps]` → `[biceps, rear_delts, forearms]` | same |
| Lat Pulldown | P `back` → `lats`; S `[biceps]` → `[biceps, upper_back, rear_delts]` | vertical pulls are lat-dominant |
| Close Grip Lat Pulldown | same as Lat Pulldown | same |
| Pull-Ups | P `back` → `lats`; S → `[biceps, upper_back, rear_delts, forearms]` | + dead-hang grip |
| Assisted Pull-Up / Assisted Pull-Up Machine | P `back` → `lats`; S → `[biceps, upper_back, rear_delts]` | same |
| Straight Arm Pulldown | P `back` → `lats` | lat isolation |
| Deadlift | P `back` → `glutes`; S `[glutes, hamstrings, quads]` → `[hamstrings, erectors, traps, forearms, quads]` | hip hinge, glute-dominant; 'back' credited lats with every set. Matches Sumo Deadlift (already `glutes`) |
| Back Extension | P `back` → `glutes`; S `[hamstrings, glutes]` → `[hamstrings, erectors]` | trains posterior chain, not lats/upper back |

Rows deliberately KEEP `back` — lats and upper back are both heavily loaded; the
tracker splits legacy `back` 0.5/0.5 across `lats`/`upper_back`.

### Shoulders (17)

| Exercise | Before → After | Why |
|---|---|---|
| Overhead Press | P `shoulders` → `front_delts`; S `[triceps]` → `[triceps, chest_upper]` | OHP is front-delt work; clavicular pec assists overhead |
| Dumbbell Shoulder Press | same | same |
| Smith Machine Shoulder Press | same | same |
| Lateral Raise | P `shoulders` → `lateral_delts` | previously credited **front delts** (first-match bug) |
| Machine Lateral Raise | same | same |
| Cable Cross Body Lateral Raise | same | same |
| Behind-the-Back Cable Lateral Raise | same | same |
| Cable Y-Raise | P `shoulders` → `lateral_delts`; S `[]` → `[traps]` | Y-raise recruits lower traps |
| Face Pull | P `shoulders` → `rear_delts`; S `['rear delts', back]` → `[upper_back, traps]` | rear-delt/external-rotation work; old secondaries were broken/coarse |
| Rear Delt Fly | P `shoulders` → `rear_delts`; S `[]` → `[upper_back]` | previously credited front delts |
| Rear Delt Machine | P `shoulders` → `rear_delts`; S `[back]` → `[upper_back]` | same |
| Reverse Cable Crossover | same as Rear Delt Machine | same |
| Front Raise | P `shoulders` → `front_delts` | anterior-delt isolation |
| Upright Row | P `shoulders` → `lateral_delts`; S `[biceps]` → `[traps, biceps]` | side delts + traps |
| Cable Upright Row | same | same |
| Dumbbell Shrug | P `shoulders` → `traps`; S `[traps]` → `[]` | shrug sets were credited to **front delts**, with traps only at 0.5 |
| Barbell Shrug | same | same |

### Triceps (3)

| Exercise | Before → After | Why |
|---|---|---|
| Close Grip Bench Press | S `[chest, shoulders]` → `[chest, front_delts]` | keep coarse `chest` (both heads, split 0.25/0.25); front delts, not all delts |
| Dips (Tricep Focus) | S `[chest, shoulders]` → `[chest_lower, front_delts]` | upright dips still hit lower chest |
| Assisted Dip Machine | S `[chest, shoulders]` → `[chest_lower, front_delts]` | same |

### Quads (10)

| Exercise | Before → After | Why |
|---|---|---|
| Barbell Back Squat | S `[glutes, hamstrings]` → `[glutes, adductors, erectors]` | hamstring growth from squats is a known myth (biarticular); adductors + erectors are real |
| Leg Press | S `[glutes, hamstrings]` → `[glutes, adductors]` | no erector load (supported back) |
| Incline Leg Press | same | same |
| Hack Squat | S `[glutes]` → `[glutes, adductors]` | deep knee/hip flexion loads adductor magnus |
| Smith Machine Squat | same | same |
| Pendulum Squat | same | same |
| Bulgarian Split Squat | S `[glutes, hamstrings]` → `[glutes, glute_med, adductors]` | single-leg = glute-med stabilization |
| Walking Lunges | same | same |
| Reverse Lunge | S `[glutes]` → `[glutes, glute_med, adductors]` | same |
| Step Up | S `[glutes]` → `[glutes, glute_med]` | same |

### Hamstrings (4)

| Exercise | Before → After | Why |
|---|---|---|
| Romanian Deadlift | S `[glutes, back]` → `[glutes, erectors, forearms, traps]` | 'back' credited lats; hinges load erectors/grip/traps |
| Stiff Leg Deadlift | S `[back, glutes]` → `[glutes, erectors, forearms, traps]` | same |
| Single Leg RDL | S `[glutes]` → `[glutes, erectors, glute_med]` | unilateral hinge |
| Good Morning | S `[glutes, back]` → `[glutes, erectors]` | same 'back'→erectors fix |

### Glutes / hips (5)

| Exercise | Before → After | Why |
|---|---|---|
| Cable Pull Through | S `[hamstrings]` → `[hamstrings, erectors]` | hinge pattern |
| Single Leg Hip Thrust | S `[hamstrings]` → `[hamstrings, glute_med]` | unilateral |
| Sumo Deadlift | S `[hamstrings, back, quads]` → `[hamstrings, quads, adductors, erectors, traps, forearms]` | sumo is adductor-heavy; 'back' → erectors/traps |
| Hip Abduction Machine | P `glutes` → `glute_med`; S `[]` → `[glutes]` | abduction is glute-med work |
| Hip Adduction Machine | P `glutes` → `adductors` | it is an adductor machine |

### Core (8)

| Exercise | Before → After | Why |
|---|---|---|
| Hanging Leg Raise | S `['hip flexors']` → `[obliques]` | 'hip flexors' isn't in any taxonomy (credit dropped) |
| Captain's Chair Leg Raise | S `[]` → `[obliques]` | consistency with hanging raise |
| Plank | S `[shoulders]` → `[obliques]` | delt credit from planks is trivial; obliques stabilize |
| Pallof Press | P `abs` → `obliques`; S `[]` → `[abs]` | anti-rotation = obliques |
| Russian Twist | same | rotation = obliques |
| Cable Woodchop | P `abs` → `obliques`; S `[shoulders]` → `[abs]` | same, and drops trivial delt credit |
| Farmer's Carry | S `[shoulders, back]` → `[traps, forearms, obliques, erectors]` | carries are trap/grip/trunk work |
| Suitcase Carry | S `[shoulders]` → `[obliques, traps, forearms, erectors]` | unilateral carry = heavy oblique demand |

### Deliberately NOT changed
- Flat presses/flys keep `chest`; rows keep `back` (both sub-groups genuinely loaded;
  handled by the weighted primary split).
- Curl variants get no forearm secondary except Hammer Curl (already has it) —
  brachioradialis work in supinated curls is marginal at 0.5-set credit.
- Lateral raises get no `traps` secondary — deliberately marginal.
- Leg curls get no `calves` secondary — marginal.
- `services/exerciseService.ts` / `lib/training/constants.ts` fallback arrays keep
  legacy tags: they are only used when the DB is unreachable, and matching is now
  overlap-aware either way.

---

## Muscles reachable only via indirect credit, and MEV sanity

With the corrected data + split credit, per-muscle sources are:

| Muscle | Direct sources in stock library | Intermediate MEV | Verdict |
|---|---|---|---|
| `forearms` | **none** (no wrist-curl exercises exist) | 3 | OK — rows/hinges/pull-ups/carries at 0.5 easily provide 3+; consider adding wrist curl / reverse curl exercises later |
| `erectors` | **none** (Back Extension is glutes-primary with erectors secondary) | 3 | OK — schema comment already says erectors are fed by hinges/squats; indirect fill covers MEV |
| `obliques` | Pallof Press, Russian Twist, Cable Woodchop (now) | 0 | OK — MEV 0 by design |
| `glute_med` | Hip Abduction Machine (now) | 0 | OK — MEV 0 by design |
| `chest_upper` | Incline presses (now primary) + 0.5/set from flat chest + OHP secondary | 6 | OK — 12 flat-only sets = 6 credited; app correctly nudges toward incline if only flat work is done |
| `chest_lower` | Decline press, chest dips (now primary) + 0.5/set from flat chest | 4 | OK |
| `upper_back` | none primary; 0.5/set from every row + rear-delt/pull secondaries | 6 | Borderline — 3 row exercises x 4 sets = 6 credited; acceptable, rows are genuinely upper-back training |
| `lateral_delts` | full lateral-raise family (now primary) | 6 | OK |
| `rear_delts` | rear-delt family + face pull (now primary) + 0.5/row | 6 | OK |
| `front_delts` | presses (now primary) + 0.5/set from all chest pressing | 3 | OK — MEV already lowered for indirect fill |
| `traps` | shrugs, upright rows (now primary) + hinge/carry secondaries | 4 | OK |
| `adductors` | Hip Adduction Machine (now primary) + squat secondaries | 3 | OK |

### Recommendation on the below-MEV warning threshold (recommend, don't change)

**No landmark changes needed.** The below-MEV comparison uses `totalSets` =
direct + indirect, so indirect credit already counts toward MEV — the landmarks were
authored with that assumption (see the `DEFAULT_VOLUME_LANDMARKS` comments: front
delts/erectors/glute_med/obliques MEVs are already discounted for indirect work).
The complaint was never a threshold problem; it was credit silently evaporating
(first-match legacy resolution + dropped tokens + a path that ignored secondaries).

Two soft suggestions for a future pass:
1. Show the breakdown in the warning copy ("2 direct + 3 indirect of 6 MEV") so users
   understand why a muscle they never isolate isn't flagged.
2. `upper_back` MEV 6 is the tightest fit now that no stock exercise is
   upper-back-primary; if users report persistent false "below MEV" there despite
   heavy rowing, either lower its MEV to 4–5 or promote wide/chest-supported rows to
   `upper_back` primary. Don't do both.
