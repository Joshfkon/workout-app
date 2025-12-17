-- Add per-weight nutrition tracking to custom foods
-- This allows users to enter nutrition for any reference amount (e.g., per 28g, per 1 oz)
-- Then log their actual weighed amount and have it calculate

-- Add per-weight columns to custom_foods
ALTER TABLE custom_foods
ADD COLUMN IF NOT EXISTS is_per_weight BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS reference_amount NUMERIC, -- e.g., 28 for "per 28g" or 100 for "per 100g"
ADD COLUMN IF NOT EXISTS reference_unit VARCHAR(10), -- 'g' or 'oz'
ADD COLUMN IF NOT EXISTS calories_per_ref NUMERIC,
ADD COLUMN IF NOT EXISTS protein_per_ref NUMERIC,
ADD COLUMN IF NOT EXISTS carbs_per_ref NUMERIC,
ADD COLUMN IF NOT EXISTS fat_per_ref NUMERIC;

-- Create index for frequent foods query
CREATE INDEX IF NOT EXISTS idx_food_log_user_meal_food ON food_log(user_id, meal_type, food_name);

COMMENT ON TABLE custom_foods IS 'User-created custom foods with optional per-weight nutrition data';
COMMENT ON COLUMN custom_foods.is_per_weight IS 'If true, nutrition values are stored per reference_amount for flexible portion logging';
COMMENT ON COLUMN custom_foods.reference_amount IS 'The amount (in reference_unit) that the nutrition values are based on (e.g., 28 for "per 28g")';
COMMENT ON COLUMN custom_foods.reference_unit IS 'Unit for reference_amount: g (grams) or oz (ounces)';
