-- ============================================
-- LOCATION-SCOPED EXERCISE CALIBRATION
-- ============================================
-- Machine load is implement-specific: 100 lb on one gym's plate-loaded seated
-- calf raise is not 100 lb on another gym's selectorized version. Instead of
-- forcing users to duplicate exercises per gym, we keep ONE canonical exercise
-- and scope its progression history by the location where the implement matters.
--
-- This migration is strictly ADDITIVE — no column is reshaped or dropped, and
-- every add is IF NOT EXISTS / nullable, so code shipped before it runs is
-- unaffected (null location_id = unknown/legacy).
--
--   * workout_sessions.location_id — the gym a session happened at. Persisted
--     so the session "carries" its location (the pre-workout chip's selection,
--     or the silently-defaulted last-used location for a blank workout).
--   * set_logs.location_id — stamped at log time from the session's location.
--     This is the calibration key: local-scope exercises read progression
--     history filtered to the current location's stamped sets.
--   * exercises.progression_scope_override — per-exercise override of the
--     equipment-class-derived scope ('global' = location-independent history,
--     'local' = per-location history). NULL = derive from equipment class.
--   * exercises.deleted_at — soft-delete marker so mergeAsLocationVariant can
--     collapse an implement-variant duplicate ("Seated Calf Raise (ameri fit)")
--     into the canonical exercise without hard-deleting rows.

-- --------------------------------------------
-- Session + set location stamping
-- --------------------------------------------
ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES gym_locations(id) ON DELETE SET NULL;

ALTER TABLE set_logs
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES gym_locations(id) ON DELETE SET NULL;

-- The suggestion engine reads a local-scope exercise's history filtered by
-- (exercise, location); index the location key it filters on.
CREATE INDEX IF NOT EXISTS idx_set_logs_location ON set_logs(location_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_location ON workout_sessions(location_id);

-- --------------------------------------------
-- Progression scope on exercises
-- --------------------------------------------
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS progression_scope_override TEXT
    CHECK (progression_scope_override IN ('global', 'local'));

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Soft-deleted exercises are filtered out of every library/picker query;
-- index so those `deleted_at IS NULL` filters stay cheap.
CREATE INDEX IF NOT EXISTS idx_exercises_not_deleted ON exercises(id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN workout_sessions.location_id IS
  'Training location this session happened at; drives location-scoped calibration';
COMMENT ON COLUMN set_logs.location_id IS
  'Location stamped at log time; the calibration key for local-scope exercises (null = legacy/unknown)';
COMMENT ON COLUMN exercises.progression_scope_override IS
  'Per-exercise override of equipment-derived progression scope: global | local (null = derive)';
COMMENT ON COLUMN exercises.deleted_at IS
  'Soft-delete marker; set by mergeAsLocationVariant when collapsing an implement-variant duplicate';
