# P1-3 recalc banner — verification status

## What's verified now (column absent)

- **Pure logic:** `isTargetStale`, `findStaleTargetBlocks`, `computeRecalcChanges`
  — 11 unit tests (app/(dashboard)/dashboard/workout/_lib/__tests__/staleTargets.test.ts).
- **No regression:** past-set editing still lands (weight/reps update succeeds;
  the best-effort `edited_at` stamp fails silently) — re-ran the P1-3 edit
  verification, DB updated correctly.
- **Safely dormant:** started a real mesocycle (planned-target) session — the
  banner stays hidden, the detection query's unknown-column error is swallowed,
  no error surfaces to the user, workout page fully functional.
- **Component:** `RecalcTargetsBanner` renders the warning + Recalculate button
  and a confirm dialog listing every old → new change.

## What's deferred until the migration is applied

The happy path (banner APPEARS on a session with genuinely since-edited
history, and Recalculate updates `target_weight_kg`) cannot be exercised
because `set_logs.edited_at` doesn't exist yet and I have no DDL access to add
it. Apply the migration, then this path activates.

## Apply the migration

```
supabase db push
```
(or run `supabase/migrations/20260703000001_set_logs_edited_at.sql` in the
Supabase SQL editor)

## Post-migration happy-path check (manual, ~2 min)

1. Complete a workout containing e.g. Bench Press.
2. In History, edit one of that Bench set's weights (this now stamps
   `edited_at`).
3. Start a **planned** session (mesocycle) that also programs Bench Press.
4. Expect the banner: "Targets use data you've edited — N exercises…".
5. Tap **Recalculate** → confirm dialog lists Bench's old → new target →
   **Update** → the block's `target_weight_kg` is rewritten from the corrected
   history; the banner clears.

DB spot-check that the stamp is working:
```
select id, edited_at from set_logs where edited_at is not null order by edited_at desc limit 5;
```
