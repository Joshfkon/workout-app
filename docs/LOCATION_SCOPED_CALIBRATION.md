# Location-Scoped Exercise Calibration

Machine load is implement-specific: 100 lb on one gym's plate-loaded seated
calf raise is not 100 lb on another gym's selectorized version. Historically
users encoded this by **duplicating exercises** ("Seated calf raise (ameri
fit)"), which fragmented volume counting, muscle mapping, and the exercise
library. This feature replaces that pattern with **one canonical exercise,
progression history scoped by location where the implement matters.**

## Model

| Concept | Where | Notes |
|---|---|---|
| `progressionScope` | `services/progressionScope.ts` | `global` (barbell, dumbbell, bodyweight, band, kettlebell) vs `local` (machine, cable/stack, plate-loaded, Smith). Derived from equipment class; `exercises.progression_scope_override` wins. |
| Session location | `workout_sessions.location_id` | The gym a session happened at. Set from the pre-workout chip, or silently defaulted to the last-used location (rule 12). |
| Set location | `set_logs.location_id` | Stamped at log time from the session's location. **The calibration key.** `null` = legacy/unknown. |
| Soft delete | `exercises.deleted_at` | Set by `mergeAsLocationVariant` when collapsing an implement-variant duplicate. |

No cross-machine conversion math exists — **scoped history IS the
calibration.** A first session at a new implement is a softened starting point
(−10%, flagged), not a converted estimate.

## Suggestion engine

`app/(dashboard)/dashboard/workout/[id]/_lib/suggestions.ts` scopes only the
**history-read path** (which history feeds the existing math), never the math:

- `global` exercise → full cross-location history (unchanged).
- `local` exercise, history at the current location → only that location's sets.
- `local` exercise, no history here → other locations' history, softened ~10%
  and flagged `estimatedFromOtherLocation` with a "treat as a starting point"
  note surfaced in the coach rationale and the exercise card.
- Legacy `null`-location sets → attributed to the user's most-used location; if
  ambiguous (tie / no data) they stay visible at every location. The count of
  affected sets is logged (`[progressionScope] N null-location set(s)…`).

## Volume / analytics

Weekly volume, muscle-group counts, and readiness aggregate **across**
locations — a calf set is a calf set anywhere (rule 7). This is structural: the
domain `SetLog` carries no location, so `services/volumeTracker` cannot scope by
it. Only load progression is scoped. Regression test:
`services/__tests__/volumeLocationAggregation.test.ts`.

## Migrating existing duplicates

`lib/actions/mergeExercise.ts#mergeAsLocationVariant(survivor, duplicate,
locationId)`:

1. finds the duplicate's `exercise_blocks`,
2. stamps `location_id` on their `set_logs` (the calibration key),
3. repoints those blocks to the survivor exercise,
4. soft-deletes the duplicate (`exercises.deleted_at`).

The survivor's own-location trend is never touched, so `(ameri fit)` collapses
into "Seated Calf Raise (Machine)" @ that gym without polluting the load trend.

### Duplicate-group audit — recommended action

When auditing a duplicate group, each group gets a recommended action:

| Recommended action | When | Effect |
|---|---|---|
| `merge` | True duplicate (same implement, same-scope, e.g. two "Barbell Bench Press" rows) | Fold both histories into one shared load trend. |
| `merge-as-location-variant` | **Implement variant** — same movement, different gym's machine (a `local`-scope exercise duplicated per gym, e.g. "Seated Calf Raise (ameri fit)") | `mergeAsLocationVariant`: one exercise + two location tracks. |

Rule of thumb: if the duplicate exists **only** because the load differs between
gyms and the exercise is `local`-scope, it's `merge-as-location-variant`.
Everything else is a plain `merge`.

## UX delivered

- Pre-workout location chip already selects the session location; a blank/quick
  workout silently adopts the last-used location (rule 12).
- The workout card's last-session line tags a `local`-scope exercise with
  `· here` (this gym's own track) or `· est. from another gym` (softened
  fallback) — `components/workout/ExerciseCard.tsx` (rule 11).
- The AI coach rationale surfaces the "treat as a starting point" note on a
  first session at a new implement (rule 4).

## Deferred follow-ups

These build on the same scoped-history plumbing and are intentionally left for a
follow-up to keep this change's blast radius contained:

- Exercise-detail sheet "Your history here" vs "All locations" toggle (rule 11).
- Progress charts defaulting to the current location's track with a labelled
  location switcher (rule 8). Charts currently show the full cross-location
  trend, which is unchanged behavior.
- A UI entry point for `mergeAsLocationVariant` (the function + audit action are
  ready; the dedup/merge admin surface that would call them is a separate
  ticket).

## Constraints honored

- **Additive schema only** (`supabase/migrations/20260711000002_location_scoped_calibration.sql`) —
  every column is `IF NOT EXISTS` / nullable; the session store, persistence,
  and outbox are untouched except the pass-through `location_id` on the log
  action and session insert.
- **No cross-machine load conversion** beyond the flagged −10% fallback.
- **Suggestion changes limited to the history-read path**, not the math.
- Migration-lag safe: `location_id` is an optional set-log column
  (`lib/offline/setOutbox.ts`) and an optional session column
  (`lib/training/sessionOrigin.ts`), stripped-and-retried if the DB predates
  the migration.
