-- ============================================================
-- NUTRITION TRACKING TABLES
-- ============================================================

-- Food log entries (daily food tracking)
CREATE TABLE IF NOT EXISTS food_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_at DATE NOT NULL DEFAULT CURRENT_DATE,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  food_name TEXT NOT NULL,
  serving_size TEXT,
  servings NUMERIC(6,2) NOT NULL DEFAULT 1,
  calories INTEGER NOT NULL DEFAULT 0,
  protein NUMERIC(6,1),
  carbs NUMERIC(6,1),
  fat NUMERIC(6,1),
  fiber NUMERIC(6,1),
  sugar NUMERIC(6,1),
  sodium NUMERIC(8,1),
  source TEXT DEFAULT 'manual', -- 'fatsecret', 'nutritionix', 'custom', 'manual'
  food_id TEXT, -- FatSecret food_id
  nutritionix_id TEXT, -- Legacy Nutritionix ID
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_calories CHECK (calories >= 0),
  CONSTRAINT valid_servings CHECK (servings > 0)
);

-- Indexes for food_log
CREATE INDEX IF NOT EXISTS idx_food_log_user_date ON food_log(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_food_log_food_id ON food_log(food_id) WHERE food_id IS NOT NULL;

-- Enable RLS
ALTER TABLE food_log ENABLE ROW LEVEL SECURITY;

-- RLS policies for food_log
CREATE POLICY "Users can view their own food log"
  ON food_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own food log"
  ON food_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own food log"
  ON food_log FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own food log"
  ON food_log FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- CUSTOM FOODS (user-created foods)
-- ============================================================

CREATE TABLE IF NOT EXISTS custom_foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_name TEXT NOT NULL,
  serving_size TEXT,
  calories INTEGER NOT NULL DEFAULT 0,
  protein NUMERIC(6,1),
  carbs NUMERIC(6,1),
  fat NUMERIC(6,1),
  fiber NUMERIC(6,1),
  sugar NUMERIC(6,1),
  sodium NUMERIC(8,1),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_custom_calories CHECK (calories >= 0)
);

-- Index for custom_foods
CREATE INDEX IF NOT EXISTS idx_custom_foods_user ON custom_foods(user_id);

-- Enable RLS
ALTER TABLE custom_foods ENABLE ROW LEVEL SECURITY;

-- RLS policies for custom_foods
CREATE POLICY "Users can view their own custom foods"
  ON custom_foods FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own custom foods"
  ON custom_foods FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own custom foods"
  ON custom_foods FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own custom foods"
  ON custom_foods FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- WEIGHT LOG (daily weight tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS weight_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_at DATE NOT NULL DEFAULT CURRENT_DATE,
  weight NUMERIC(5,1) NOT NULL, -- in user's preferred unit (lbs or kg)
  unit TEXT NOT NULL DEFAULT 'lb' CHECK (unit IN ('lb', 'kg')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint: one weight entry per user per day
  CONSTRAINT unique_weight_per_day UNIQUE (user_id, logged_at),
  CONSTRAINT valid_weight CHECK (weight > 0 AND weight < 1000)
);

-- Index for weight_log
CREATE INDEX IF NOT EXISTS idx_weight_log_user_date ON weight_log(user_id, logged_at DESC);

-- Enable RLS
ALTER TABLE weight_log ENABLE ROW LEVEL SECURITY;

-- RLS policies for weight_log
CREATE POLICY "Users can view their own weight log"
  ON weight_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own weight log"
  ON weight_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own weight log"
  ON weight_log FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own weight log"
  ON weight_log FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- NUTRITION TARGETS (daily macro goals)
-- ============================================================

CREATE TABLE IF NOT EXISTS nutrition_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  calories INTEGER,
  protein INTEGER,
  carbs INTEGER,
  fat INTEGER,
  fiber INTEGER,
  sugar INTEGER,
  sodium INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_target_calories CHECK (calories IS NULL OR calories > 0),
  CONSTRAINT valid_target_protein CHECK (protein IS NULL OR protein >= 0),
  CONSTRAINT valid_target_carbs CHECK (carbs IS NULL OR carbs >= 0),
  CONSTRAINT valid_target_fat CHECK (fat IS NULL OR fat >= 0)
);

-- Enable RLS
ALTER TABLE nutrition_targets ENABLE ROW LEVEL SECURITY;

-- RLS policies for nutrition_targets
CREATE POLICY "Users can view their own nutrition targets"
  ON nutrition_targets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own nutrition targets"
  ON nutrition_targets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own nutrition targets"
  ON nutrition_targets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own nutrition targets"
  ON nutrition_targets FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- Comments for documentation
-- ============================================================

COMMENT ON TABLE food_log IS 'Daily food intake tracking';
COMMENT ON COLUMN food_log.source IS 'Source of food data: fatsecret, nutritionix, custom, or manual';
COMMENT ON COLUMN food_log.food_id IS 'FatSecret food_id for API-sourced foods';

COMMENT ON TABLE custom_foods IS 'User-created custom food items';
COMMENT ON TABLE weight_log IS 'Daily weight tracking';
COMMENT ON TABLE nutrition_targets IS 'Daily nutrition goals per user';

