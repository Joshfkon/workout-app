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
UPDATE exercises
SET exercise_type = 'duration_based'
WHERE name IN (
    'Plank',
    'Side Plank',
    'Side Plank (Left)',
    'Side Plank (Right)',
    'Wall Sit',
    'Dead Hang',
    'L-Sit',
    'L-Sit Hold',
    'Hollow Body Hold',
    'Superman Hold',
    'Glute Bridge Hold',
    'Single Leg Glute Bridge Hold',
    'Pallof Press Hold',
    'Farmer''s Carry',
    'Farmer''s Walk',
    'Suitcase Carry',
    'Waiter''s Walk',
    'Overhead Carry',
    'Rack Carry',
    'Static Lunge Hold',
    'Isometric Squat Hold',
    'Wall Squat',
    'Copenhagen Plank',
    'Bird Dog Hold',
    'Bear Crawl Hold',
    'Plank with Shoulder Tap',
    'RKC Plank',
    'Body Saw',
    'Hanging Knee Raise Hold',
    'Hanging L-Sit'
);

-- Add index for filtering by exercise type
CREATE INDEX IF NOT EXISTS idx_exercises_exercise_type ON exercises(exercise_type);

-- Add comment for documentation
COMMENT ON COLUMN exercises.exercise_type IS 'Exercise type: rep_based (default) for exercises counted in reps, duration_based for exercises tracked by time/seconds held';
