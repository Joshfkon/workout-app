-- Wearable Integration Tables
-- Stores wearable device connections and daily activity data for enhanced TDEE calculations

-- ============================================
-- WEARABLE CONNECTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS wearable_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  source text NOT NULL CHECK (source IN ('apple_healthkit', 'google_fit', 'fitbit', 'samsung_health', 'garmin', 'manual')),
  is_connected boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  permissions text[] NOT NULL DEFAULT '{}',
  device_name text,

  -- Normalization factor (learned over time, default 1.0)
  step_calibration_factor numeric(4,3) NOT NULL DEFAULT 1.0,

  -- OAuth tokens for Fitbit/Garmin (encrypted in production)
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Each user can have one connection per source
  UNIQUE(user_id, source)
);

-- Create indexes
CREATE INDEX idx_wearable_connections_user_id ON wearable_connections(user_id);
CREATE INDEX idx_wearable_connections_source ON wearable_connections(source);
CREATE INDEX idx_wearable_connections_connected ON wearable_connections(user_id, is_connected) WHERE is_connected = true;

-- Enable RLS
ALTER TABLE wearable_connections ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own wearable connections"
  ON wearable_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own wearable connections"
  ON wearable_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wearable connections"
  ON wearable_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own wearable connections"
  ON wearable_connections FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- DAILY ACTIVITY DATA TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS daily_activity_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,

  -- Step data
  steps_total integer NOT NULL DEFAULT 0,
  steps_source text NOT NULL DEFAULT 'manual' CHECK (steps_source IN ('apple_healthkit', 'google_fit', 'fitbit', 'samsung_health', 'garmin', 'manual')),
  steps_hourly_breakdown integer[], -- 24 values for each hour
  steps_confidence text NOT NULL DEFAULT 'manual' CHECK (steps_confidence IN ('measured', 'estimated', 'manual')),

  -- Wearable-reported calories (used cautiously)
  wearable_active_calories integer,
  wearable_active_calories_source text CHECK (wearable_active_calories_source IN ('apple_healthkit', 'google_fit', 'fitbit', 'samsung_health', 'garmin', 'manual')),

  -- Calculated expenditures
  step_expenditure integer NOT NULL DEFAULT 0,
  workout_expenditure integer NOT NULL DEFAULT 0,
  total_activity_expenditure integer NOT NULL DEFAULT 0,
  activity_level text NOT NULL DEFAULT 'sedentary' CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One entry per user per day
  UNIQUE(user_id, date)
);

-- Create indexes
CREATE INDEX idx_daily_activity_user_id ON daily_activity_data(user_id);
CREATE INDEX idx_daily_activity_date ON daily_activity_data(date);
CREATE INDEX idx_daily_activity_user_date ON daily_activity_data(user_id, date);

-- Enable RLS
ALTER TABLE daily_activity_data ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own daily activity data"
  ON daily_activity_data FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily activity data"
  ON daily_activity_data FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily activity data"
  ON daily_activity_data FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own daily activity data"
  ON daily_activity_data FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- APP WORKOUT ACTIVITY TABLE
-- Links workouts to daily activity for calorie/step overlap tracking
-- ============================================
CREATE TABLE IF NOT EXISTS app_workout_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  daily_activity_id uuid REFERENCES daily_activity_data(id) ON DELETE CASCADE,
  workout_session_id uuid REFERENCES workout_sessions(id) ON DELETE CASCADE,

  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  duration_minutes integer NOT NULL,

  -- From workout logging
  muscle_groups text[] NOT NULL DEFAULT '{}',
  total_sets integer NOT NULL DEFAULT 0,
  total_volume numeric NOT NULL DEFAULT 0, -- Sets x reps x weight
  average_rest_seconds integer NOT NULL DEFAULT 0,

  -- Estimated expenditure (conservative)
  estimated_calories integer NOT NULL DEFAULT 0,

  -- Steps during this period (to avoid double-count)
  steps_overlap integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_app_workout_activity_user_id ON app_workout_activity(user_id);
CREATE INDEX idx_app_workout_activity_daily ON app_workout_activity(daily_activity_id);
CREATE INDEX idx_app_workout_activity_session ON app_workout_activity(workout_session_id);

-- Enable RLS
ALTER TABLE app_workout_activity ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own app workout activity"
  ON app_workout_activity FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own app workout activity"
  ON app_workout_activity FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own app workout activity"
  ON app_workout_activity FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own app workout activity"
  ON app_workout_activity FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- ACTIVITY SETTINGS TABLE
