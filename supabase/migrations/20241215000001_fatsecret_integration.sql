-- Add food_id column to food_log for FatSecret integration
-- This column stores the FatSecret food_id for API foods

ALTER TABLE food_log 
ADD COLUMN IF NOT EXISTS food_id TEXT;

-- Update the source CHECK constraint to include 'fatsecret'
-- First drop the old constraint if it exists
ALTER TABLE food_log 
DROP CONSTRAINT IF EXISTS food_log_source_check;

-- No constraint needed since we're using TEXT type and checking in application

-- Create an index for faster lookups by food_id
CREATE INDEX IF NOT EXISTS idx_food_log_food_id 
ON food_log(food_id) 
WHERE food_id IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN food_log.food_id IS 'FatSecret food_id for API-sourced foods';

