# P2-12 — Capability diff: `/dashboard/workout` (old hub) vs. everything else

**Question this answers:** if we reduce the demoted old hub to its stated
purpose ("Planned sessions & recovery"), what gets *preserved*, what's *safe
to drop as duplicate*, and what must be *relocated first*?

**Method:** enumerated every action/section/mutation in
`app/(dashboard)/dashboard/workout/page.tsx` (3,075 lines, 4 tabs) and matched
each against the launcher and the dedicated routes.

Coverage sources checked: `/dashboard/log` (Train launcher), `/dashboard/mesocycle`,
`/dashboard/history`, `/dashboard/templates`, `/dashboard/exercises`,
`/dashboard/analytics`, home hero (`TodayHeroCard`).

Legend: **DUP** = fully covered elsewhere · **DUP+RISK** = covered, and the
hub's version is an extra session-creation path · **MOVE** = unique, must
relocate before removal · **DROP** = unique but low-value.

---

## Tab 1 — "workouts"

| Capability | Hub ref | Covered by | Verdict |
|---|---|---|---|
| Start ad-hoc workout ("Start Quick Workout") | l.1850, `handleQuickStart` l.1294 | `/log` ad-hoc start via `getOrCreateTodaySession` | **DUP** |
| **Direct `workout_sessions` INSERT + `exercise_blocks` INSERT** | l.931, l.1009 | `/log` uses the safe `getOrCreateTodaySession` (nothing created until Start, l.655) | **DUP+RISK** — this is the duplicate creation surface the audit flagged |
| AI-planned workout | AI card → `/workout/new?ai=true` l.1641 | `/log` AI sheet (starts with blocks, l.416/461) | **DUP** |
| In-progress resume | `inProgressWorkout` l.212 | `/log` resume (l.515) + home hero | **DUP** |
| Full planned-sessions list | planned section | home hero shows today; `/log` shows in-progress | **DUP** (marginal: multi-day planned list is thin value in the ad-hoc+meso model) |
| Muscle recovery card | `MuscleRecoveryCard` l.1706 | `/dashboard/analytics` (same component) | **DUP** |
| Templates: create/delete folder + template | `handleCreateFolder/Template/Delete` l.1324–1381 | `/dashboard/templates` (full CRUD + new Quick-start) | **DUP** |
| Card reorder / hide personalization | localStorage order+hidden l.255–420 | nowhere | **DROP** (low value; not worth carrying) |

## Tab 2 — "mesocycle"

| Capability | Hub ref | Covered by | Verdict |
|---|---|---|---|
| Active mesocycle view | `activeMeso` | `/dashboard/mesocycle` | **DUP** |
| Today's programmed workout + start | `handleStartMesocycleWorkout` l.1397 | `/dashboard/mesocycle` (`todayWorkout` + `startMesocycleWorkoutSession` l.271) | **DUP** |
| Past mesocycles + delete | `handleDeleteMesocycle` l.1260 | `/dashboard/mesocycle` (l.749 + `handleDeleteMesocycle` l.165) | **DUP** |
| "What is a Mesocycle?" education | l.2324 | educational copy; `/learn` covers the concept | **DUP** (or DROP) |
| Inline edit preferred training days (active meso) | `WorkoutDaySelector` l.2112 | component reused in `mesocycle/new`, but **not on `/dashboard/mesocycle` view** | **MOVE** (trivial — drop the same component into the mesocycle view) |

## Tab 3 — "history"

| Capability | Hub ref | Covered by | Verdict |
|---|---|---|---|
| Workout history list + expand | `fetchHistory` l.751, `toggleExpand` | `/dashboard/history` (richer: pagination, calendar, filters, inline edit) | **DUP** (dedicated is a superset) |
| Delete workout | `handleDeleteWorkout` l.841 | `/dashboard/history` | **DUP** |
| Bulk delete / multi-select | `handleBulkDelete` l.1050 | `/dashboard/history` (also present) | **DUP** |
| **Redo workout** (clone a past session → new session, "Redo of …") | `handleRedoWorkout` l.871 | **nowhere else in the app** | **MOVE** — the one genuinely unique, valuable capability |

## Tab 4 — "exercises"

| Capability | Hub ref | Covered by | Verdict |
|---|---|---|---|
| Exercise library | `ExercisesTab = dynamic(() => import('../exercises/page'))` | `/dashboard/exercises` (literally the same component) | **DUP** (100%) |

---

## Bottom line

- **~95% of the 3,075-line hub is duplicate** of `/log` + the dedicated
  routes. The exercises tab is literally the exercises page imported as a tab.
