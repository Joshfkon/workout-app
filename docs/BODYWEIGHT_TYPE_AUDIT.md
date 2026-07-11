# Bodyweight Logging Audit

Audit of the `bodyweightType` metadata (`pure` / `weighted_possible` /
`assisted_possible` / `both`) on bodyweight exercises, the two "back extension"
entries, and the state of the set-logger / e1RM path.

**Report first — the schema-level fixes (form selector, backfill migration) are
included, but the history migration for the duplicate back extensions is left
for you to run.**

---

## 1. Root cause: why `bodyweight_type` is NULL on so many exercises

`bodyweight_type` was originally assigned in
`supabase/migrations/20241224000001_bodyweight_exercises.sql` by matching
**exact, singular** names:

```sql
UPDATE exercises SET bodyweight_type = 'both'  WHERE name IN ('Pull-Up','Chin-Up') ...
UPDATE exercises SET bodyweight_type = 'weighted_possible' WHERE name = 'Back Extension' ...
UPDATE exercises SET bodyweight_type = 'pure' WHERE name IN ('Plank','Dead Bug','Ab Wheel Rollout') ...
```

Three independent failures left most bodyweight exercises unclassified:

1. **Name mismatches.** The seeded library uses different spellings/plurals than
   the classifier's targets:
   | Classifier expected | Actually in the library |
   |---|---|
   | `Pull-Up` | `Pull-Ups` |
   | `Dip` | `Dips (Chest Focus)`, `Dips (Tricep Focus)` |
   | `Hanging Leg Raise` (set) | `Captain's Chair Leg Raise` (never set) |

   None of the seed names matched, so they stayed NULL.

2. **Migration-before-seed ordering.** `supabase db reset` runs **migrations
   first, then `seed.sql`**. The name-based `UPDATE`s in `20241224000001`
   executed *before* `seed.sql` inserted `Plank`, `Glute Bridge`,
   `Hanging Leg Raise`, `Ab Wheel Rollout`, `Pull-Ups`, `Dips …` — so even the
   names that *would* have matched hit zero rows on a fresh database.

3. **Later additions never classified.** Bodyweight exercises added in 2026
   migrations were never given a type:
   `Superman Hold`, `Side Plank` (`20260705…`), `Dead Hang`,
   `Copenhagen Plank`, `Side-Lying Hip Abduction` (`20260710…`),
   `Single Leg Calf Raise` (`20260708000002`).

**Symptom in the bug report:** a NULL `bodyweight_type` leaves the set logger
guessing. The migration-inserted `Back Extension` (Glutes, Tier A) *was*
classified `weighted_possible` (it existed when `20241224000001` ran), so it
shows a weight field and has weighted history (45×13). The other back-extension
entry was never classified, so it renders as plain bodyweight with no weight
field.

---

## 2. What the backfill migration fixes

`supabase/migrations/20260712000001_backfill_bodyweight_type.sql` reclassifies by
**case-insensitive name patterns**, but only where `bodyweight_type IS NULL`
(never overriding an explicit choice) and only for `is_bodyweight` rows. It also
flags `is_bodyweight` for library bodyweight movements that were missing it.

Validated against a representative row set (throwaway Postgres 16):

| Exercise | → `bodyweight_type` |
|---|---|
| Pull-Ups, Chin-Up, Dips (Chest/Tricep Focus) | `both` (assist = band) |
| Assisted Pull-Up / Dip Machine, Nordic Curl | `assisted_possible` |
| Back extensions, Push-Up, Hanging Leg Raise, Captain's Chair Leg Raise, Glute Bridge, Single Leg Hip Thrust, Sissy Squat, Single Leg Calf Raise, Side-Lying Hip Abduction | `weighted_possible` |
| Plank, Side Plank, Copenhagen Plank, Superman Hold, Dead Hang, Dead Bug, Ab Wheel Rollout | `pure` |
| `Back Extension` (already `weighted_possible`) | unchanged (idempotent) |
| `My Weird Custom Move` (unrecognised custom) | **left NULL — flagged for you** |

The migration is idempotent (a second run updates 0 rows).

### Live-DB audit query — run this against your database

The migration handles known library movements. Because **custom exercises live
only in your database** (not in the repo), run this to see every bodyweight
exercise still lacking a type after the migration — these are the ambiguous
customs to classify by hand:

```sql
-- Remaining unclassified bodyweight exercises (mostly customs)
SELECT id, name, primary_muscle, equipment, equipment_required,
       is_custom, created_by, hypertrophy_tier
FROM exercises
WHERE is_bodyweight = true
  AND bodyweight_type IS NULL
ORDER BY is_custom DESC, name;
```

And to review everything the backfill touched:

```sql
SELECT name, bodyweight_type, assistance_type, is_custom
FROM exercises
WHERE is_bodyweight = true
ORDER BY bodyweight_type NULLS FIRST, name;
```

Suggested classification for an ambiguous custom, per the agreed rules:
`pull-up / chin-up / dip → both`; `back extension / push-up / leg raise →
weighted_possible`; `assisted machine → assisted_possible`; isometric hold →
`pure`. Anything you're unsure of: leave NULL and it behaves as "offer both".

---

## 3. The two "back extension" entries

Only **one** row exists in the repo (seed/migrations): `Back Extension`,
inserted by `20241212000002_add_new_exercises.sql` as `equipment='bodyweight'`,
classified `weighted_possible` by `20241224000001`, and **remapped from `back`
to `glutes`** by `20260702000001_fix_exercise_muscle_mappings.sql`. That is the
**Back Extension / Glutes / Tier A** entry with the 45×13 weighted history.

