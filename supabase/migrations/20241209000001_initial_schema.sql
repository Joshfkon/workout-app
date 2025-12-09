-- ============================================
-- HYPERTROPHY WORKOUT TRACKER - INITIAL SCHEMA
-- ============================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE goal AS ENUM ('bulk', 'cut', 'maintenance');
CREATE TYPE experience AS ENUM ('novice', 'intermediate', 'advanced');
CREATE TYPE mechanic AS ENUM ('compound', 'isolation');
CREATE TYPE session_state AS ENUM ('planned', 'in_progress', 'completed', 'skipped');
CREATE TYPE set_quality AS ENUM ('junk', 'effective', 'stimulative', 'excessive');
CREATE TYPE progression_type AS ENUM ('load', 'reps', 'sets', 'technique');
CREATE TYPE volume_status AS ENUM ('below_mev', 'effective', 'optimal', 'approaching_mrv', 'exceeding_mrv');
CREATE TYPE bodyweight_source AS ENUM ('manual', 'pre_workout');
CREATE TYPE mesocycle_state AS ENUM ('planned', 'active', 'completed');

-- ============================================
-- USERS TABLE (extends Supabase auth.users)
-- ============================================

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  goal goal NOT NULL DEFAULT 'maintenance',
  experience experience NOT NULL DEFAULT 'intermediate',
  
  preferences JSONB NOT NULL DEFAULT '{
    "units": "kg",
    "restTimerDefault": 180,
    "showFormCues": true,
    "showWarmupSuggestions": true
  }'::jsonb,
  
  volume_landmarks JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Index for faster lookups
CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- BODYWEIGHT ENTRIES
-- ============================================

CREATE TABLE bodyweight_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  weight_kg DECIMAL(5,2) NOT NULL CHECK (weight_kg > 0 AND weight_kg < 500),
  source bodyweight_source NOT NULL DEFAULT 'manual',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id, date, source)
);

CREATE INDEX idx_bodyweight_user_date ON bodyweight_entries(user_id, date DESC);

-- ============================================
-- EXERCISES
-- ============================================

CREATE TABLE exercises (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  primary_muscle TEXT NOT NULL,
  secondary_muscles TEXT[] NOT NULL DEFAULT '{}',
  mechanic mechanic NOT NULL DEFAULT 'compound',
  
  default_rep_range INTEGER[] NOT NULL DEFAULT '{8, 12}',
  default_rir INTEGER NOT NULL DEFAULT 2 CHECK (default_rir >= 0 AND default_rir <= 5),
  min_weight_increment_kg DECIMAL(4,2) NOT NULL DEFAULT 2.5,
  
  form_cues TEXT[] NOT NULL DEFAULT '{}',
  common_mistakes TEXT[] NOT NULL DEFAULT '{}',
  setup_note TEXT NOT NULL DEFAULT '',
  
  movement_pattern TEXT NOT NULL,
  equipment_required TEXT[] NOT NULL DEFAULT '{}',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exercises_primary_muscle ON exercises(primary_muscle);
CREATE INDEX idx_exercises_movement_pattern ON exercises(movement_pattern);
CREATE INDEX idx_exercises_name ON exercises(name);

-- ============================================
-- MESOCYCLES
-- ============================================

CREATE TABLE mesocycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  state mesocycle_state NOT NULL DEFAULT 'planned',
  
  total_weeks INTEGER NOT NULL DEFAULT 6 CHECK (total_weeks >= 1 AND total_weeks <= 12),
  current_week INTEGER NOT NULL DEFAULT 1 CHECK (current_week >= 1),
  deload_week INTEGER NOT NULL DEFAULT 6,
  days_per_week INTEGER NOT NULL DEFAULT 4 CHECK (days_per_week >= 1 AND days_per_week <= 7),
  split_type TEXT NOT NULL DEFAULT 'PPL',
  
  fatigue_score INTEGER NOT NULL DEFAULT 0 CHECK (fatigue_score >= 0 AND fatigue_score <= 100),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  CONSTRAINT valid_deload_week CHECK (deload_week <= total_weeks),
  CONSTRAINT valid_current_week CHECK (current_week <= total_weeks)
);

