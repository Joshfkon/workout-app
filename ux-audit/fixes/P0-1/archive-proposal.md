# Soft-delete for stale-session auto-discard — PREPARED, awaiting `db push`

> **Status update (July 3, second session):** everything below is now
> implemented and committed — migration file
> `supabase/migrations/20260703000002_session_auto_discard.sql`, the
> `discardStaleSession` helper (archive with hard-delete fallback while the
> migration is unapplied, so the app is safe to run either way), the
> workout-page guard for revisiting an archived session's URL, and the
> `SessionState` type updates. 5 new unit tests cover: archive path,
> both pre-migration fallback codes (22P02 enum / 42703 column), no-delete
> on unrelated errors, and fallback-delete failure. **The migration has NOT
> been pushed to the remote** — apply with `npx supabase db push` to switch
> the behavior from delete to archive; until then the code hard-deletes
> exactly as before.

# Original proposal (context)

You asked to change the auto-discard from a hard `DELETE` to an archive so
support can recover a session if a user complains. **This needs a schema
change, so I stopped and am proposing it here.**

## Why it's a schema change

The discard target column is `workout_sessions.state`, a Postgres ENUM:

```sql
-- supabase/migrations/20241209000001_initial_schema.sql:15
CREATE TYPE session_state AS ENUM ('planned', 'in_progress', 'completed', 'skipped');
```

An archived-but-recoverable state has no home in that enum, and reusing an
existing value would lie (`skipped` means "user deliberately skipped a
programmed day"; `completed` would pollute history/analytics). So this is a
genuine enum migration, not a reinterpretation.

## Proposed migration (for your review)

```sql
-- supabase/migrations/20260703000001_session_auto_discard.sql
-- 1) new terminal state
ALTER TYPE session_state ADD VALUE IF NOT EXISTS 'auto_discarded';

-- 2) when it was discarded (for a retention sweep + support lookup)
ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS auto_discarded_at timestamptz;
```

`ADD VALUE` on an enum is non-destructive and fast, but note the Postgres
constraint: **a newly added enum value can't be used in the same transaction
that adds it.** Supabase runs each migration file in its own transaction, so
keep this as a standalone migration and let application code start writing
`'auto_discarded'` only after it has committed.

## Behavior change once applied

In `loadWorkout`'s guard (now `isStaleEmptyAdhocSession`), replace:

```ts
await supabase.from('workout_sessions').delete().eq('id', sessionId);
```

with:

```ts
await supabase.from('workout_sessions')
  .update({ state: 'auto_discarded', auto_discarded_at: new Date().toISOString() })
  .eq('id', sessionId);
```

Then confirm every place that lists sessions filters `auto_discarded` out.
The two that matter both already use explicit `state` allowlists, so they
exclude it for free:
- history: `.in('state', ['completed', 'in_progress'])`
- ad-hoc reuse / Continue card: `.in('state', ['planned', 'in_progress'])`

Analytics/volume filter `state=completed`, also unaffected. A row in
`auto_discarded` therefore vanishes from the UI exactly like a delete, but
survives for support to inspect or flip back to `in_progress`.

Optional follow-up (separate migration): a scheduled job to hard-delete
`auto_discarded` rows older than N days so the table doesn't grow unbounded.

## Discovered while doing the DB sweep (flagging, not fixing)

Cancelling/deleting a workout does **not** clean up its `amrap_calibrations`
rows. The FK `amrap_calibrations.workout_session_id → workout_sessions` is
`ON DELETE SET NULL` (same for `set_log_id → set_logs`), so a cancelled AMRAP
workout leaves calibration rows with both FKs null — detached from all user
data but still in the table. My verification produced 2 such rows (deleted;
see verification-log below). This affects any real user who cancels an
AMRAP-containing workout. Cheapest fix: `handleCancelWorkout` should
`delete from amrap_calibrations where workout_session_id = <id>` before
deleting the session, OR the FK should be `ON DELETE CASCADE`. Out of scope
for this pass — flagging for a future cleanup.