- **Exactly one capability has no home elsewhere and is worth keeping: Redo
  workout.** Its natural home is `/dashboard/history` (it's a per-past-workout
  action).
- **One convenience is semi-unique but trivially relocatable:** inline editing
  of an active mesocycle's preferred training days (`WorkoutDaySelector`) — the
  component is already used by `mesocycle/new`; dropping it onto
  `/dashboard/mesocycle` is a small add.
- **One thing is unique but not worth keeping:** the card reorder/hide
  personalization.
- **The duplicate direct `workout_sessions` INSERT (l.931/1009) is the actual
  risk** the audit cared about — a second session-creation path that doesn't go
  through the safe `getOrCreateTodaySession` flow `/log` uses.

## Proposed option-2 execution (for review — not yet done)

1. **Relocate Redo** → `/dashboard/history` (per-row "Redo" action reusing
   `handleRedoWorkout`'s logic). *This is the only real feature migration.*
2. **(Optional) Relocate inline day-editing** → `/dashboard/mesocycle` active
   view (reuse `WorkoutDaySelector`).
3. **Retire the hub body:** repoint the "Planned sessions & recovery" link
   (`/log` l.643). Two sub-options — pick one:
   - **3a (leanest):** redirect `/dashboard/workout` → `/dashboard/log`; the
     old page becomes a redirect stub. Kills the duplicate INSERT paths
     outright.
   - **3b (keeps a landing):** reduce the page to a thin read-only "planned +
     recovery" view (planned list + `MuscleRecoveryCard`), with the single
     "start" routing through `getOrCreateTodaySession` — one creation path
     app-wide.
4. **Leave sub-routes untouched:** `/workout/new`, `/workout/quick`,
   `/workout/[id]` are the active-session screens every other page links to —
   not part of this change.

**Recommendation:** steps 1 + 3a. It removes the duplicate session-creation
surface entirely, preserves the only unique feature (Redo) in a better home,
and touches nothing that other pages depend on. Step 2 is a nice-to-have that
can be its own follow-up.

**Risk / coordination note:** this area is under active edits by a parallel
session (it just demoted the hub and added commit `97231fa` nearby) — rebase on
their latest before starting.

---

## CORRECTION + execution outcome (found while implementing)

Two things the initial diff got wrong, discovered by reading the target
routes more carefully during implementation:

1. **Redo is NOT unique.** `/dashboard/history` already has
   `handleRepeatWorkout` (l.379), wired to visible "Repeat" buttons in both the
   list (l.1072) and calendar-day (l.1366) views. It clones a past workout into
   a new session — same capability as the hub's Redo, and arguably better (it
   uses `quickWeightEstimate` with the past best-set E1RM instead of just
   copying the last-set weight). **No port needed.**

2. **Mesocycle duration-edit + regenerate already exists** on
   `/dashboard/mesocycle` (`handleUpdateSessionDuration`, l.53). Its version
   handles session *duration* only, not *preferred training days*.

So after correction, the **only** capability with no home elsewhere is
**editing an active mesocycle's preferred training days mid-cycle** (the hub's
`WorkoutDaySelector` + the "Update & Regenerate" path that also
deletes/re-inserts future planned sessions on the new days).

### What shipped in this change
- `/dashboard/workout` (the 3,075-line hub) → **replaced with a redirect to
  `/dashboard/log`**. Removes the duplicate `workout_sessions` INSERT paths;
  `getOrCreateTodaySession` is now the single ad-hoc creation flow.
- Repointed the two inbound links to the bare hub: `/log`'s "Planned sessions &
  recovery" → `/dashboard/mesocycle`; `/volume/review`'s "Start Training" →
  `/dashboard/log`.
- Active-session sub-routes (`/workout/new`, `/workout/quick`, `/workout/[id]`)
  untouched.

### Deliberately deferred (spun off as its own task)
Relocating **preferred-training-days editing** into `/dashboard/mesocycle`'s
existing edit panel. Deferred out of this change because its regeneration path
mutates data (deletes + re-inserts future planned sessions) and can't be
verified without an active mesocycle with planned sessions on the test account
— it deserves its own change with a proper test, not a rushed rider here. Until
it lands, changing training days mid-cycle requires rebuilding the mesocycle
(via `/dashboard/mesocycle/new`); duration editing already works on
`/dashboard/mesocycle`.

### Verification
- `tsc --noEmit` clean (after clearing a stale `.next/types` cache left by the
  other branch's layouts).
- Browser: `/dashboard/workout` → lands on `/dashboard/log`; launcher renders,
  no console errors; "Planned sessions & recovery" link now → `/dashboard/mesocycle`.
