-- ============================================================
-- MACRO CALCULATION SETTINGS
-- Stores user preferences for automatic macro recalculation
-- ============================================================

CREATE TABLE IF NOT EXISTS macro_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  
  -- User stats (some pulled from profile, but stored here for recalc)
  height_cm NUMERIC(5,1),
  age INTEGER,
  sex TEXT CHECK (sex IN ('male', 'female')),
  
  -- Activity configuration
  activity_level TEXT NOT NULL DEFAULT 'moderate' CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active', 'athlete')),
  workouts_per_week INTEGER DEFAULT 4,
  avg_workout_minutes INTEGER DEFAULT 60,
  workout_intensity TEXT DEFAULT 'moderate' CHECK (workout_intensity IN ('light', 'moderate', 'intense')),
  
  -- Goal configuration
  goal TEXT NOT NULL DEFAULT 'maintain' CHECK (goal IN ('aggressive_cut', 'moderate_cut', 'slow_cut', 'maintain', 'slow_bulk', 'moderate_bulk', 'aggressive_bulk')),
  target_weight_change_per_week NUMERIC(4,2), -- in kg
  peptide TEXT DEFAULT 'none' CHECK (peptide IN ('none', 'semaglutide', 'tirzepatide', 'retatrutide', 'liraglutide', 'tesofensine', 'gh_peptides')),
  
  -- Auto-update settings
  auto_update_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_macro_settings_user ON macro_settings(user_id);

-- Enable RLS
ALTER TABLE macro_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own macro settings"
  ON macro_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own macro settings"
  ON macro_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own macro settings"
  ON macro_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own macro settings"
  ON macro_settings FOR DELETE
  USING (auth.uid() = user_id);

-- Comments
COMMENT ON TABLE macro_settings IS 'Stores user preferences for automatic macro calculation and recalculation';
COMMENT ON COLUMN macro_settings.auto_update_enabled IS 'When true, macros are recalculated automatically when weight changes';

