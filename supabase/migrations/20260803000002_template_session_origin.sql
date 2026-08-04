-- Ticket: starting a workout from a saved template.
--
-- A template start is its own launcher: the exercise list is user-authored and
-- fixed ahead of time, so it is neither a blank ad-hoc session ('empty'), a
-- clone of a past session ('repeat'), nor a mesocycle slot ('scheduled').
-- Widen the origin check constraint so those sessions can say what they are.
--
--   template     started from a saved workout template
--
-- Ship-before-migrate: insertWorkoutSessions retries with origin 'empty' when
-- this constraint rejects 'template', so template starts keep working until
-- this migration is applied.

ALTER TABLE workout_sessions
  DROP CONSTRAINT IF EXISTS workout_sessions_origin_check;

ALTER TABLE workout_sessions
  ADD CONSTRAINT workout_sessions_origin_check
  CHECK (origin IS NULL OR origin IN ('scheduled', 'empty', 'ai_suggested', 'repeat', 'template'));

COMMENT ON COLUMN workout_sessions.origin IS
  'How the session was started: scheduled | empty | ai_suggested | repeat | template. NULL for pre-feature rows and imports.';