CREATE INDEX idx_mesocycles_user ON mesocycles(user_id);
CREATE INDEX idx_mesocycles_state ON mesocycles(user_id, state);

-- ============================================
-- WORKOUT SESSIONS
-- ============================================

CREATE TABLE workout_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mesocycle_id UUID REFERENCES mesocycles(id) ON DELETE SET NULL,
  
  state session_state NOT NULL DEFAULT 'planned',
  planned_date DATE NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  pre_workout_check_in JSONB,
  session_rpe INTEGER CHECK (session_rpe >= 1 AND session_rpe <= 10),
  pump_rating INTEGER CHECK (pump_rating >= 1 AND pump_rating <= 5),
  session_notes TEXT,
  
  completion_percent INTEGER NOT NULL DEFAULT 0 CHECK (completion_percent >= 0 AND completion_percent <= 100),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workout_sessions_user_date ON workout_sessions(user_id, planned_date DESC);
CREATE INDEX idx_workout_sessions_mesocycle ON workout_sessions(mesocycle_id);
CREATE INDEX idx_workout_sessions_state ON workout_sessions(user_id, state);

-- ============================================
-- EXERCISE BLOCKS
-- ============================================

CREATE TABLE exercise_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workout_session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  
  "order" INTEGER NOT NULL DEFAULT 1,
  superset_group_id UUID,
  superset_order INTEGER,
  
  target_sets INTEGER NOT NULL DEFAULT 3 CHECK (target_sets >= 1 AND target_sets <= 10),
  target_rep_range INTEGER[] NOT NULL DEFAULT '{8, 12}',
  target_rir INTEGER NOT NULL DEFAULT 2 CHECK (target_rir >= 0 AND target_rir <= 5),
  target_weight_kg DECIMAL(6,2) NOT NULL DEFAULT 0,
  target_rest_seconds INTEGER NOT NULL DEFAULT 180 CHECK (target_rest_seconds >= 0 AND target_rest_seconds <= 600),
  
  progression_type progression_type,
  suggestion_reason TEXT NOT NULL DEFAULT '',
  warmup_protocol JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  note TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(workout_session_id, "order")
);

CREATE INDEX idx_exercise_blocks_session ON exercise_blocks(workout_session_id);
CREATE INDEX idx_exercise_blocks_exercise ON exercise_blocks(exercise_id);
CREATE INDEX idx_exercise_blocks_superset ON exercise_blocks(superset_group_id);

-- ============================================
-- SET LOGS
-- ============================================

CREATE TABLE set_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exercise_block_id UUID NOT NULL REFERENCES exercise_blocks(id) ON DELETE CASCADE,
  
  set_number INTEGER NOT NULL CHECK (set_number >= 1),
  weight_kg DECIMAL(6,2) NOT NULL CHECK (weight_kg >= 0),
  reps INTEGER NOT NULL CHECK (reps >= 0 AND reps <= 100),
  rpe DECIMAL(3,1) NOT NULL DEFAULT 7 CHECK (rpe >= 1 AND rpe <= 10),
  rest_seconds INTEGER CHECK (rest_seconds >= 0),
  is_warmup BOOLEAN NOT NULL DEFAULT FALSE,
  
  quality set_quality NOT NULL DEFAULT 'effective',
  quality_reason TEXT NOT NULL DEFAULT '',
  
  note TEXT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(exercise_block_id, set_number)
);

CREATE INDEX idx_set_logs_block ON set_logs(exercise_block_id);
CREATE INDEX idx_set_logs_logged_at ON set_logs(logged_at DESC);

-- ============================================
-- EXERCISE PERFORMANCE SNAPSHOTS
-- ============================================

