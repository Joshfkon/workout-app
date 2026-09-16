-- ============================================
-- SESSION DURATION MODEL SECONDS
-- ============================================
-- Persist the duration model's figure for the span duration_seconds measured
-- (services/workoutDurationEstimator, completedModelSeconds at finish).
-- The per-session pair (observed duration, modelled duration) lets future
-- sessions seed their initial time estimate with the user's demonstrated
-- observed/model pace instead of the textbook constants.

ALTER TABLE workout_sessions
ADD COLUMN IF NOT EXISTS duration_model_seconds INTEGER;

COMMENT ON COLUMN workout_sessions.duration_model_seconds IS
  'Duration model''s cost of the span duration_seconds measured, snapshotted at finish. Ratio duration_seconds / duration_model_seconds is the session''s observed pace, used to seed future estimates.';
