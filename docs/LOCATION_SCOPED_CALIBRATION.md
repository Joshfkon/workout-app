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
| Session location | `workout_sessions.location_id` | The gym a session happened at. Set from the pre-workout chip or the in-workout header chip; silently defaulted to the last-used location for every other launcher (rule 12). |
| **Exercise location** | `exercise_blocks.location_id` | Per-exercise override of the session's, for the lift on a machine the session gym doesn't otherwise represent. `null` = follow the session. |
| Set location | `set_logs.location_id` | Stamped at log time from `resolveEffectiveLocation(block, session)`. **The calibration key.** `null` = legacy/unknown. |
| Soft delete | `exercises.deleted_at` | Set by `mergeAsLocationVariant` when collapsing an implement-variant duplicate. |

`resolveEffectiveLocation` (`services/progressionScope.ts`) is the single place
the override-then-session order is decided. Set stamping, history scoping and
the card's badge all call it, so they cannot drift into writing sets to one
track while reading targets off another.

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

- Pre-workout location chip selects the session location; a blank/quick
  workout silently adopts the last-used location (rule 12).
- **In-workout location chip** in the sticky header
  (`_components/WorkoutHeader.tsx`) shows the session's gym and opens
  `_components/LocationPickerSheet.tsx` to change it — the location is only
  knowable once you're standing in the gym, so it must be correctable there.
  Also in the header tools menu at a full-size hit target.
- **Per-exercise override** from the exercise's ⋮ menu ("Different machine?" /
  "Machine: {name}"), same sheet with a "Same as workout" row. This replaces
  the duplicate-an-exercise-per-gym workaround at the point where users reach
  for it.
- Both changes **re-stamp already-logged sets** (`lib/training/sessionLocation.ts`)
  and re-scope suggestions in place, so a mid-session correction moves the
  whole session rather than splitting it across two tracks. A session change
  deliberately leaves per-exercise pins alone.
- The workout card's last-session line tags a `local`-scope exercise with
  `· here` (this gym's own track), `· at {name}` (a pinned machine),
  `· est. from another gym`, or `· est. — first time on {name}` —
  `components/workout/ExerciseCard.tsx` (rule 11).
- The AI coach rationale surfaces the "treat as a starting point" note on a
  first session at a new implement (rule 4).

### Making the move all-or-nothing

There is no transaction across PostgREST calls, and not every set is in the
database yet, so `sessionLocation.ts` handles both:

- **Compensating rollback.** Moving the owning row and re-stamping its sets are
  separate requests. If the re-stamp fails, the owning row is put back, so a
  failure leaves the database where it started instead of half-moved. When even
  the compensating write fails, the result carries `rolledBack: false` and the
  UI says the workout is split rather than offering a plain retry.
- **Queued sets.** A set logged offline sits in the IndexedDB outbox carrying
  the location it was logged under; the database re-stamp cannot see it and it
  would flush later onto the old track. Queued rows are patched *first* (local,
  near-certain to succeed, and it closes the window where a flush could land
  after the database re-stamp already ran) and rolled back with everything else.
  They count toward the "N logged sets moved" toast — a queued set is a logged
  set from the user's side.

## Where a session gets its location

Every launcher stamps one, so scoping is the norm rather than an opt-in most
sessions miss:

| Launcher | Source |
|---|---|
| Pre-workout builder (`workout/new`) | The user's chip selection |
| Mesocycle / scheduled (`startMesocycleSession`) | `resolveDefaultLocationId` — most recently used, else the default flag, else oldest |
| Claimed planned shell | Same, stamped at claim time (a shell has no sets to re-stamp) |
| Anything else / legacy | `null`, which reads as unknown-gym and falls into legacy attribution (rule 6) |

`resolveDefaultLocationId` sits on the critical path of starting a workout and
therefore never throws: every failure — missing column, missing table — degrades
to `null`, exactly how sessions behaved before it existed.

Its tie-breakers are load-bearing. `last_used_at` is written from exactly one
place (`touchLocationLastUsed`, called only by the pre-workout sheet), so for
most users every row is NULL; ordering on it alone would leave the winner to
unspecified row order and silently start a scheduled workout at an arbitrary
gym. `is_default` breaks that tie the way the user asked, and `created_at`
makes the remainder deterministic.

## Deferred follow-ups

These build on the same scoped-history plumbing and are intentionally left for a
follow-up to keep this change's blast radius contained:

- **`startMesocycleSession`'s planning query does not scope by location.** Its
  per-exercise history read (rooted at `exercises`) never selects
  `set_logs.location_id`, so block targets are planned from unscoped
  all-gyms history while the live in-workout card scopes them. The two
  disagree for a `local`-scope exercise whose loads differ between gyms — the
  planned target shifts the moment the workout opens. Pre-existing; not
  touched by the per-exercise override work.
- Exercise-detail sheet "Your history here" vs "All locations" toggle (rule 11).
- Progress charts defaulting to the current location's track with a labelled
  location switcher (rule 8). Charts currently show the full cross-location
  trend, which is unchanged behavior.
- A UI entry point for `mergeAsLocationVariant` (the function + audit action are
  ready; the dedup/merge admin surface that would call them is a separate
  ticket).

## Constraints honored

- **Additive schema only**
  (`supabase/migrations/20260711000002_location_scoped_calibration.sql`,
  `20260821000001_exercise_block_location.sql`) —
  every column is `IF NOT EXISTS` / nullable; the session store, persistence,
  and outbox are untouched except the pass-through `location_id` on the log
  action and session insert.
- **No cross-machine load conversion** beyond the flagged −10% fallback.
- **Suggestion changes limited to the history-read path**, not the math.
- Migration-lag safe: `location_id` is an optional set-log column
  (`lib/offline/setOutbox.ts`) and an optional session column
  (`lib/training/sessionOrigin.ts`), stripped-and-retried if the DB predates
  the migration.
