-- Nutrition Tracking Tables
-- Implements food logging, custom foods, weight tracking, and nutrition targets

-- Daily food log entries
CREATE TABLE IF NOT EXISTS food_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logged_at DATE NOT NULL DEFAULT CURRENT_DATE,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  food_name TEXT NOT NULL,
  serving_size TEXT,
  servings NUMERIC(6,2) DEFAULT 1,
  calories NUMERIC(7,2) NOT NULL,
  protein NUMERIC(6,2),
  carbs NUMERIC(6,2),
  fat NUMERIC(6,2),
  source TEXT CHECK (source IN ('nutritionix', 'custom', 'manual')),
  nutritionix_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Custom foods created by user
CREATE TABLE IF NOT EXISTS custom_foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_name TEXT NOT NULL,
  serving_size TEXT,
  calories NUMERIC(7,2) NOT NULL,
  protein NUMERIC(6,2),
  carbs NUMERIC(6,2),
  fat NUMERIC(6,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Weight log (separate from nutrition, but related)
CREATE TABLE IF NOT EXISTS weight_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logged_at DATE NOT NULL DEFAULT CURRENT_DATE,
  weight NUMERIC(5,2) NOT NULL, -- in lbs
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, logged_at) -- one entry per day
);

-- Nutrition targets (can be updated by user or coaching)
CREATE TABLE IF NOT EXISTS nutrition_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calories NUMERIC(6,0),
  protein NUMERIC(6,1),
  carbs NUMERIC(6,1),
  fat NUMERIC(6,1),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id) -- one target per user
);

-- Enable RLS on all tables
ALTER TABLE food_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_targets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for food_log
CREATE POLICY "Users can view own food log entries"
  ON food_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own food log entries"
  ON food_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own food log entries"
  ON food_log FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own food log entries"
  ON food_log FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for custom_foods
CREATE POLICY "Users can view own custom foods"
  ON custom_foods FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own custom foods"
  ON custom_foods FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own custom foods"
  ON custom_foods FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own custom foods"
  ON custom_foods FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for weight_log
CREATE POLICY "Users can view own weight log"
  ON weight_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own weight log"
  ON weight_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own weight log"
  ON weight_log FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own weight log"
  ON weight_log FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for nutrition_targets
CREATE POLICY "Users can view own nutrition targets"
  ON nutrition_targets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own nutrition targets"
  ON nutrition_targets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own nutrition targets"
  ON nutrition_targets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own nutrition targets"
  ON nutrition_targets FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_food_log_user_date ON food_log(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_food_log_meal_type ON food_log(user_id, meal_type);
CREATE INDEX IF NOT EXISTS idx_custom_foods_user ON custom_foods(user_id);
CREATE INDEX IF NOT EXISTS idx_weight_log_user_date ON weight_log(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_nutrition_targets_user ON nutrition_targets(user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to auto-update updated_at
CREATE TRIGGER update_custom_foods_updated_at
  BEFORE UPDATE ON custom_foods
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nutrition_targets_updated_at
  BEFORE UPDATE ON nutrition_targets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
