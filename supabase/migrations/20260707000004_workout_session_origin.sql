-- Ticket: always-available workout starts.
-- Records HOW a session was started so analytics can compare freestyle vs
-- programmed training (sandbagging/RPE-calibration detection treats them the
-- same; this column exists for later analysis, not for filtering logic).
--
--   scheduled    started from the active mesocycle's program slot
--   empty        blank workout, exercises added ad hoc
--   ai_suggested built by the rule-based suggested-workout engine
--   repeat       cloned from a previous session's exercise list
--
-- Nullable: rows created before this migration (and imported history) have an
-- unknown origin. A freestyle session that is later claimed toward a mesocycle
-- slot keeps its original origin — mesocycle_id records the claim.

ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS origin TEXT
  CHECK (origin IS NULL OR origin IN ('scheduled', 'empty', 'ai_suggested', 'repeat'));

COMMENT ON COLUMN workout_sessions.origin IS
  'How the session was started: scheduled | empty | ai_suggested | repeat. NULL for pre-feature rows and imports.';
