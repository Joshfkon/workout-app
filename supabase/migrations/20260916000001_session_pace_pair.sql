-- ============================================
-- SESSION PACE PAIR
-- ============================================
-- Persist the session's pace pair, both sides frozen at the LAST logged set:
--   pace_observed_seconds — active time from the first logged set to the last
--     (pauses excluded, same clock as duration_seconds — but WITHOUT the tail
--     between the last set and the Finish tap, so lingering or an abandoned
--     session cannot masquerade as training pace);
--   pace_model_seconds — the duration model's cost of that same span
--     (services/workoutDurationEstimator, completedModelSeconds).
-- The ratio observed/model is the session's demonstrated pace, used to seed
-- future sessions' initial time estimates instead of the textbook constants.

ALTER TABLE workout_sessions
ADD COLUMN IF NOT EXISTS pace_observed_seconds INTEGER;

ALTER TABLE workout_sessions
ADD COLUMN IF NOT EXISTS pace_model_seconds INTEGER;

COMMENT ON COLUMN workout_sessions.pace_observed_seconds IS
  'Active seconds from first to last logged set (pauses and the post-last-set tail excluded), snapshotted at finish. Numerator of the session''s observed pace.';

COMMENT ON COLUMN workout_sessions.pace_model_seconds IS
  'Duration model''s cost of the span pace_observed_seconds measured. Denominator of the session''s observed pace, used to seed future estimates.';