-- User preferences for activity-based calorie adjustments
-- ============================================
CREATE TABLE IF NOT EXISTS activity_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Calorie adjustment mode
  adjustment_mode text NOT NULL DEFAULT 'fixed' CHECK (adjustment_mode IN ('fixed', 'activity_adjusted', 'deficit_locked')),
  max_daily_adjustment integer NOT NULL DEFAULT 300, -- Cap on adjustments
  target_deficit_cals integer NOT NULL DEFAULT 500, -- For deficit-locked mode

  -- Workout calorie source preference
  use_app_workout_estimates boolean NOT NULL DEFAULT true,
  use_wearable_workout_calories boolean NOT NULL DEFAULT false, -- Often overestimates lifting

  -- Preferred wearable source (null = use priority order)
  preferred_wearable_source text CHECK (preferred_wearable_source IS NULL OR preferred_wearable_source IN ('apple_healthkit', 'google_fit', 'fitbit', 'samsung_health', 'garmin', 'manual')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE activity_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own activity settings"
  ON activity_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own activity settings"
  ON activity_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own activity settings"
  ON activity_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- ============================================
-- ENHANCED TDEE PARAMETERS TABLE
-- Stores learned parameters for enhanced TDEE model
-- ============================================
CREATE TABLE IF NOT EXISTS enhanced_tdee_params (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Model parameters (learned from data)
  base_burn_rate numeric(5,2) NOT NULL DEFAULT 13.5, -- alpha: cal/lb at rest
  step_burn_rate numeric(6,4) NOT NULL DEFAULT 0.04, -- beta: cal/step
  workout_multiplier numeric(4,2) NOT NULL DEFAULT 1.0, -- gamma: workout estimate multiplier

  -- Statistics
  average_steps integer NOT NULL DEFAULT 0,
  average_workout_calories integer NOT NULL DEFAULT 0,

  -- Model confidence
  data_points_used integer NOT NULL DEFAULT 0,
  last_updated timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE enhanced_tdee_params ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own enhanced TDEE params"
  ON enhanced_tdee_params FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own enhanced TDEE params"
  ON enhanced_tdee_params FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own enhanced TDEE params"
  ON enhanced_tdee_params FOR UPDATE
  USING (auth.uid() = user_id);

-- ============================================
-- STEP CALIBRATION HISTORY TABLE
-- Tracks step calibration factor changes over time
-- ============================================
CREATE TABLE IF NOT EXISTS step_calibration_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  wearable_connection_id uuid REFERENCES wearable_connections(id) ON DELETE CASCADE NOT NULL,

  old_factor numeric(4,3) NOT NULL,
  new_factor numeric(4,3) NOT NULL,
  reason text NOT NULL, -- 'initial', 'auto_adjustment', 'manual'

  -- Context for the adjustment
  correlation_score numeric(5,4), -- Pearson correlation used for auto-adjustment
  data_points_analyzed integer,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create index
CREATE INDEX idx_step_calibration_history_user ON step_calibration_history(user_id);
CREATE INDEX idx_step_calibration_history_connection ON step_calibration_history(wearable_connection_id);

-- Enable RLS
ALTER TABLE step_calibration_history ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own step calibration history"
  ON step_calibration_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own step calibration history"
  ON step_calibration_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_wearable_connections_updated_at
    BEFORE UPDATE ON wearable_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_activity_data_updated_at
    BEFORE UPDATE ON daily_activity_data
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_activity_settings_updated_at
    BEFORE UPDATE ON activity_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to get user's active wearable connections
CREATE OR REPLACE FUNCTION get_active_wearable_connections(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  source text,
  device_name text,
  last_sync_at timestamptz,
  step_calibration_factor numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    wc.id,
    wc.source,
    wc.device_name,
    wc.last_sync_at,
    wc.step_calibration_factor
  FROM wearable_connections wc
  WHERE wc.user_id = p_user_id AND wc.is_connected = true
  ORDER BY
    CASE wc.source
      WHEN 'apple_healthkit' THEN 1
      WHEN 'google_fit' THEN 2
      WHEN 'fitbit' THEN 3
      WHEN 'samsung_health' THEN 4
      WHEN 'garmin' THEN 5
      ELSE 6
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get daily activity data for a date range
CREATE OR REPLACE FUNCTION get_daily_activity_range(
  p_user_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  date date,
  steps_total integer,
  steps_source text,
  activity_level text,
  step_expenditure integer,
  workout_expenditure integer,
  total_activity_expenditure integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dad.date,
    dad.steps_total,
    dad.steps_source,
    dad.activity_level,
    dad.step_expenditure,
    dad.workout_expenditure,
    dad.total_activity_expenditure
  FROM daily_activity_data dad
  WHERE dad.user_id = p_user_id
    AND dad.date >= p_start_date
    AND dad.date <= p_end_date
  ORDER BY dad.date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to upsert daily activity data
CREATE OR REPLACE FUNCTION upsert_daily_activity(
  p_user_id uuid,
  p_date date,
  p_steps_total integer,
  p_steps_source text,
  p_steps_hourly_breakdown integer[],
  p_steps_confidence text,
  p_step_expenditure integer,
  p_workout_expenditure integer,
  p_total_activity_expenditure integer,
  p_activity_level text,
  p_wearable_active_calories integer DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO daily_activity_data (
    user_id,
    date,
    steps_total,
    steps_source,
    steps_hourly_breakdown,
    steps_confidence,
    wearable_active_calories,
    wearable_active_calories_source,
    step_expenditure,
    workout_expenditure,
    total_activity_expenditure,
    activity_level
  ) VALUES (
    p_user_id,
    p_date,
    p_steps_total,
    p_steps_source,
    p_steps_hourly_breakdown,
    p_steps_confidence,
    p_wearable_active_calories,
    CASE WHEN p_wearable_active_calories IS NOT NULL THEN p_steps_source ELSE NULL END,
    p_step_expenditure,
    p_workout_expenditure,
    p_total_activity_expenditure,
    p_activity_level
  )
  ON CONFLICT (user_id, date) DO UPDATE SET
    steps_total = EXCLUDED.steps_total,
    steps_source = EXCLUDED.steps_source,
    steps_hourly_breakdown = EXCLUDED.steps_hourly_breakdown,
    steps_confidence = EXCLUDED.steps_confidence,
    wearable_active_calories = EXCLUDED.wearable_active_calories,
    wearable_active_calories_source = EXCLUDED.wearable_active_calories_source,
    step_expenditure = EXCLUDED.step_expenditure,
    workout_expenditure = EXCLUDED.workout_expenditure,
    total_activity_expenditure = EXCLUDED.total_activity_expenditure,
    activity_level = EXCLUDED.activity_level,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
