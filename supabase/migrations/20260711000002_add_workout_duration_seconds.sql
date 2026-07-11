-- Persist the actual active workout duration, snapshotted once at finish.
--
-- Before this, the finish/summary screen and history derived duration from
-- (completed_at - started_at), i.e. full wall-clock INCLUDING paused time,
-- and recomputed it live on every render (a ticking summary). The in-workout
-- timer, by contrast, excludes paused time — two different numbers for the
-- same workout. We now snapshot the timer's elapsed value (pauses excluded)
-- into this column at finish so every surface reads one frozen source.
--
-- Nullable + no default on purpose: legacy sessions completed before this
-- column existed have no snapshot, so readers fall back to
-- (completed_at - started_at) for those rows only.
ALTER TABLE workout_sessions
ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

COMMENT ON COLUMN workout_sessions.duration_seconds IS
  'Active workout duration in seconds, snapshotted at finish (excludes paused time). Null for legacy sessions; fall back to completed_at - started_at.';
