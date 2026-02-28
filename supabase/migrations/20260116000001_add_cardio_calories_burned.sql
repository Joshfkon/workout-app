-- Add calories_burned field to cardio_log for manual cardio calorie tracking
-- This allows the enhanced TDEE model to use manually logged cardio data

ALTER TABLE cardio_log
ADD COLUMN IF NOT EXISTS calories_burned INTEGER;

COMMENT ON COLUMN cardio_log.calories_burned IS 'Estimated calories burned during cardio session (optional, for TDEE calculation)';

-- Add an index for efficient aggregation by date
CREATE INDEX IF NOT EXISTS idx_cardio_log_user_date_calories
ON cardio_log(user_id, logged_at)
WHERE calories_burned IS NOT NULL;
