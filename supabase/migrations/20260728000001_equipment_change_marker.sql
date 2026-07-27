-- ============================================
-- EQUIPMENT-CHANGE MARKER (trend calibration segments)
-- ============================================
-- Adds exercise_blocks.equipment_changed: the user explicitly marks a
-- session's work on an exercise as done on DIFFERENT equipment (another
-- machine, different stack labeling, new gym). The flag is a permanent
-- segment boundary for e1RM trend fitting (services/shared/trend
-- knownDiscontinuities): points before the boundary never mix into the
-- fitted slope, PR baselines, or plateau verdicts for the current segment.
--
-- The robust trend module also detects unmarked level shifts heuristically
-- (a >25% single-session change that persists), but an explicit user marker
-- is strictly more reliable, so it is honored unconditionally.

ALTER TABLE exercise_blocks
  ADD COLUMN IF NOT EXISTS equipment_changed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN exercise_blocks.equipment_changed IS
  'User marked this session''s equipment as different for this exercise — a '
  'permanent calibration-segment boundary for e1RM trend fitting. Read by '
  'liftTrends / plateauDetector via services/shared/trend knownDiscontinuities.';
