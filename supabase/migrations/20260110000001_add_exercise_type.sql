-- Add exercise_type column to exercises table
-- This allows distinguishing between rep-based exercises (e.g., bench press)
-- and duration-based exercises (e.g., plank, wall sit, isometric holds)

-- Create the enum type for exercise_type
DO $$ BEGIN
    CREATE TYPE exercise_type AS ENUM ('rep_based', 'duration_based');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add the exercise_type column with default value of 'rep_based'
ALTER TABLE exercises
ADD COLUMN IF NOT EXISTS exercise_type exercise_type NOT NULL DEFAULT 'rep_based';

-- Update known duration-based exercises
-- These exercises track time (seconds) instead of reps
--
-- Note: this list once named ~30 exercises, most of which were never seeded
-- anywhere — those UPDATEs matched zero rows. The dead names were removed
-- (20260723) to keep the migration honest; exercises added after this
-- migration are inserted with exercise_type = 'duration_based' directly.
UPDATE exercises
SET exercise_type = 'duration_based'
WHERE name IN (
    'Plank',
    'Side Plank',
    'Farmer''s Carry',
    'Suitcase Carry'
);

-- Add index for filtering by exercise type
CREATE INDEX IF NOT EXISTS idx_exercises_exercise_type ON exercises(exercise_type);

-- Add comment for documentation
COMMENT ON COLUMN exercises.exercise_type IS 'Exercise type: rep_based (default) for exercises counted in reps, duration_based for exercises tracked by time/seconds held';
