# Supersets — design note (P1-5, second half)

**Status: proposal for review — no schema or code changes made.**

## What already exists (correction to the audit)

The audit's "no superset support in schema" was wrong in an interesting way:

- `types/schema.ts` — `ExerciseBlock` already has `supersetGroupId: string | null` and
  `supersetOrder: number | null` (lines ~536-539).
- The workout page already *renders* superset grouping: blocks with a shared
  `supersetGroupId` get a cyan left border, and `isSupersetWithNext` is computed
  (workout/[id]/page.tsx ~3685-3686).
- Verified deeper: **the DB columns already exist too** —
  `supabase/migrations/20241209000001_initial_schema.sql:161-162` has
  `superset_group_id UUID` and `superset_order INTEGER` on `exercise_blocks`,
  with an index at line 183, and `_lib/sessionMapping.ts:198` maps them into the
  domain type. The entire persistence layer for supersets has been sitting
  unused since day one.

## Schema migration

**None needed.** Columns, index, and row mapping all exist. What's missing is
purely: (a) UI to create/remove a pairing, (b) grouped set-flow, (c) rest-timer
semantics. This drops the risk profile from "schema change" to "feature UI".

## Pairing UX (Hevy-style, fits existing components)

1. **Create:** each exercise card's ⋮ menu gains "Superset with next" (and
   "Remove from superset" when grouped). Writing = set the same
   `superset_group_id` uuid on both blocks, `superset_order` 0/1, and make their
   `order` contiguous. Reuse the existing cyan-border rendering.
2. **Set flow:** logging a set on block A of a group advances `currentBlockIndex`
   to its partner B instead of staying on A (round-robin within the group until
   all sets done). This is a small change in `handleSetComplete`'s post-log
   navigation.
3. **Rest timer:** NO timer between paired sets (A→B is back-to-back);
   auto-start the timer only after the LAST exercise of the group in a round.
   Concretely: in `handleSetComplete`, `if (nextBlockInGroup) skip restTimer.start()`.
   The sticky bar (P0-5) then reads "next · <partner exercise>" — its `nextLabel`
   already comes from `currentBlock`.
4. **Volume/analytics:** no changes — sets stay attached to their own exercise
   block; volumeTracker semantics are unaffected.
5. **Offline outbox:** unaffected — set rows don't reference the group.

## Sizing

- Migration + mapping already half-exists: ~0.5 day
- Pairing UI + grouped set-flow + rest semantics: ~1.5 days
- Program-generation awareness (mesocycleBuilder emitting antagonist pairs):
  separate, larger; not needed for user-created supersets.

## Column-by-column validation of "no migration needed" (review response)

For each pre-existing column I propose reusing: its definition, what the
initial schema intended, and whether my shared-rest design fits that meaning
exactly or reinterprets it.

### `superset_group_id UUID` (nullable, no FK, no default)
- **Schema intent:** `types/schema.ts:535` comments it verbatim — "For
  superset grouping - exercises with same groupId are supersetted." The
  initial migration added it alongside `superset_order` and an index; it has
  been read-mapped (`sessionMapping.ts:198`) but **never written** by any code
  path (grep for writes: none).
- **My use:** identical — one uuid shared by the blocks in a group.
- **Verdict: fits exactly.** No reinterpretation.

### `superset_order INTEGER` (nullable, no CHECK)
- **Schema intent:** `types/schema.ts:538` — "Order within the superset
  group."
- **My use:** 0-based position within the group (0,1 for a pair; 0..n-1 for a
  circuit).
- **Verdict: fits exactly.**

### `target_rest_seconds INTEGER` (per block; the shared-rest question)
- **Schema intent:** per-block "recommended rest between sets," 0–600, default
  180.
- **My use:** for a superset, skip rest after a block that has a partner still
  to come in the round; rest only after the group's **last** block, using that
  last block's own `target_rest_seconds`.
- **Verdict: fits WITHOUT reinterpreting the column.** The column still means
  "rest after this block's set"; supersets only add an app-layer rule about
  *which* block's rest applies (skip non-terminal members). No stored value
  changes meaning, so this is application logic, not a migration. This also
  resolves open question 3 below: use the last block's value — it maps 1:1 to
  the existing column with no cross-block computation.

### One honest correction to my earlier claim
My first draft proposed a composite partial index
`(workout_session_id, superset_group_id) WHERE superset_group_id IS NOT NULL`.
That index does **not** exist — the schema has a single-column
`idx_exercise_blocks_superset ON (superset_group_id)` (line 183). The existing
index is adequate for "find blocks in group X," so **still no migration
needed**; the composite was an unneeded optimization, not a requirement. I was
wrong to imply the composite existed.

### Net verdict
All three reused columns fit my design **exactly**; the index already exists
(single-column, sufficient); shared-rest is app logic over the unchanged
per-block column. **"No migration needed" holds** — supersets are a
UI-plus-flow feature, not a schema change. The one caveat is the
`UNIQUE(workout_session_id, "order")` constraint: paired blocks must keep
distinct `"order"` values (they do — a group is adjacent orders sharing a
group id; `superset_order` disambiguates within). No conflict.

## Three product questions — with my recommended answer + tradeoff

Reply with three words (e.g. "pairs, manual, last") and I'll build to it.

1. **Pairs only or N-exercise circuits?** → **Recommend: pairs only (v1).**
   Schema supports N, but pairs cover ~90% of hypertrophy supersetting
   (antagonist/agonist) and the set-flow/UI is far simpler. Tradeoff: giant
   sets / tri-sets wait for v2 (additive, no schema change).

2. **Auto-superset in mesocycle generation, or manual only?** → **Recommend:
   manual only (v1).** Keeps the progression/fatigue engine untouched and the
   feature purely user-driven. Tradeoff: no automatic time-saving pairing on
   short-budget days until the engine learns antagonist pairs (a separate,
   larger project).

3. **Rest after a full superset round: A's, B's, or max?** → **Recommend: the
   last block's `target_rest_seconds` (B's).** Cleanest 1:1 with the existing
   per-block column, no cross-block math, and matches the physical reality
   (you rest after the last movement). Tradeoff: if A prescribes much longer
   rest than B, the round rests on B's shorter value — acceptable, and the
   user can bump it with the existing +15s control.

_(Original questions retained above for context; recommendations supersede.)_
