-- P1-3 recalc banner, detection A (signed off): stamp when a logged set is
-- edited after the fact, so planned sessions can detect targets that derive
-- from since-edited history.
--
-- Non-destructive: nullable column, no backfill, RLS unchanged (set_logs is
-- owned via exercise_block_id -> workout_session -> user). Existing rows keep
-- edited_at = NULL (never edited). Application code stamps it best-effort and
-- degrades to a no-op if this migration has not been applied yet.
--
-- NOT YET APPLIED to the remote project — flagged for review. Apply with
--   supabase db push
-- (or run the statement below in the Supabase SQL editor).

ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS edited_at timestamptz;

COMMENT ON COLUMN set_logs.edited_at IS
  'Set when a logged set is retroactively edited (weight/reps). NULL = never edited. Used by the planned-session "targets based on edited data" banner (P1-3).';
