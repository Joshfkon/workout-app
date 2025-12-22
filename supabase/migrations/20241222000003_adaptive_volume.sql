-- Adaptive Volume & Recovery Estimation Tables
-- Stores personalized volume profiles and mesocycle analyses

-- Table to store user volume profiles (learned MRV per muscle)
CREATE TABLE IF NOT EXISTS user_volume_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Profile data stored as JSONB
    muscle_tolerance JSONB NOT NULL DEFAULT '{}'::jsonb,
    global_recovery_multiplier NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
    is_enhanced BOOLEAN NOT NULL DEFAULT false,
    training_age TEXT NOT NULL DEFAULT 'intermediate' CHECK (training_age IN ('novice', 'intermediate', 'advanced')),
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Only one profile per user
    UNIQUE(user_id)
);

-- Table to store weekly muscle volume data (aggregated per week)
CREATE TABLE IF NOT EXISTS weekly_muscle_volume (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Week identification
    week_start DATE NOT NULL,
    mesocycle_id UUID REFERENCES mesocycles(id) ON DELETE SET NULL,
    
    -- Muscle group
    muscle_group TEXT NOT NULL CHECK (muscle_group IN ('chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs', 'adductors', 'forearms', 'traps')),
    
    -- Volume metrics
    total_sets INTEGER NOT NULL DEFAULT 0,
    working_sets INTEGER NOT NULL DEFAULT 0,
    effective_sets INTEGER NOT NULL DEFAULT 0,
    total_volume NUMERIC(10, 2) NOT NULL DEFAULT 0, -- Sets × reps × weight
    
    -- Performance metrics
    average_rir NUMERIC(3, 1),
    average_form_score NUMERIC(3, 2), -- 1.0 = clean, 0.5 = some_breakdown, 0 = ugly
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- One record per user/week/muscle
    UNIQUE(user_id, week_start, muscle_group)
);

-- Table to store mesocycle analyses
CREATE TABLE IF NOT EXISTS mesocycle_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    mesocycle_id UUID REFERENCES mesocycles(id) ON DELETE SET NULL,
    
    -- Analysis period
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    weeks INTEGER NOT NULL,
    
    -- Analysis results stored as JSONB
    muscle_volumes JSONB NOT NULL DEFAULT '{}'::jsonb,
    muscle_outcomes JSONB NOT NULL DEFAULT '{}'::jsonb,
    overall_recovery TEXT NOT NULL CHECK (overall_recovery IN ('under_recovered', 'well_recovered', 'under_stimulated')),
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- One analysis per mesocycle
    UNIQUE(user_id, mesocycle_id)
);

-- Enable Row Level Security
ALTER TABLE user_volume_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_muscle_volume ENABLE ROW LEVEL SECURITY;
ALTER TABLE mesocycle_analyses ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_volume_profiles
-- Drop existing policies if they exist (to allow re-running migration)
DROP POLICY IF EXISTS "Users can view own volume profiles" ON user_volume_profiles;
DROP POLICY IF EXISTS "Users can insert own volume profiles" ON user_volume_profiles;
DROP POLICY IF EXISTS "Users can update own volume profiles" ON user_volume_profiles;
DROP POLICY IF EXISTS "Users can delete own volume profiles" ON user_volume_profiles;

CREATE POLICY "Users can view own volume profiles"
    ON user_volume_profiles FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own volume profiles"
    ON user_volume_profiles FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own volume profiles"
    ON user_volume_profiles FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own volume profiles"
    ON user_volume_profiles FOR DELETE
    USING (auth.uid() = user_id);

-- RLS Policies for weekly_muscle_volume
-- Drop existing policies if they exist (to allow re-running migration)
DROP POLICY IF EXISTS "Users can view own weekly volume" ON weekly_muscle_volume;
DROP POLICY IF EXISTS "Users can insert own weekly volume" ON weekly_muscle_volume;
DROP POLICY IF EXISTS "Users can update own weekly volume" ON weekly_muscle_volume;
DROP POLICY IF EXISTS "Users can delete own weekly volume" ON weekly_muscle_volume;

CREATE POLICY "Users can view own weekly volume"
    ON weekly_muscle_volume FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own weekly volume"
    ON weekly_muscle_volume FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own weekly volume"
    ON weekly_muscle_volume FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own weekly volume"
    ON weekly_muscle_volume FOR DELETE
    USING (auth.uid() = user_id);

-- RLS Policies for mesocycle_analyses
-- Drop existing policies if they exist (to allow re-running migration)
DROP POLICY IF EXISTS "Users can view own mesocycle analyses" ON mesocycle_analyses;
DROP POLICY IF EXISTS "Users can insert own mesocycle analyses" ON mesocycle_analyses;
DROP POLICY IF EXISTS "Users can update own mesocycle analyses" ON mesocycle_analyses;
DROP POLICY IF EXISTS "Users can delete own mesocycle analyses" ON mesocycle_analyses;

CREATE POLICY "Users can view own mesocycle analyses"
    ON mesocycle_analyses FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mesocycle analyses"
    ON mesocycle_analyses FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mesocycle analyses"
    ON mesocycle_analyses FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own mesocycle analyses"
    ON mesocycle_analyses FOR DELETE
    USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_user_volume_profiles_user_id ON user_volume_profiles(user_id);
CREATE INDEX idx_weekly_muscle_volume_user_id ON weekly_muscle_volume(user_id);
CREATE INDEX idx_weekly_muscle_volume_week_start ON weekly_muscle_volume(week_start);
CREATE INDEX idx_weekly_muscle_volume_muscle_group ON weekly_muscle_volume(muscle_group);
CREATE INDEX idx_mesocycle_analyses_user_id ON mesocycle_analyses(user_id);
CREATE INDEX idx_mesocycle_analyses_mesocycle_id ON mesocycle_analyses(mesocycle_id);

-- Trigger to update updated_at on user_volume_profiles
CREATE OR REPLACE FUNCTION update_volume_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_volume_profiles_updated_at
    BEFORE UPDATE ON user_volume_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_volume_profile_updated_at();

-- Trigger to update updated_at on weekly_muscle_volume
CREATE OR REPLACE FUNCTION update_weekly_volume_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER weekly_muscle_volume_updated_at
    BEFORE UPDATE ON weekly_muscle_volume
    FOR EACH ROW
    EXECUTE FUNCTION update_weekly_volume_updated_at();

-- Comments
COMMENT ON TABLE user_volume_profiles IS 'Stores personalized volume tolerance profiles learned from user training data';
COMMENT ON TABLE weekly_muscle_volume IS 'Stores aggregated weekly volume data per muscle group for analysis';
COMMENT ON TABLE mesocycle_analyses IS 'Stores complete mesocycle analyses with volume outcomes and recovery assessments';

