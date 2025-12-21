-- ============================================
-- USER EXERCISE PREFERENCES
-- ============================================
-- Controls which exercises appear in suggestions and which are hidden from the exercise library.
--
-- Status behaviors:
-- 'active': Normal behavior, shown everywhere, suggested freely
-- 'do_not_suggest': Shown in exercise list, can be manually added, never auto-suggested
-- 'archived': Hidden from list, only appears in search, never suggested

-- Create the user_exercise_preferences table
CREATE TABLE IF NOT EXISTS user_exercise_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  exercise_id UUID REFERENCES exercises(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'do_not_suggest', 'archived')),
  reason TEXT CHECK (reason IS NULL OR reason IN ('no_equipment', 'causes_pain', 'dislike', 'other')),
  reason_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, exercise_id)
);

-- Index for fetching all preferences for a user
CREATE INDEX IF NOT EXISTS idx_user_exercise_prefs_user
  ON user_exercise_preferences(user_id);

-- Index for filtering by status (for getting active/archived lists)
CREATE INDEX IF NOT EXISTS idx_user_exercise_prefs_status
  ON user_exercise_preferences(user_id, status);

-- Index for looking up a specific exercise preference
CREATE INDEX IF NOT EXISTS idx_user_exercise_prefs_exercise
  ON user_exercise_preferences(user_id, exercise_id);

-- Enable Row Level Security
ALTER TABLE user_exercise_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own preferences
CREATE POLICY "Users can view own exercise preferences"
  ON user_exercise_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own preferences
CREATE POLICY "Users can insert own exercise preferences"
  ON user_exercise_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can update their own preferences
CREATE POLICY "Users can update own exercise preferences"
  ON user_exercise_preferences
  FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policy: Users can delete their own preferences
CREATE POLICY "Users can delete own exercise preferences"
  ON user_exercise_preferences
  FOR DELETE
  USING (auth.uid() = user_id);

-- Function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_exercise_preference_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on row update
DROP TRIGGER IF EXISTS update_exercise_preference_timestamp ON user_exercise_preferences;
CREATE TRIGGER update_exercise_preference_timestamp
  BEFORE UPDATE ON user_exercise_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_exercise_preference_updated_at();

-- Add comments for documentation
COMMENT ON TABLE user_exercise_preferences IS 'Stores user preferences for exercise visibility (active, do_not_suggest, archived)';
COMMENT ON COLUMN user_exercise_preferences.status IS 'active = normal, do_not_suggest = visible but not auto-suggested, archived = hidden except in search';
COMMENT ON COLUMN user_exercise_preferences.reason IS 'Optional reason: no_equipment, causes_pain, dislike, or other';
COMMENT ON COLUMN user_exercise_preferences.reason_note IS 'Custom note when reason is other';
