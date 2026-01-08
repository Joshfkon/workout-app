-- ============================================
-- EXERCISE VARIETY PREFERENCES
-- ============================================
-- Allows users to configure how much exercise variety they want.
-- Higher variety = different exercises suggested across sessions for the same muscle group.
--
-- Variety levels:
-- 'low': Stick to top 2-3 exercises per muscle (consistent, familiar)
-- 'medium': Rotate through top 5-6 exercises (balanced)
-- 'high': Rotate through 8-10+ exercises (maximum variety)

-- Create the exercise variety preferences table
CREATE TABLE IF NOT EXISTS exercise_variety_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- Global variety setting
  variety_level TEXT NOT NULL DEFAULT 'medium' CHECK (variety_level IN ('low', 'medium', 'high')),

  -- How many sessions before an exercise can repeat for same muscle
  -- 0 = no restriction, 1+ = wait N sessions
  rotation_frequency INT NOT NULL DEFAULT 2 CHECK (rotation_frequency >= 0 AND rotation_frequency <= 10),

  -- Minimum pool size per muscle group (how many exercises to rotate between)
  min_pool_size INT NOT NULL DEFAULT 4 CHECK (min_pool_size >= 2 AND min_pool_size <= 15),

  -- Whether to still prioritize S/A tier exercises within variety
  prioritize_top_tier BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Track exercise usage history per user for smart rotation
CREATE TABLE IF NOT EXISTS exercise_usage_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  exercise_id UUID REFERENCES exercises(id) ON DELETE CASCADE NOT NULL,
  muscle_group TEXT NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  session_id UUID, -- Optional reference to workout session

  -- Index for quick lookups of recent exercise usage
  CONSTRAINT unique_usage_per_session UNIQUE (user_id, exercise_id, session_id)
);

-- Index for fetching user's variety preferences
CREATE INDEX IF NOT EXISTS idx_variety_prefs_user
  ON exercise_variety_preferences(user_id);

-- Index for fetching exercise usage by user and muscle
CREATE INDEX IF NOT EXISTS idx_exercise_usage_user_muscle
  ON exercise_usage_history(user_id, muscle_group, used_at DESC);

-- Index for fetching recent exercise usage
CREATE INDEX IF NOT EXISTS idx_exercise_usage_recent
  ON exercise_usage_history(user_id, used_at DESC);

-- Enable Row Level Security
ALTER TABLE exercise_variety_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_usage_history ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own variety preferences" ON exercise_variety_preferences;
DROP POLICY IF EXISTS "Users can insert own variety preferences" ON exercise_variety_preferences;
DROP POLICY IF EXISTS "Users can update own variety preferences" ON exercise_variety_preferences;
DROP POLICY IF EXISTS "Users can delete own variety preferences" ON exercise_variety_preferences;

DROP POLICY IF EXISTS "Users can view own exercise usage" ON exercise_usage_history;
DROP POLICY IF EXISTS "Users can insert own exercise usage" ON exercise_usage_history;
DROP POLICY IF EXISTS "Users can delete own exercise usage" ON exercise_usage_history;

-- RLS Policies for variety preferences
CREATE POLICY "Users can view own variety preferences"
  ON exercise_variety_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own variety preferences"
  ON exercise_variety_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own variety preferences"
  ON exercise_variety_preferences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own variety preferences"
  ON exercise_variety_preferences FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for exercise usage history
CREATE POLICY "Users can view own exercise usage"
  ON exercise_usage_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own exercise usage"
  ON exercise_usage_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own exercise usage"
  ON exercise_usage_history FOR DELETE
  USING (auth.uid() = user_id);

-- Function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_variety_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on row update
DROP TRIGGER IF EXISTS update_variety_preferences_timestamp ON exercise_variety_preferences;
CREATE TRIGGER update_variety_preferences_timestamp
  BEFORE UPDATE ON exercise_variety_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_variety_preferences_updated_at();

-- Function to clean up old exercise usage history (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_exercise_usage()
RETURNS void AS $$
BEGIN
  DELETE FROM exercise_usage_history
  WHERE used_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON TABLE exercise_variety_preferences IS 'Stores user preferences for exercise variety/rotation';
COMMENT ON COLUMN exercise_variety_preferences.variety_level IS 'low = stick to favorites, medium = balanced rotation, high = maximum variety';
COMMENT ON COLUMN exercise_variety_preferences.rotation_frequency IS 'How many sessions before same exercise can repeat for a muscle';
COMMENT ON COLUMN exercise_variety_preferences.min_pool_size IS 'Minimum number of exercises to rotate between per muscle';
COMMENT ON COLUMN exercise_variety_preferences.prioritize_top_tier IS 'Whether to still prefer S/A tier exercises within variety pool';

COMMENT ON TABLE exercise_usage_history IS 'Tracks which exercises were used recently for smart rotation';
