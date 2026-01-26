-- Add exercise_overrides column to mesocycles table
-- This stores user's exercise swap preferences for future sessions

ALTER TABLE mesocycles
ADD COLUMN IF NOT EXISTS exercise_overrides JSONB DEFAULT '[]'::jsonb;

-- Add comment explaining the column
COMMENT ON COLUMN mesocycles.exercise_overrides IS 'Array of exercise overrides: [{originalExerciseId, originalExerciseName, replacementExerciseId, replacementExerciseName, createdAt}]';
