-- ============================================
-- TRAINING SCIENCE INTEGRATION
-- Additional tables and columns for the program engine
-- ============================================

-- ============================================
-- EXTEND USERS TABLE FOR TRAINING PROFILE
-- ============================================

-- Add birth_date for age calculations
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;

-- Add training age in years
ALTER TABLE users ADD COLUMN IF NOT EXISTS training_age_years NUMERIC(4,1) DEFAULT 0;

-- Add sleep and stress tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS sleep_quality INTEGER DEFAULT 3 CHECK (sleep_quality >= 1 AND sleep_quality <= 5);
ALTER TABLE users ADD COLUMN IF NOT EXISTS stress_level INTEGER DEFAULT 3 CHECK (stress_level >= 1 AND stress_level <= 5);

-- Add available equipment (array of equipment types)
ALTER TABLE users ADD COLUMN IF NOT EXISTS available_equipment TEXT[] DEFAULT ARRAY['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];

-- Add injury history (array of affected muscle groups)
ALTER TABLE users ADD COLUMN IF NOT EXISTS injury_history TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add preferred session duration
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_session_minutes INTEGER DEFAULT 60;

-- ============================================
-- EXTEND MESOCYCLES TABLE FOR PROGRAM DATA
-- ============================================

-- Add periodization model
ALTER TABLE mesocycles ADD COLUMN IF NOT EXISTS periodization_model TEXT DEFAULT 'linear';

-- Add full program data (stored as JSONB for flexibility)
ALTER TABLE mesocycles ADD COLUMN IF NOT EXISTS program_data JSONB;

-- Add fatigue budget configuration
ALTER TABLE mesocycles ADD COLUMN IF NOT EXISTS fatigue_budget_config JSONB;

-- Add volume per muscle tracking
ALTER TABLE mesocycles ADD COLUMN IF NOT EXISTS volume_per_muscle JSONB;

-- Add recovery multiplier
ALTER TABLE mesocycles ADD COLUMN IF NOT EXISTS recovery_multiplier NUMERIC(3,2) DEFAULT 1.0;

-- Add is_active flag for easier querying
ALTER TABLE mesocycles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false;

-- Add start_date for tracking
ALTER TABLE mesocycles ADD COLUMN IF NOT EXISTS start_date DATE DEFAULT CURRENT_DATE;

-- ============================================
-- EXERCISE HISTORY TABLE
-- Track per-exercise performance over time
-- ============================================

CREATE TABLE IF NOT EXISTS exercise_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_session_id UUID REFERENCES workout_sessions(id) ON DELETE SET NULL,
  exercise_name TEXT NOT NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sets JSONB NOT NULL, -- Array of {weight, reps, rpe, completed}
  estimated_1rm_kg NUMERIC(6,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercise_history_user ON exercise_history(user_id, exercise_name, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_exercise_history_session ON exercise_history(workout_session_id);

-- RLS for exercise_history
ALTER TABLE exercise_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own exercise history"
  ON exercise_history FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own exercise history"
  ON exercise_history FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own exercise history"
  ON exercise_history FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own exercise history"
  ON exercise_history FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- WEEKLY FATIGUE LOGS TABLE
-- Track fatigue and recovery per mesocycle week
-- ============================================

CREATE TABLE IF NOT EXISTS weekly_fatigue_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mesocycle_id UUID REFERENCES mesocycles(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  perceived_fatigue INTEGER CHECK (perceived_fatigue >= 1 AND perceived_fatigue <= 5),
  sleep_quality INTEGER CHECK (sleep_quality >= 1 AND sleep_quality <= 5),
  motivation_level INTEGER CHECK (motivation_level >= 1 AND motivation_level <= 5),
  missed_reps INTEGER DEFAULT 0,
  joint_pain BOOLEAN DEFAULT FALSE,
  strength_decline BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fatigue_logs_user ON weekly_fatigue_logs(user_id, mesocycle_id, week_number);

-- RLS for weekly_fatigue_logs
ALTER TABLE weekly_fatigue_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own fatigue logs"
  ON weekly_fatigue_logs FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own fatigue logs"
  ON weekly_fatigue_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own fatigue logs"
  ON weekly_fatigue_logs FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own fatigue logs"
  ON weekly_fatigue_logs FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- STRENGTH CALIBRATIONS TABLE
-- More comprehensive version for program engine
-- ============================================

CREATE TABLE IF NOT EXISTS strength_calibrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  tested_weight_kg NUMERIC(6,2) NOT NULL,
  tested_reps INTEGER NOT NULL CHECK (tested_reps > 0 AND tested_reps <= 30),
  tested_rpe NUMERIC(3,1) CHECK (tested_rpe >= 1 AND tested_rpe <= 10),
  estimated_1rm_kg NUMERIC(6,2) NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium',
  source TEXT NOT NULL DEFAULT 'calibration',
  percentile_general INTEGER,
  percentile_trained INTEGER,
  strength_level TEXT,
  tested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id, exercise_name, tested_at)
);

CREATE INDEX IF NOT EXISTS idx_strength_calibrations_user ON strength_calibrations(user_id, exercise_name, tested_at DESC);

-- RLS for strength_calibrations
ALTER TABLE strength_calibrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strength calibrations"
  ON strength_calibrations FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own strength calibrations"
  ON strength_calibrations FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own strength calibrations"
  ON strength_calibrations FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own strength calibrations"
  ON strength_calibrations FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- EXTEND EXERCISE_BLOCKS FOR WEIGHT RECOMMENDATIONS
-- ============================================

ALTER TABLE exercise_blocks ADD COLUMN IF NOT EXISTS exercise_name TEXT;
ALTER TABLE exercise_blocks ADD COLUMN IF NOT EXISTS finding_weight_protocol JSONB;
ALTER TABLE exercise_blocks ADD COLUMN IF NOT EXISTS weight_confidence TEXT DEFAULT 'low';

-- ============================================
-- ADD COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE exercise_history IS 'Tracks historical performance for each exercise to estimate 1RMs';
COMMENT ON TABLE weekly_fatigue_logs IS 'Weekly check-ins to detect need for deload';
COMMENT ON TABLE strength_calibrations IS 'Benchmark lift results from coaching calibration sessions';

COMMENT ON COLUMN mesocycles.program_data IS 'Full FullProgramRecommendation JSON including all sessions and weeks';
COMMENT ON COLUMN mesocycles.fatigue_budget_config IS 'Systemic and local fatigue limits for this mesocycle';
COMMENT ON COLUMN mesocycles.volume_per_muscle IS 'Target sets and frequency per muscle group';
COMMENT ON COLUMN mesocycles.recovery_multiplier IS 'User-specific recovery factor (age, sleep, stress adjusted)';

COMMENT ON COLUMN users.training_age_years IS 'Years of consistent resistance training';
COMMENT ON COLUMN users.available_equipment IS 'Equipment user has access to for exercise selection';
COMMENT ON COLUMN users.injury_history IS 'Muscle groups with injury history to avoid';


