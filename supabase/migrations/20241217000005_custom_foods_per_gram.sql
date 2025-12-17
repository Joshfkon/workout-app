-- Add per-gram nutrition tracking to custom foods
-- This allows users to enter "per 100g" nutrition and then log arbitrary gram amounts

-- Add per-gram columns to custom_foods
ALTER TABLE custom_foods
ADD COLUMN IF NOT EXISTS is_per_gram BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS calories_per_100g NUMERIC,
ADD COLUMN IF NOT EXISTS protein_per_100g NUMERIC,
ADD COLUMN IF NOT EXISTS carbs_per_100g NUMERIC,
ADD COLUMN IF NOT EXISTS fat_per_100g NUMERIC;

-- Create index for frequent foods query
CREATE INDEX IF NOT EXISTS idx_food_log_user_meal_food ON food_log(user_id, meal_type, food_name);

-- Create a view for frequent foods per user per meal type
-- This counts how many times each food was logged for each meal type
CREATE OR REPLACE VIEW frequent_foods AS
SELECT 
  user_id,
  meal_type,
  food_name,
  serving_size,
  AVG(calories / NULLIF(servings, 0)) as avg_calories,
  AVG(protein / NULLIF(servings, 0)) as avg_protein,
  AVG(carbs / NULLIF(servings, 0)) as avg_carbs,
  AVG(fat / NULLIF(servings, 0)) as avg_fat,
  COUNT(*) as times_logged,
  MAX(created_at) as last_logged
FROM food_log
WHERE food_name IS NOT NULL AND food_name != ''
GROUP BY user_id, meal_type, food_name, serving_size
ORDER BY times_logged DESC;

COMMENT ON TABLE custom_foods IS 'User-created custom foods with optional per-gram nutrition data';
COMMENT ON COLUMN custom_foods.is_per_gram IS 'If true, nutrition values are stored per 100g for flexible portion logging';
COMMENT ON COLUMN custom_foods.calories_per_100g IS 'Calories per 100 grams (only used if is_per_gram is true)';