CREATE TABLE exercise_performance_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  
  session_date DATE NOT NULL,
  top_set_weight_kg DECIMAL(6,2) NOT NULL,
  top_set_reps INTEGER NOT NULL,
  top_set_rpe DECIMAL(3,1) NOT NULL,
  total_working_sets INTEGER NOT NULL DEFAULT 0,
  estimated_e1rm DECIMAL(6,2) NOT NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id, exercise_id, session_date)
);

CREATE INDEX idx_performance_user_exercise ON exercise_performance_snapshots(user_id, exercise_id);
CREATE INDEX idx_performance_date ON exercise_performance_snapshots(user_id, session_date DESC);
CREATE INDEX idx_performance_e1rm ON exercise_performance_snapshots(user_id, exercise_id, estimated_e1rm DESC);

-- ============================================
-- WEEKLY MUSCLE VOLUME
-- ============================================

CREATE TABLE weekly_muscle_volume (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  muscle_group TEXT NOT NULL,
  total_sets INTEGER NOT NULL DEFAULT 0,
  status volume_status NOT NULL DEFAULT 'effective',
  
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  PRIMARY KEY (user_id, week_start, muscle_group)
);

CREATE INDEX idx_weekly_volume_user_week ON weekly_muscle_volume(user_id, week_start DESC);

-- ============================================
-- PLATEAU ALERTS
-- ============================================

CREATE TABLE plateau_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  weeks_since_progress INTEGER NOT NULL DEFAULT 0,
  suggested_actions TEXT[] NOT NULL DEFAULT '{}',
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  
  UNIQUE(user_id, exercise_id, dismissed) -- Only one active alert per exercise
);

CREATE INDEX idx_plateau_alerts_user ON plateau_alerts(user_id, dismissed);
CREATE INDEX idx_plateau_alerts_exercise ON plateau_alerts(exercise_id);

-- ============================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bodyweight_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE mesocycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE set_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_performance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_muscle_volume ENABLE ROW LEVEL SECURITY;
ALTER TABLE plateau_alerts ENABLE ROW LEVEL SECURITY;

-- Exercises are public (read-only for all, admin can modify)
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Bodyweight entries policies
CREATE POLICY "Users can view own bodyweight entries" ON bodyweight_entries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own bodyweight entries" ON bodyweight_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own bodyweight entries" ON bodyweight_entries
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own bodyweight entries" ON bodyweight_entries
  FOR DELETE USING (auth.uid() = user_id);

-- Mesocycles policies
CREATE POLICY "Users can view own mesocycles" ON mesocycles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mesocycles" ON mesocycles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mesocycles" ON mesocycles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own mesocycles" ON mesocycles
  FOR DELETE USING (auth.uid() = user_id);

-- Workout sessions policies
CREATE POLICY "Users can view own workout sessions" ON workout_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own workout sessions" ON workout_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workout sessions" ON workout_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own workout sessions" ON workout_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- Exercise blocks policies (through workout session ownership)
CREATE POLICY "Users can view own exercise blocks" ON exercise_blocks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workout_sessions ws 
      WHERE ws.id = exercise_blocks.workout_session_id 
      AND ws.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own exercise blocks" ON exercise_blocks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workout_sessions ws 
      WHERE ws.id = exercise_blocks.workout_session_id 
      AND ws.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own exercise blocks" ON exercise_blocks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workout_sessions ws 
      WHERE ws.id = exercise_blocks.workout_session_id 
      AND ws.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own exercise blocks" ON exercise_blocks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM workout_sessions ws 
      WHERE ws.id = exercise_blocks.workout_session_id 
      AND ws.user_id = auth.uid()
    )
  );

