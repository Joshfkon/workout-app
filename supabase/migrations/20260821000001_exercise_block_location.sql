-- ============================================
-- PER-EXERCISE LOCATION OVERRIDE
-- ============================================
-- 20260711000002_location_scoped_calibration gave a SESSION a location and
-- stamped it on every set logged in that session. That resolves "which gym",
-- but not "which machine": the same gym can hold two hip adduction machines
-- whose stacks are nowhere near each other, and a user who trains one exercise
-- on the annex machine still has the rest of the session at the main floor.
--
-- exercise_blocks.location_id is that override. NULL — the overwhelmingly
-- common case — means "wherever the session is", so nothing changes for
-- anybody who never touches the control. When set, it wins for this block:
-- its sets are stamped with it, and the block's progression history is read
-- from that location's track instead of the session's.
--
-- Strictly additive and nullable, matching the location-calibration migration
-- it extends: code shipped before this runs is unaffected.

ALTER TABLE exercise_blocks
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES gym_locations(id) ON DELETE SET NULL;

-- Overrides are read per session (load) and written per block, so the session
-- index already covers the read path; this one keeps the ON DELETE SET NULL
-- cascade from scanning the table when a location is deleted.
CREATE INDEX IF NOT EXISTS idx_exercise_blocks_location
  ON exercise_blocks(location_id) WHERE location_id IS NOT NULL;

COMMENT ON COLUMN exercise_blocks.location_id IS
  'Per-exercise override of the session location (null = inherit the session''s); the calibration key for this block''s sets';
