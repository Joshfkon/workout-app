-- Per-exercise subjective feedback (RP-style stimulus-quality inputs).
-- Captured by one-tap chip rows on the exercise card's completed state:
--   pump:     1 low, 2 good, 3 great  (0 reserved for "none")
--   workload: 0 easy, 1 right, 2 pushed it, 3 too much
-- Rolled up per primary muscle into session_muscle_feedback at finish, which
-- feeds the existing weeklyProgressionEngine / adaptive-volume learning path.
ALTER TABLE exercise_blocks
  ADD COLUMN IF NOT EXISTS pump SMALLINT CHECK (pump >= 0 AND pump <= 3),
  ADD COLUMN IF NOT EXISTS workload SMALLINT CHECK (workload >= 0 AND workload <= 3);

COMMENT ON COLUMN exercise_blocks.pump IS
  'Per-exercise pump chip (1 low, 2 good, 3 great); null = not rated';
COMMENT ON COLUMN exercise_blocks.workload IS
  'Per-exercise workload chip (0 easy, 1 right, 3 too much); null = not rated';
