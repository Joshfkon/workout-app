-- Consolidate exercises table to be single source of truth
-- Add missing columns for pattern, equipment, difficulty, fatigue, and custom exercise support

-- Add pattern column (derived from movement_pattern but more specific)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS pattern TEXT;

-- Add single equipment column (first item from equipment_required or default)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS equipment TEXT DEFAULT 'barbell';

-- Add difficulty level
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT 'intermediate' 
  CHECK (difficulty IN ('beginner', 'intermediate', 'advanced'));

-- Add fatigue rating (1-3)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS fatigue_rating INTEGER DEFAULT 2 
  CHECK (fatigue_rating >= 1 AND fatigue_rating <= 3);

-- Add custom exercise support
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT FALSE;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS notes TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_exercises_primary_muscle ON exercises(primary_muscle);
CREATE INDEX IF NOT EXISTS idx_exercises_pattern ON exercises(pattern);
CREATE INDEX IF NOT EXISTS idx_exercises_equipment ON exercises(equipment);
CREATE INDEX IF NOT EXISTS idx_exercises_is_custom ON exercises(is_custom);
CREATE INDEX IF NOT EXISTS idx_exercises_created_by ON exercises(created_by) WHERE created_by IS NOT NULL;

-- Update existing exercises to derive pattern from movement_pattern
UPDATE exercises SET pattern = movement_pattern WHERE pattern IS NULL;

-- Update equipment from equipment_required array
UPDATE exercises SET equipment = equipment_required[1] 
WHERE equipment IS NULL AND array_length(equipment_required, 1) > 0;

-- RLS policies for custom exercises
DROP POLICY IF EXISTS "Anyone can view non-custom exercises" ON exercises;
DROP POLICY IF EXISTS "Users can view their custom exercises" ON exercises;
DROP POLICY IF EXISTS "Users can create custom exercises" ON exercises;
DROP POLICY IF EXISTS "Users can update their custom exercises" ON exercises;
DROP POLICY IF EXISTS "Users can delete their custom exercises" ON exercises;

CREATE POLICY "Anyone can view non-custom exercises" ON exercises
  FOR SELECT USING (is_custom = FALSE OR is_custom IS NULL);

CREATE POLICY "Users can view their custom exercises" ON exercises
  FOR SELECT USING (is_custom = TRUE AND created_by = auth.uid());

CREATE POLICY "Users can create custom exercises" ON exercises
  FOR INSERT WITH CHECK (is_custom = TRUE AND created_by = auth.uid());

CREATE POLICY "Users can update their custom exercises" ON exercises
  FOR UPDATE USING (is_custom = TRUE AND created_by = auth.uid());

CREATE POLICY "Users can delete their custom exercises" ON exercises
  FOR DELETE USING (is_custom = TRUE AND created_by = auth.uid());

