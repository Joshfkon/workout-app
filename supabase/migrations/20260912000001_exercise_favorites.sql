-- ============================================
-- EXERCISE FAVORITES
-- ============================================
-- Add is_favorite column to user_exercise_preferences to support favoriting exercises.
-- Favorites will appear prominently in the mid-workout exercise picker alongside recents.

-- Add is_favorite column (defaults to false)
ALTER TABLE user_exercise_preferences
ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fetching favorited exercises efficiently
CREATE INDEX IF NOT EXISTS idx_user_exercise_prefs_favorites
  ON user_exercise_preferences(user_id, is_favorite)
  WHERE is_favorite = TRUE;

-- Add comment for documentation
COMMENT ON COLUMN user_exercise_preferences.is_favorite IS 'Whether the user has favorited this exercise for quick access in the picker';
