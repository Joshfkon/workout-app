-- Coaching sessions table
CREATE TABLE coaching_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status TEXT CHECK (status IN ('not_started', 'in_progress', 'completed')) DEFAULT 'not_started',
  body_composition JSONB,
  selected_benchmarks TEXT[],
  strength_profile JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Calibrated lifts (individual benchmark results)
CREATE TABLE calibrated_lifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  coaching_session_id UUID REFERENCES coaching_sessions(id) ON DELETE CASCADE,
  benchmark_id TEXT NOT NULL,
  lift_name TEXT NOT NULL,
  tested_weight_kg DECIMAL(6,2) NOT NULL,
  tested_reps INTEGER NOT NULL,
  tested_rpe DECIMAL(3,1),
  estimated_1rm DECIMAL(6,2) NOT NULL,
  percentile_vs_general INTEGER,
  percentile_vs_trained INTEGER,
  percentile_vs_body_comp INTEGER,
  strength_level TEXT,
  tested_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, benchmark_id, tested_at)
);

-- Add onboarding_completed flag to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sex TEXT CHECK (sex IN ('male', 'female'));

-- Create indexes for performance
CREATE INDEX idx_coaching_sessions_user_id ON coaching_sessions(user_id);
CREATE INDEX idx_coaching_sessions_status ON coaching_sessions(status);
CREATE INDEX idx_calibrated_lifts_user_id ON calibrated_lifts(user_id);
CREATE INDEX idx_calibrated_lifts_benchmark_id ON calibrated_lifts(benchmark_id);
CREATE INDEX idx_calibrated_lifts_session_id ON calibrated_lifts(coaching_session_id);

-- RLS policies
ALTER TABLE coaching_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibrated_lifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own coaching sessions"
  ON coaching_sessions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own coaching sessions"
  ON coaching_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own coaching sessions"
  ON coaching_sessions FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own coaching sessions"
  ON coaching_sessions FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own calibrated lifts"
  ON calibrated_lifts FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own calibrated lifts"
  ON calibrated_lifts FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own calibrated lifts"
  ON calibrated_lifts FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own calibrated lifts"
  ON calibrated_lifts FOR DELETE USING (auth.uid() = user_id);