`Back extensions` (plural, lowercase, **Back**, **Tier B**) does **not** appear
in any seed or migration → it is a **custom exercise** in your database. This
audit cannot read your DB, so confirm its identity and history with SQL.

### Query — pull both entries with ids, source, and attached history

```sql
-- Both back-extension entries: metadata + source + set counts
SELECT e.id, e.name, e.primary_muscle, e.hypertrophy_tier,
       e.is_custom, e.created_by, e.bodyweight_type,
       count(sl.id)                        AS logged_sets,
       count(sl.id) FILTER (WHERE sl.bodyweight_data IS NOT NULL) AS bw_sets,
       min(sl.logged_at) AS first_logged,
       max(sl.logged_at) AS last_logged
FROM exercises e
LEFT JOIN exercise_blocks eb ON eb.exercise_id = e.id
LEFT JOIN set_logs sl       ON sl.exercise_block_id = eb.id
WHERE e.name ILIKE 'back extension%'
GROUP BY e.id
ORDER BY e.is_custom, e.name;
```

```sql
-- The actual set history behind each entry (spot-check the 45×13 etc.)
SELECT e.name, sl.logged_at, sl.weight_kg, sl.reps, sl.rpe,
       sl.bodyweight_data
FROM set_logs sl
JOIN exercise_blocks eb ON eb.id = sl.exercise_block_id
JOIN exercises e        ON e.id = eb.exercise_id
WHERE e.name ILIKE 'back extension%'
ORDER BY e.name, sl.logged_at;
```

### Proposed merge — DO NOT EXECUTE (your call on history migration)

**Keep** `Back Extension` (Glutes, Tier A, `weighted_possible`, has history) as
the canonical row. **Retire** the custom `Back extensions` (Back, Tier B).

Decision to make first: is `Back extensions` really the same movement, and is
its muscle attribution (`back`) something you'd rather keep? Back extensions on a
45° / GHD bench are posterior-chain dominant — the `→ glutes` remap in
`20260702000001` was deliberate. If you agree Glutes/Tier A is correct, merge
into it. If you consider your custom's `back` attribution correct, flip that
decision instead — but don't keep both.

Migration outline (run only after you've verified the history query above):

```sql
-- 1. Repoint the custom entry's logged sets onto the canonical exercise.
UPDATE exercise_blocks
SET exercise_id = '<canonical Back Extension id>'
WHERE exercise_id = '<custom Back extensions id>';

-- 2. (If you track PRs/snapshots/templates by exercise_id, repoint those too:)
--    exercise_performance_snapshots, template_exercises, mesocycle rows, etc.
--    Audit foreign keys first:
--    SELECT conrelid::regclass, conname FROM pg_constraint
--    WHERE confrelid = 'exercises'::regclass;

-- 3. Delete the now-orphaned custom entry.
DELETE FROM exercises WHERE id = '<custom Back extensions id>';
```

Before/after sanity: `logged_sets` on the canonical row should increase by
exactly the custom row's count; no `set_logs` should be left pointing at the
deleted exercise.

---

## 4. Set-logger behaviour (already implemented; verified)

The set logger already reads `bodyweightType` and reuses the existing
`SetLog.bodyweightData` fields — **no parallel representation was created.**

- `components/workout/ExerciseCard.tsx` shows a Bodyweight / Weighted / Assisted
  control for non-pure bodyweight exercises; `Weighted` is enabled for
  `weighted_possible` | `both`, `Assisted` for `assisted_possible` | `both`.
- `components/workout/SetLoggerRow.tsx` builds `bodyweightData` with
  `userBodyweightKg`, `modification`, `addedWeightKg` / `assistanceWeightKg`,
  and `effectiveLoadKg = BW ± mod`, and **persists `weightKg = effectiveLoadKg`**.
- Pure bodyweight exercises render the clean reps-only UI (no weight field).

Once `bodyweight_type` is backfilled, `Back extensions` (→ `weighted_possible`)
gets its "add weight" affordance and stops rendering as plain bodyweight.

## 5. Suggestion / e1RM path (verified — Task 5)

Because a logged bodyweight set stores `weight_kg = effectiveLoadKg`, both e1RM
paths read **total load**:

- `services/bodyweightService.ts#calculateBodyweightE1RM` uses `effectiveLoadKg`.
- `app/(dashboard)/dashboard/workout/[id]/_lib/suggestions.ts#calculateE1RM`
  (Brzycki) is keyed on `weight_kg`, which equals the effective load.

A weighted entry's e1RM is anchored on `BW + added` (there is no lever factor
today, so full bodyweight is used, matching the spec's "…else BW + 45"). An
unweighted (pure) entry stays load/reps-based and does not emit a spurious
"add weight" jump at low reps. Covered by
`app/(dashboard)/dashboard/workout/[id]/_lib/__tests__/bodyweightLoadPath.test.ts`.

## 6. Custom-exercise form (implemented — Task 3)

New custom bodyweight exercises can no longer silently lack a type. The AI-review
form (`components/exercises/CustomExerciseReviewForm.tsx`) shows a **"How is it
loaded?"** selector whenever `equipment === 'bodyweight'`, defaulted from the
name (`lib/exercises/exercise-ai-completion.ts#defaultBodyweightType`) and
**required by validation**. Covered by
`lib/exercises/__tests__/bodyweightType.test.ts`.