-- Set logs policies (through exercise block -> workout session ownership)
CREATE POLICY "Users can view own set logs" ON set_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM exercise_blocks eb
      JOIN workout_sessions ws ON ws.id = eb.workout_session_id
      WHERE eb.id = set_logs.exercise_block_id 
      AND ws.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own set logs" ON set_logs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM exercise_blocks eb
      JOIN workout_sessions ws ON ws.id = eb.workout_session_id
      WHERE eb.id = set_logs.exercise_block_id 
      AND ws.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own set logs" ON set_logs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM exercise_blocks eb
      JOIN workout_sessions ws ON ws.id = eb.workout_session_id
      WHERE eb.id = set_logs.exercise_block_id 
      AND ws.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own set logs" ON set_logs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM exercise_blocks eb
      JOIN workout_sessions ws ON ws.id = eb.workout_session_id
      WHERE eb.id = set_logs.exercise_block_id 
      AND ws.user_id = auth.uid()
    )
  );

-- Exercise performance snapshots policies
CREATE POLICY "Users can view own performance snapshots" ON exercise_performance_snapshots
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own performance snapshots" ON exercise_performance_snapshots
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own performance snapshots" ON exercise_performance_snapshots
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own performance snapshots" ON exercise_performance_snapshots
  FOR DELETE USING (auth.uid() = user_id);

-- Weekly muscle volume policies
CREATE POLICY "Users can view own weekly volume" ON weekly_muscle_volume
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own weekly volume" ON weekly_muscle_volume
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own weekly volume" ON weekly_muscle_volume
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own weekly volume" ON weekly_muscle_volume
  FOR DELETE USING (auth.uid() = user_id);

-- Plateau alerts policies
CREATE POLICY "Users can view own plateau alerts" ON plateau_alerts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own plateau alerts" ON plateau_alerts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own plateau alerts" ON plateau_alerts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own plateau alerts" ON plateau_alerts
  FOR DELETE USING (auth.uid() = user_id);

-- Exercises are public for reading
CREATE POLICY "Anyone can view exercises" ON exercises
  FOR SELECT USING (true);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to create user profile on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create user profile
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to calculate E1RM (Epley formula)
CREATE OR REPLACE FUNCTION calculate_e1rm(weight DECIMAL, reps INTEGER, rpe DECIMAL DEFAULT 10)
RETURNS DECIMAL AS $$
DECLARE
  rir DECIMAL;
  effective_reps INTEGER;
BEGIN
  -- Calculate RIR from RPE
  rir := 10 - rpe;
  -- Add RIR to reps for effective reps
  effective_reps := reps + ROUND(rir);
  -- Epley formula: weight * (1 + reps/30)
  IF effective_reps = 1 THEN
    RETURN weight;
  END IF;
  RETURN ROUND(weight * (1 + effective_reps::DECIMAL / 30), 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to update workout session completion percent
CREATE OR REPLACE FUNCTION update_session_completion()
RETURNS TRIGGER AS $$
DECLARE
  session_id UUID;
  total_target_sets INTEGER;
  completed_sets INTEGER;
  new_percent INTEGER;
BEGIN
  -- Get the session ID
  IF TG_OP = 'DELETE' THEN
    SELECT workout_session_id INTO session_id FROM exercise_blocks WHERE id = OLD.exercise_block_id;
  ELSE
    SELECT workout_session_id INTO session_id FROM exercise_blocks WHERE id = NEW.exercise_block_id;
  END IF;
  
  -- Calculate totals
  SELECT COALESCE(SUM(target_sets), 0) INTO total_target_sets
  FROM exercise_blocks WHERE workout_session_id = session_id;
  
  SELECT COUNT(*) INTO completed_sets
  FROM set_logs sl
  JOIN exercise_blocks eb ON eb.id = sl.exercise_block_id
  WHERE eb.workout_session_id = session_id AND sl.is_warmup = FALSE;
  
  -- Calculate percentage
  IF total_target_sets > 0 THEN
    new_percent := LEAST(100, ROUND(completed_sets::DECIMAL / total_target_sets * 100));
  ELSE
    new_percent := 0;
  END IF;
  
  -- Update session
  UPDATE workout_sessions SET completion_percent = new_percent WHERE id = session_id;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_completion_on_set_log
  AFTER INSERT OR UPDATE OR DELETE ON set_logs
  FOR EACH ROW EXECUTE FUNCTION update_session_completion();

