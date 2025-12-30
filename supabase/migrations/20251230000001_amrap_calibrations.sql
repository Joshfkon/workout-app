-- ============================================
-- AMRAP CALIBRATION TRACKING
-- Persists RPE calibration results from AMRAP sets
-- for long-term tracking and improved prescriptions
-- ============================================

CREATE TABLE IF NOT EXISTS amrap_calibrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_session_id UUID REFERENCES workout_sessions(id) ON DELETE SET NULL,
  set_log_id UUID REFERENCES set_logs(id) ON DELETE SET NULL,
  exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL,
  exercise_name TEXT NOT NULL,

  -- The calibration data
  weight_kg NUMERIC(6,2) NOT NULL,
  predicted_max_reps NUMERIC(4,1) NOT NULL,
  actual_max_reps INTEGER NOT NULL,
  bias NUMERIC(4,1) NOT NULL, -- Positive = sandbagging, Negative = overreaching
  bias_interpretation TEXT NOT NULL,
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('low', 'medium', 'high')),
  data_points INTEGER NOT NULL DEFAULT 0,

  calibrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_amrap_calibrations_user ON amrap_calibrations(user_id, calibrated_at DESC);
CREATE INDEX IF NOT EXISTS idx_amrap_calibrations_exercise ON amrap_calibrations(user_id, exercise_name, calibrated_at DESC);
CREATE INDEX IF NOT EXISTS idx_amrap_calibrations_session ON amrap_calibrations(workout_session_id);

-- Enable Row Level Security
ALTER TABLE amrap_calibrations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own amrap calibrations"
  ON amrap_calibrations FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own amrap calibrations"
  ON amrap_calibrations FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own amrap calibrations"
  ON amrap_calibrations FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own amrap calibrations"
  ON amrap_calibrations FOR DELETE USING (auth.uid() = user_id);

-- Comment for documentation
COMMENT ON TABLE amrap_calibrations IS 'Stores RPE calibration results from AMRAP sets to track perception accuracy over time';
COMMENT ON COLUMN amrap_calibrations.bias IS 'Positive bias = sandbagging (stopped early), Negative = overreaching (pushed too hard)';
COMMENT ON COLUMN amrap_calibrations.predicted_max_reps IS 'What prior RIR reports implied user could do';
COMMENT ON COLUMN amrap_calibrations.actual_max_reps IS 'What AMRAP actually showed';
