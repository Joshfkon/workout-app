-- ============================================================
-- USER MUSCLE PRIORITIES TABLE
-- Allows users to set priority levels for each muscle group
-- Priority 1 = highest focus, 5 = maintenance only
-- ============================================================

-- Create the user_muscle_priorities table
CREATE TABLE IF NOT EXISTS user_muscle_priorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The muscle group this priority applies to
  muscle_group TEXT NOT NULL CHECK (muscle_group IN (
    'chest', 'back', 'shoulders', 'biceps', 'triceps',
    'quads', 'hamstrings', 'glutes', 'calves', 'abs',
    'adductors', 'forearms', 'traps'
  )),

  -- Priority level: 1 = highest focus, 5 = maintenance only
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),

  -- Optional reason for this priority
  reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each user can only have one priority per muscle group
  UNIQUE(user_id, muscle_group)
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_user_muscle_priorities_user_id
  ON user_muscle_priorities(user_id);

-- Enable Row Level Security
ALTER TABLE user_muscle_priorities ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only manage their own priorities
CREATE POLICY "Users can view their own muscle priorities"
  ON user_muscle_priorities FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own muscle priorities"
  ON user_muscle_priorities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own muscle priorities"
  ON user_muscle_priorities FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own muscle priorities"
  ON user_muscle_priorities FOR DELETE
  USING (auth.uid() = user_id);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_muscle_priority_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_update_muscle_priority_timestamp
  BEFORE UPDATE ON user_muscle_priorities
  FOR EACH ROW
  EXECUTE FUNCTION update_muscle_priority_updated_at();

-- ============================================================
-- IMBALANCE ANALYSIS CACHE TABLE
-- Stores computed imbalance analysis for quick access
-- Re-computed when measurements change
-- ============================================================

CREATE TABLE IF NOT EXISTS imbalance_analysis_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The analysis results (stored as JSONB)
  analysis JSONB NOT NULL,

  -- Overall balance score (0-100)
  balance_score INTEGER NOT NULL DEFAULT 100,

  -- When the analysis was computed
  computed_at TIMESTAMPTZ DEFAULT NOW(),

  -- Reference to the measurements used
  measurement_id UUID REFERENCES body_measurements(id) ON DELETE SET NULL,

  -- Only keep latest analysis per user
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE imbalance_analysis_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own imbalance analysis"
  ON imbalance_analysis_cache FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own imbalance analysis"
  ON imbalance_analysis_cache FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own imbalance analysis"
  ON imbalance_analysis_cache FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own imbalance analysis"
  ON imbalance_analysis_cache FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- ADD USER BEST LIFTS TABLE FOR SANITY CHECKS
-- Stores user's best lifts for comparison with measurements
-- ============================================================

CREATE TABLE IF NOT EXISTS user_best_lifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The exercise this lift is for
  exercise_name TEXT NOT NULL,

  -- The best weight achieved (in kg)
  weight_kg DECIMAL(6,2) NOT NULL,

  -- Reps at this weight
  reps INTEGER NOT NULL DEFAULT 1,

  -- Estimated 1RM (calculated using Epley formula)
  estimated_1rm_kg DECIMAL(6,2),

  -- When this lift was achieved
  achieved_at DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Source: manual entry or auto-detected from workout logs
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each user has one best per exercise
  UNIQUE(user_id, exercise_name)
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_user_best_lifts_user_id
  ON user_best_lifts(user_id);

-- Enable RLS
ALTER TABLE user_best_lifts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own best lifts"
  ON user_best_lifts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own best lifts"
  ON user_best_lifts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own best lifts"
  ON user_best_lifts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own best lifts"
  ON user_best_lifts FOR DELETE
  USING (auth.uid() = user_id);

-- Function for best lifts updated_at (separate from muscle priorities)
CREATE OR REPLACE FUNCTION update_best_lifts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_update_best_lifts_timestamp ON user_best_lifts;
CREATE TRIGGER trigger_update_best_lifts_timestamp
  BEFORE UPDATE ON user_best_lifts
  FOR EACH ROW
  EXECUTE FUNCTION update_best_lifts_updated_at();
