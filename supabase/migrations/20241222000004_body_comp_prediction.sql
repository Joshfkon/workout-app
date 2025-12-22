-- Body Composition Prediction System
-- Adds support for P-ratio calibration, predictions, and accuracy tracking

-- ============================================
-- Body Composition Profiles Table
-- Stores learned P-ratio and calibration data
-- ============================================
CREATE TABLE IF NOT EXISTS body_comp_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Learned parameters (calibrated from actual scans)
  learned_p_ratio DECIMAL(4,3),  -- Personal partition ratio (0.500 - 1.000)
  p_ratio_confidence TEXT DEFAULT 'none' CHECK (p_ratio_confidence IN ('none', 'low', 'medium', 'high')),
  p_ratio_data_points INTEGER DEFAULT 0,  -- Number of scan pairs used for calibration

  -- Modifiers learned from user's actual results
  protein_modifier DECIMAL(3,2) DEFAULT 1.00,  -- 0.50 - 1.50
  training_modifier DECIMAL(3,2) DEFAULT 1.00,
  deficit_modifier DECIMAL(3,2) DEFAULT 1.00,

  -- Context
  training_age TEXT DEFAULT 'intermediate' CHECK (training_age IN ('beginner', 'intermediate', 'advanced')),
  is_enhanced BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One profile per user
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE body_comp_profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own body comp profile"
  ON body_comp_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own body comp profile"
  ON body_comp_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own body comp profile"
  ON body_comp_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_body_comp_profiles_user ON body_comp_profiles(user_id);

-- ============================================
-- Extend dexa_scans table with additional columns
-- ============================================
ALTER TABLE dexa_scans
ADD COLUMN IF NOT EXISTS provider TEXT,
ADD COLUMN IF NOT EXISTS scan_image_url TEXT,
ADD COLUMN IF NOT EXISTS conditions JSONB,
ADD COLUMN IF NOT EXISTS is_baseline BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS confidence TEXT DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low'));

-- Add comment for conditions structure
COMMENT ON COLUMN dexa_scans.conditions IS 'Scan conditions JSON: { timeOfDay, hydrationStatus, recentWorkout, sameProviderAsPrevious }';

-- ============================================
-- Prediction Accuracy Logs Table
-- Tracks how accurate predictions were vs actual results
-- ============================================
CREATE TABLE IF NOT EXISTS prediction_accuracy_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Dates
  prediction_date DATE NOT NULL,
  actual_date DATE NOT NULL,

  -- Predictions
  predicted_body_fat DECIMAL(4,1) NOT NULL,
  predicted_lean_mass DECIMAL(5,2) NOT NULL,  -- in kg
  predicted_fat_mass DECIMAL(5,2) NOT NULL,   -- in kg

  -- Actuals (from DEXA scan)
  actual_body_fat DECIMAL(4,1) NOT NULL,
  actual_lean_mass DECIMAL(5,2) NOT NULL,
  actual_fat_mass DECIMAL(5,2) NOT NULL,

  -- Errors (actual - predicted)
  body_fat_error DECIMAL(4,2) NOT NULL,
  lean_mass_error DECIMAL(5,2) NOT NULL,
  fat_mass_error DECIMAL(5,2) NOT NULL,

  -- Was prediction within confidence range?
  within_range BOOLEAN NOT NULL,

  -- P-ratio comparison
  predicted_p_ratio DECIMAL(4,3) NOT NULL,
  actual_p_ratio DECIMAL(4,3) NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE prediction_accuracy_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own prediction logs"
  ON prediction_accuracy_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own prediction logs"
  ON prediction_accuracy_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Index for querying by user
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_user ON prediction_accuracy_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_date ON prediction_accuracy_logs(user_id, actual_date DESC);

-- ============================================
-- Body Composition Predictions Table
-- Stores saved predictions for later comparison
-- ============================================
CREATE TABLE IF NOT EXISTS body_comp_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Source scan
  source_scan_id UUID NOT NULL REFERENCES dexa_scans(id) ON DELETE CASCADE,

  -- Target
  target_date DATE NOT NULL,
  target_weight DECIMAL(5,2) NOT NULL,  -- in kg

  -- Predictions with ranges
  predicted_fat_mass DECIMAL(5,2) NOT NULL,
  predicted_lean_mass DECIMAL(5,2) NOT NULL,
  predicted_body_fat_percent DECIMAL(4,1) NOT NULL,

  -- Confidence ranges (JSON for flexibility)
  fat_mass_range JSONB NOT NULL,  -- { optimistic, expected, pessimistic }
  lean_mass_range JSONB NOT NULL,
  body_fat_range JSONB NOT NULL,

  -- Metadata
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('low', 'moderate', 'reasonable')),
  confidence_factors TEXT[] NOT NULL,

  -- Assumptions used (JSON)
  assumptions JSONB NOT NULL,  -- { avgDailyDeficit, avgDailyProtein, avgWeeklyVolume, pRatioUsed }

  -- Status
  is_active BOOLEAN DEFAULT TRUE,  -- Mark as inactive when new prediction replaces it

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE body_comp_predictions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own predictions"
  ON body_comp_predictions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own predictions"
  ON body_comp_predictions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own predictions"
  ON body_comp_predictions FOR UPDATE
  USING (auth.uid() = user_id);

-- Index for querying
CREATE INDEX IF NOT EXISTS idx_body_comp_predictions_user ON body_comp_predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_body_comp_predictions_active ON body_comp_predictions(user_id, is_active) WHERE is_active = TRUE;

-- ============================================
-- Function to auto-update updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_body_comp_profile_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for body_comp_profiles
DROP TRIGGER IF EXISTS update_body_comp_profiles_timestamp ON body_comp_profiles;
CREATE TRIGGER update_body_comp_profiles_timestamp
  BEFORE UPDATE ON body_comp_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_body_comp_profile_timestamp();
