-- ============================================
-- MACHINE STARTING WEIGHT
-- Allows users to save a starting weight for exercises
-- (e.g., machines that have a base weight)
-- This is used in the plate calculator
-- ============================================

-- Create user_exercise_settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_exercise_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  
  -- Machine starting weight in kg (for plate calculator)
  machine_starting_weight_kg NUMERIC(6,2),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- One setting per user per exercise
  CONSTRAINT unique_user_exercise_setting UNIQUE (user_id, exercise_id)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_user_exercise_settings_user_exercise 
  ON user_exercise_settings(user_id, exercise_id);

-- Enable Row Level Security
ALTER TABLE user_exercise_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own exercise settings" ON user_exercise_settings;
CREATE POLICY "Users can view own exercise settings"
  ON user_exercise_settings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own exercise settings" ON user_exercise_settings;
CREATE POLICY "Users can insert own exercise settings"
  ON user_exercise_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own exercise settings" ON user_exercise_settings;
CREATE POLICY "Users can update own exercise settings"
  ON user_exercise_settings FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own exercise settings" ON user_exercise_settings;
CREATE POLICY "Users can delete own exercise settings"
  ON user_exercise_settings FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_user_exercise_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_exercise_settings_updated_at_trigger ON user_exercise_settings;
CREATE TRIGGER update_user_exercise_settings_updated_at_trigger
  BEFORE UPDATE ON user_exercise_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_exercise_settings_updated_at();

