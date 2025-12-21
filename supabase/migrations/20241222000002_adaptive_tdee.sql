-- Adaptive TDEE Estimation Tables
-- Stores personalized TDEE estimates calculated from user's weight and calorie data

-- Table to store TDEE estimates
CREATE TABLE IF NOT EXISTS tdee_estimates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Core estimate values
    burn_rate_per_lb NUMERIC(5, 2) NOT NULL, -- Personal burn rate (cal/lb)
    estimated_tdee INTEGER NOT NULL, -- Current TDEE estimate
    current_weight NUMERIC(6, 2) NOT NULL, -- Weight used for calculation (lbs)

    -- Confidence metrics
    confidence TEXT NOT NULL CHECK (confidence IN ('unstable', 'stabilizing', 'stable')),
    confidence_score INTEGER NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
    standard_error NUMERIC(6, 3) NOT NULL, -- Prediction accuracy

    -- Data info
    data_points_used INTEGER NOT NULL,
    window_days INTEGER NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('regression', 'formula')),

    -- History for convergence chart (stored as JSONB array)
    estimate_history JSONB DEFAULT '[]'::jsonb,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Only one estimate per user (most recent)
    UNIQUE(user_id)
);

-- Table to store weight predictions
CREATE TABLE IF NOT EXISTS weight_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Prediction details
    target_date DATE NOT NULL,
    predicted_weight NUMERIC(6, 2) NOT NULL,
    confidence_low NUMERIC(6, 2) NOT NULL,
    confidence_high NUMERIC(6, 2) NOT NULL,
    assumed_daily_calories INTEGER NOT NULL,
    days_from_creation INTEGER NOT NULL,

    -- Reference to TDEE estimate used
    tdee_estimate_id UUID REFERENCES tdee_estimates(id) ON DELETE SET NULL,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table to store goal predictions (when will I reach X weight?)
CREATE TABLE IF NOT EXISTS goal_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Goal details
    target_weight NUMERIC(6, 2) NOT NULL,
    estimated_date DATE NOT NULL,
    days_required INTEGER NOT NULL,
    confidence_earliest DATE NOT NULL,
    confidence_latest DATE NOT NULL,
    required_daily_calories INTEGER NOT NULL,

    -- Starting point
    starting_weight NUMERIC(6, 2) NOT NULL,

    -- Reference to TDEE estimate used
    tdee_estimate_id UUID REFERENCES tdee_estimates(id) ON DELETE SET NULL,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Only keep latest goal per user
    UNIQUE(user_id)
);

-- Enable Row Level Security
ALTER TABLE tdee_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_predictions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tdee_estimates
CREATE POLICY "Users can view own TDEE estimates"
    ON tdee_estimates FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own TDEE estimates"
    ON tdee_estimates FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own TDEE estimates"
    ON tdee_estimates FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own TDEE estimates"
    ON tdee_estimates FOR DELETE
    USING (auth.uid() = user_id);

-- RLS Policies for weight_predictions
CREATE POLICY "Users can view own weight predictions"
    ON weight_predictions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own weight predictions"
    ON weight_predictions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own weight predictions"
    ON weight_predictions FOR DELETE
    USING (auth.uid() = user_id);

-- RLS Policies for goal_predictions
CREATE POLICY "Users can view own goal predictions"
    ON goal_predictions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own goal predictions"
    ON goal_predictions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own goal predictions"
    ON goal_predictions FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own goal predictions"
    ON goal_predictions FOR DELETE
    USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_tdee_estimates_user_id ON tdee_estimates(user_id);
CREATE INDEX idx_weight_predictions_user_id ON weight_predictions(user_id);
CREATE INDEX idx_weight_predictions_target_date ON weight_predictions(target_date);
CREATE INDEX idx_goal_predictions_user_id ON goal_predictions(user_id);

-- Trigger to update updated_at on tdee_estimates
CREATE OR REPLACE FUNCTION update_tdee_estimate_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tdee_estimates_updated_at
    BEFORE UPDATE ON tdee_estimates
    FOR EACH ROW
    EXECUTE FUNCTION update_tdee_estimate_updated_at();

-- Comment on tables
COMMENT ON TABLE tdee_estimates IS 'Stores adaptive TDEE estimates calculated from user weight and calorie data using least-squares regression';
COMMENT ON TABLE weight_predictions IS 'Stores future weight predictions based on planned calorie intake';
COMMENT ON TABLE goal_predictions IS 'Stores predictions for when users will reach their target weight';
