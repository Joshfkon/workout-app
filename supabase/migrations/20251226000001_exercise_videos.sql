-- Add video demonstration fields to exercises table
-- Supports demo images and YouTube videos

-- Add video URL fields
ALTER TABLE exercises
ADD COLUMN IF NOT EXISTS demo_gif_url TEXT,
ADD COLUMN IF NOT EXISTS demo_thumbnail_url TEXT,
ADD COLUMN IF NOT EXISTS youtube_video_id TEXT;

-- Add comments for documentation
COMMENT ON COLUMN exercises.demo_gif_url IS 'URL to demonstration GIF/animation (from MuscleWiki, Supabase Storage, etc.)';
COMMENT ON COLUMN exercises.demo_thumbnail_url IS 'URL to thumbnail image for the demo (optional, can be generated from GIF)';
COMMENT ON COLUMN exercises.youtube_video_id IS 'YouTube video ID for form tutorials (e.g., "dQw4w9WgXcQ" from youtube.com/watch?v=dQw4w9WgXcQ)';

-- Populate with demo images from free-exercise-db (Public Domain)
-- Source: https://github.com/yuhonas/free-exercise-db

-- Chest
-- Note: File extensions may be .gif, .jpg, or .png depending on source
-- Update these paths after running the fetch script to match actual file extensions
UPDATE exercises SET demo_gif_url = '/exercise-demos/barbell-bench-press.jpg' WHERE name = 'Barbell Bench Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/dumbbell-bench-press.jpg' WHERE name = 'Dumbbell Bench Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/incline-dumbbell-press.jpg' WHERE name = 'Incline Dumbbell Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/cable-fly.jpg' WHERE name = 'Cable Fly';
UPDATE exercises SET demo_gif_url = '/exercise-demos/dips--chest-focus-.jpg' WHERE name = 'Dips (Chest Focus)';

-- Back
UPDATE exercises SET demo_gif_url = '/exercise-demos/barbell-row.jpg' WHERE name = 'Barbell Row';
UPDATE exercises SET demo_gif_url = '/exercise-demos/dumbbell-row.jpg' WHERE name = 'Dumbbell Row';
UPDATE exercises SET demo_gif_url = '/exercise-demos/lat-pulldown.jpg' WHERE name = 'Lat Pulldown';
UPDATE exercises SET demo_gif_url = '/exercise-demos/pull-ups.jpg' WHERE name = 'Pull-Ups';
UPDATE exercises SET demo_gif_url = '/exercise-demos/deadlift.jpg' WHERE name = 'Deadlift';
UPDATE exercises SET demo_gif_url = '/exercise-demos/cable-row.jpg' WHERE name = 'Cable Row';

-- Shoulders
UPDATE exercises SET demo_gif_url = '/exercise-demos/overhead-press.jpg' WHERE name = 'Overhead Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/lateral-raise.jpg' WHERE name = 'Lateral Raise';
UPDATE exercises SET demo_gif_url = '/exercise-demos/rear-delt-fly.jpg' WHERE name = 'Rear Delt Fly';

-- Legs
UPDATE exercises SET demo_gif_url = '/exercise-demos/barbell-back-squat.jpg' WHERE name = 'Barbell Back Squat';
UPDATE exercises SET demo_gif_url = '/exercise-demos/leg-press.jpg' WHERE name = 'Leg Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/romanian-deadlift.jpg' WHERE name = 'Romanian Deadlift';
UPDATE exercises SET demo_gif_url = '/exercise-demos/lying-leg-curl.jpg' WHERE name = 'Lying Leg Curl';
UPDATE exercises SET demo_gif_url = '/exercise-demos/leg-extension.jpg' WHERE name = 'Leg Extension';
UPDATE exercises SET demo_gif_url = '/exercise-demos/dumbbell-lunges.jpg' WHERE name = 'Dumbbell Lunges';
UPDATE exercises SET demo_gif_url = '/exercise-demos/calf-raise.jpg' WHERE name = 'Calf Raise';

-- Arms
UPDATE exercises SET demo_gif_url = '/exercise-demos/barbell-curl.jpg' WHERE name = 'Barbell Curl';
UPDATE exercises SET demo_gif_url = '/exercise-demos/dumbbell-curl.jpg' WHERE name = 'Dumbbell Curl';
UPDATE exercises SET demo_gif_url = '/exercise-demos/hammer-curl.jpg' WHERE name = 'Hammer Curl';
UPDATE exercises SET demo_gif_url = '/exercise-demos/tricep-pushdown.jpg' WHERE name = 'Tricep Pushdown';
UPDATE exercises SET demo_gif_url = '/exercise-demos/skull-crushers.jpg' WHERE name = 'Skull Crushers';

-- Create index for exercises with videos (for filtering)
CREATE INDEX IF NOT EXISTS idx_exercises_has_demo ON exercises ((demo_gif_url IS NOT NULL));
