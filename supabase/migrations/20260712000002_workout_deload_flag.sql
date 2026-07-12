-- Deload flag on workout sessions (data hygiene).
--
-- A workout can be marked as a deload session three ways: automatically when
-- it is generated during a programmed deload week, manually via a toggle on
-- the finish/summary screen, or retroactively on a past workout in history.
--
-- Deload-flagged sessions are STILL real training (they count toward weekly
-- volume, readiness recovery, history, streaks and shares) but are EXCLUDED
-- from signals that assume normal progression: next-session weight
-- suggestions, e1RM trends / PR detection, effort-creep & stagnation
-- baselines, adaptive MEV/MRV learning, and they COUNT as deloads for the
-- deload detector's clock (resetting accumulation).
--
-- Additive + NOT NULL DEFAULT false so every existing session reads as a
-- normal (non-deload) session with no backfill.
ALTER TABLE workout_sessions
ADD COLUMN IF NOT EXISTS is_deload BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN workout_sessions.is_deload IS
  'True when this session was a deload (light week). Still counts as real training/volume, but is excluded from progression suggestions, e1RM/PR trends, stagnation baselines and adaptive volume learning, and counts as a deload for the deload-detector clock.';

-- Mirror the flag onto the derived per-exercise performance snapshots so the
-- e1RM-history reads (useExerciseHistory) can cheaply exclude deload sessions
-- without a join back to workout_sessions.
ALTER TABLE exercise_performance_snapshots
ADD COLUMN IF NOT EXISTS is_deload BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN exercise_performance_snapshots.is_deload IS
  'True when the source session was a deload; excluded from e1RM trend / PR reads.';
