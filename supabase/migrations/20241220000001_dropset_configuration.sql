-- ============================================
-- DROPSET CONFIGURATION ON EXERCISE BLOCKS
-- ============================================
-- Adds dropsets_per_set to configure immediate dropset transitions
-- When > 0, the dropset prompt appears immediately after main set completion
-- (no rest timer until all drops are complete)

-- Add dropsets_per_set column to exercise_blocks
ALTER TABLE exercise_blocks ADD COLUMN IF NOT EXISTS dropsets_per_set SMALLINT NOT NULL DEFAULT 0;

-- Add drop_percentage column for configurable weight reduction
-- Default 25% reduction (0.75 = 75% of previous weight)
ALTER TABLE exercise_blocks ADD COLUMN IF NOT EXISTS drop_percentage DECIMAL(3,2) NOT NULL DEFAULT 0.25;

-- Add comments for documentation
COMMENT ON COLUMN exercise_blocks.dropsets_per_set IS 'Number of drops to perform after each main set (0 = no dropsets, 1 = single drop, 2 = double drop, etc.)';
COMMENT ON COLUMN exercise_blocks.drop_percentage IS 'Percentage of weight to reduce for each drop (e.g., 0.25 = 25% reduction, so 75% of previous weight)';

-- Add constraint to ensure valid values
ALTER TABLE exercise_blocks ADD CONSTRAINT check_dropsets_per_set
  CHECK (dropsets_per_set >= 0 AND dropsets_per_set <= 5);

ALTER TABLE exercise_blocks ADD CONSTRAINT check_drop_percentage
  CHECK (drop_percentage >= 0.10 AND drop_percentage <= 0.50);
