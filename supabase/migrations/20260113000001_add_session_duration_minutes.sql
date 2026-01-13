-- Add session_duration_minutes to mesocycles table
-- This stores the user's preferred workout duration for the mesocycle

ALTER TABLE mesocycles
ADD COLUMN IF NOT EXISTS session_duration_minutes INTEGER DEFAULT 60;

-- Add a comment for documentation
COMMENT ON COLUMN mesocycles.session_duration_minutes IS 'Target workout duration in minutes (15-120), used for exercise planning';
