-- ============================================
-- SUPERSETS AND DROPSETS SUPPORT
-- ============================================

-- Add set_type enum for different training techniques
CREATE TYPE set_type AS ENUM ('normal', 'warmup', 'dropset', 'myorep', 'rest_pause');

-- Add set_type column to set_logs
ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS set_type set_type NOT NULL DEFAULT 'normal';

-- Add parent_set_id for linking dropsets to their parent set
-- (A dropset is always attached to a previous set)
ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS parent_set_id UUID REFERENCES set_logs(id) ON DELETE CASCADE;

-- Update is_warmup to sync with set_type
-- (Keep is_warmup for backward compatibility, but set_type takes precedence)
COMMENT ON COLUMN set_logs.is_warmup IS 'Deprecated: Use set_type = warmup instead. Kept for backward compatibility.';

-- Create index for parent_set lookups (for dropsets)
CREATE INDEX IF NOT EXISTS idx_set_logs_parent ON set_logs(parent_set_id);

-- ============================================
-- SUPERSET HELPER VIEW
-- ============================================

-- View to easily query exercises in their superset groups
CREATE OR REPLACE VIEW superset_exercises AS
SELECT 
  eb.workout_session_id,
  eb.superset_group_id,
  eb.superset_order,
  eb.id as exercise_block_id,
  eb.exercise_id,
  eb."order" as block_order,
  e.name as exercise_name,
  e.primary_muscle
FROM exercise_blocks eb
JOIN exercises e ON e.id = eb.exercise_id
WHERE eb.superset_group_id IS NOT NULL
ORDER BY eb.workout_session_id, eb.superset_group_id, eb.superset_order;

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON COLUMN set_logs.set_type IS 'Type of set: normal (standard working set), warmup, dropset (reduced weight continuation), myorep (cluster/breathing sets), rest_pause (brief rest mid-set)';
COMMENT ON COLUMN set_logs.parent_set_id IS 'For dropsets: references the parent set this dropset follows. NULL for non-dropsets.';
COMMENT ON COLUMN exercise_blocks.superset_group_id IS 'UUID grouping exercises that are performed as a superset. Exercises with the same superset_group_id alternate sets.';
COMMENT ON COLUMN exercise_blocks.superset_order IS 'Order within the superset (1 = first exercise, 2 = second, etc.)';

