# Replace-Exercise picker filters — audit & fix

## What was reported

The Replace ("Swap Exercise → Replace Machine Back Extension") picker appeared
to apply no filters: with query "Back" and the Back chip selected, the list
showed Cable Crunch (Abs), Hip Adduction Machine (Adductors) ×2, Glute Drive
(Glutes), Kelso Shrug (Traps). Neither input seemed to affect the list, and
Hip Adduction Machine rendered twice.

## 1. Where the picker's list comes from (the wiring)

The reported modal is the swap modal inside `components/workout/ExerciseCard.tsx`
(the only one with `Similar (n)` / `Browse All` tabs + muscle chips). Its
`availableExercises` prop is built in the workout page
(`app/(dashboard)/dashboard/workout/[id]/page.tsx`, ExerciseCard render):

```
availableExercises={blocks.map(b => b.exercise).concat(
  availableExercises.map(ex => ({ ...mapped from library... }))
)}
```

i.e. **the current workout's block exercises concatenated with the full
library, with no de-dupe**. An exercise that is both in the workout and the
library therefore appears twice. That same un-deduped array feeds both tabs.

Reproduced live at 390px (Playwright, mocked Supabase) against the exact
reported data — the default Browse view returned:
`Cable Crunch, Glute Drive, Hip Adduction Machine, Hip Adduction Machine,
Kelso Shrug` — matching the report, duplicate included.

Nuance worth recording: on `main` the Browse tab's query and chip *do* filter
correctly in isolation (`query="back"` → 0 rows for that data; the chip hides
off-target muscles). What reads as "no filters" is that (a) the modal opens on
the **Similar** tab, which has **no** search box or chips and lists
similarity-scored suggestions (often off-target for a hip-hinge like Back
Extension), and (b) the default Browse view (before typing) shows the whole
un-deduped list. The confirmed, reproducible defect is the **duplicate row**.

## 2. Library screen & add-exercise picker — same defect?

No. They do **not** share the replace picker's code path and don't have the
concat/duplicate bug (each fetches the library once):

- **Library** (`app/(dashboard)/dashboard/exercises/page.tsx`) already composed
  name + group-aware muscle + equipment filters correctly.
- **Add-exercise** (`.../workout/[id]/_components/AddExercisePicker.tsx`)
  composed an (exact) muscle chip with a name-normalized search.

They worked, but each hand-rolled its own filter — which is why behavior drifted.

## 3. The duplicate: data or render?

**Render/wiring**, not duplicate seed/custom data. There is one
`Hip Adduction Machine` record; it appears twice only because the page
concatenates `blocks[].exercise` (the copy already in the workout) with the
library copy of the **same id**. Same id ⇒ duplicate row **and** duplicate
React `key`. No records were deleted.

## 4. Is the "Similar (n)" tab computed from unfiltered data?

Yes. `similarExercises` = `findSimilarExercises(exercise, equipmentFeasible)` —
similarity-scored only; it never consumed the query or chip (there are no such
controls on that tab). It also inherited the duplicate because it was built
from the same un-deduped `availableExercises`.

## The fix

A single shared, pure filtering layer — `services/exerciseFilter.ts` — now used
by all three surfaces:

- `dedupeExercisesById` — collapse duplicate ids (fixes the double row + keys).
- `filterExercises({ query, muscleGroup, equipment })` — de-dupes then composes:
  - **query** matches name / muscles (raw + formatted) / equipment,
    case-insensitive;
  - **muscleGroup** chip via `muscleMatchesGroup` (coarse ↔ specific aware);
  - **equipment** exact-token;
  - all AND together; **no matches ⇒ empty array** (callers show a real empty
    state, never the default list).

Wired in:

- **Replace** (`ExerciseCard.tsx`): both tabs now build from a de-duped
  `swapCandidates` pool; Browse routes through `filterExercises`; a
  `swap-browse-empty` empty state; stable unique row keys.
- **Library** (`exercises/page.tsx`): filter now uses the shared helpers.
- **Add-exercise** (`AddExercisePicker.tsx`): de-duped pool, group-aware chip,
  search extended with the shared query matcher (keeps its plural/hyphen name
  normalization).

## Tests (Playwright, 390px, `playwright` library — see `ux-audit/verify/`)

- `replace-exercise-filter.mjs` (14 checks, from an active workout): Back chip
  alone → only Back exercises; query "back" alone → Back Extension yes / Cable
  Crunch no; both compose; **no duplicate rows** in the unfiltered list; proper
  empty state; replacing still works end-to-end via the existing action (no
  session-store changes).
- `library-filter.mjs` (7 checks) and `add-exercise-filter.mjs` (6 checks): the
  same chip / query / compose / no-duplicate assertions on the other two
  surfaces.

Plus `services/__tests__/exerciseFilter.test.ts` (17 unit checks).
