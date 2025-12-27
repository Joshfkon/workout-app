-- Add video URLs for remaining exercises without demos
-- Note: These videos need to be downloaded first using the fetch-musclewiki-gifs.mjs script
-- The script will generate MP4 files, then this migration should be updated to use .mp4 extensions

-- IMPORTANT: Before running this migration:
-- 1. Run: node scripts/fetch-musclewiki-gifs.mjs (with updated EXERCISE_MAPPINGS for these exercises)
-- 2. Verify the MP4 files exist in public/exercise-demos/
-- 3. Update file extensions from .gif to .mp4 in this migration
-- 4. Verify exercise names match exactly what's in the database

-- Chest
UPDATE exercises SET demo_gif_url = '/exercise-demos/machine-chest-press.mp4' WHERE name = 'Machine Chest Press';

-- Back
UPDATE exercises SET demo_gif_url = '/exercise-demos/chest-supported-row.mp4' WHERE name = 'Chest Supported Row';

-- Shoulders
UPDATE exercises SET demo_gif_url = '/exercise-demos/dumbbell-shoulder-press.mp4' WHERE name = 'Dumbbell Shoulder Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/face-pull.mp4' WHERE name = 'Face Pull';

-- Biceps
UPDATE exercises SET demo_gif_url = '/exercise-demos/cable-curl.mp4' WHERE name = 'Cable Curl';
UPDATE exercises SET demo_gif_url = '/exercise-demos/incline-dumbbell-curl.mp4' WHERE name = 'Incline Dumbbell Curl';
UPDATE exercises SET demo_gif_url = '/exercise-demos/preacher-curl.mp4' WHERE name = 'Preacher Curl';

-- Triceps
UPDATE exercises SET demo_gif_url = '/exercise-demos/close-grip-bench-press.mp4' WHERE name = 'Close Grip Bench Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/dips--tricep-focus-.mp4' WHERE name = 'Dips (Tricep Focus)';
UPDATE exercises SET demo_gif_url = '/exercise-demos/overhead-tricep-extension.mp4' WHERE name = 'Overhead Tricep Extension';
UPDATE exercises SET demo_gif_url = '/exercise-demos/skull-crusher.mp4' WHERE name = 'Skull Crusher';

-- Quads
UPDATE exercises SET demo_gif_url = '/exercise-demos/bulgarian-split-squat.mp4' WHERE name = 'Bulgarian Split Squat';
UPDATE exercises SET demo_gif_url = '/exercise-demos/hack-squat.mp4' WHERE name = 'Hack Squat';
UPDATE exercises SET demo_gif_url = '/exercise-demos/walking-lunges.mp4' WHERE name = 'Walking Lunges';

-- Hamstrings
UPDATE exercises SET demo_gif_url = '/exercise-demos/good-morning.mp4' WHERE name = 'Good Morning';
UPDATE exercises SET demo_gif_url = '/exercise-demos/seated-leg-curl.mp4' WHERE name = 'Seated Leg Curl';

-- Glutes
UPDATE exercises SET demo_gif_url = '/exercise-demos/cable-pull-through.mp4' WHERE name = 'Cable Pull Through';
UPDATE exercises SET demo_gif_url = '/exercise-demos/glute-bridge.mp4' WHERE name = 'Glute Bridge';
UPDATE exercises SET demo_gif_url = '/exercise-demos/hip-thrust.mp4' WHERE name = 'Hip Thrust';

-- Calves
UPDATE exercises SET demo_gif_url = '/exercise-demos/leg-press-calf-raise.mp4' WHERE name = 'Leg Press Calf Raise';
UPDATE exercises SET demo_gif_url = '/exercise-demos/seated-calf-raise.mp4' WHERE name = 'Seated Calf Raise';
UPDATE exercises SET demo_gif_url = '/exercise-demos/standing-calf-raise.mp4' WHERE name = 'Standing Calf Raise';

-- Abs
UPDATE exercises SET demo_gif_url = '/exercise-demos/ab-wheel-rollout.mp4' WHERE name = 'Ab Wheel Rollout';
UPDATE exercises SET demo_gif_url = '/exercise-demos/cable-crunch.mp4' WHERE name = 'Cable Crunch';
UPDATE exercises SET demo_gif_url = '/exercise-demos/hanging-leg-raise.mp4' WHERE name = 'Hanging Leg Raise';
UPDATE exercises SET demo_gif_url = '/exercise-demos/plank.mp4' WHERE name = 'Plank';
