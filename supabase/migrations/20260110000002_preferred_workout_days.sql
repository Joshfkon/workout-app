-- Add preferred_workout_days column to mesocycles table
-- Allows users to specify which days of the week they want to work out
-- e.g., ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] for weekdays only

ALTER TABLE mesocycles ADD COLUMN IF NOT EXISTS preferred_workout_days TEXT[] DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN mesocycles.preferred_workout_days IS
  'User-selected workout days (e.g., [''Monday'', ''Tuesday'', ''Wednesday'', ''Thursday'', ''Friday'']). NULL means use default schedule patterns.';
