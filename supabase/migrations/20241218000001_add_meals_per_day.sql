-- Add meals_per_day column to nutrition_targets table
ALTER TABLE nutrition_targets 
ADD COLUMN IF NOT EXISTS meals_per_day INTEGER DEFAULT 3;

-- Add a comment for documentation
COMMENT ON COLUMN nutrition_targets.meals_per_day IS 'Number of meals the user plans to eat per day (for calorie distribution suggestions)';

