-- Add video URLs for remaining exercises without demos
-- Follows the same pattern as 20251226000002_update_to_musclewiki_gifs.sql

-- Chest
UPDATE exercises SET demo_gif_url = '/exercise-demos/machine-chest-press.gif' WHERE name = 'Machine Chest Press';

-- Back
UPDATE exercises SET demo_gif_url = '/exercise-demos/chest-supported-row.gif' WHERE name = 'Chest Supported Row';

-- Shoulders
UPDATE exercises SET demo_gif_url = '/exercise-demos/dumbbell-shoulder-press.gif' WHERE name = 'Dumbbell Shoulder Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/face-pull.gif' WHERE name = 'Face Pull';

-- Biceps
UPDATE exercises SET demo_gif_url = '/exercise-demos/cable-curl.gif' WHERE name = 'Cable Curl';
UPDATE exercises SET demo_gif_url = '/exercise-demos/incline-dumbbell-curl.gif' WHERE name = 'Incline Dumbbell Curl';
UPDATE exercises SET demo_gif_url = '/exercise-demos/preacher-curl.gif' WHERE name = 'Preacher Curl';

-- Triceps
UPDATE exercises SET demo_gif_url = '/exercise-demos/close-grip-bench-press.gif' WHERE name = 'Close Grip Bench Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/dips--tricep-focus-.gif' WHERE name = 'Dips (Tricep Focus)';
UPDATE exercises SET demo_gif_url = '/exercise-demos/overhead-tricep-extension.gif' WHERE name = 'Overhead Tricep Extension';
UPDATE exercises SET demo_gif_url = '/exercise-demos/skull-crusher.gif' WHERE name = 'Skull Crusher';

-- Quads
UPDATE exercises SET demo_gif_url = '/exercise-demos/bulgarian-split-squat.gif' WHERE name = 'Bulgarian Split Squat';
UPDATE exercises SET demo_gif_url = '/exercise-demos/hack-squat.gif' WHERE name = 'Hack Squat';
UPDATE exercises SET demo_gif_url = '/exercise-demos/walking-lunges.gif' WHERE name = 'Walking Lunges';

-- Hamstrings
UPDATE exercises SET demo_gif_url = '/exercise-demos/good-morning.gif' WHERE name = 'Good Morning';
UPDATE exercises SET demo_gif_url = '/exercise-demos/seated-leg-curl.gif' WHERE name = 'Seated Leg Curl';

-- Glutes
UPDATE exercises SET demo_gif_url = '/exercise-demos/cable-pull-through.gif' WHERE name = 'Cable Pull Through';
UPDATE exercises SET demo_gif_url = '/exercise-demos/glute-bridge.gif' WHERE name = 'Glute Bridge';
UPDATE exercises SET demo_gif_url = '/exercise-demos/hip-thrust.gif' WHERE name = 'Hip Thrust';

-- Calves
UPDATE exercises SET demo_gif_url = '/exercise-demos/leg-press-calf-raise.gif' WHERE name = 'Leg Press Calf Raise';
UPDATE exercises SET demo_gif_url = '/exercise-demos/seated-calf-raise.gif' WHERE name = 'Seated Calf Raise';
UPDATE exercises SET demo_gif_url = '/exercise-demos/standing-calf-raise.gif' WHERE name = 'Standing Calf Raise';

-- Abs
UPDATE exercises SET demo_gif_url = '/exercise-demos/ab-wheel-rollout.gif' WHERE name = 'Ab Wheel Rollout';
UPDATE exercises SET demo_gif_url = '/exercise-demos/cable-crunch.gif' WHERE name = 'Cable Crunch';
UPDATE exercises SET demo_gif_url = '/exercise-demos/hanging-leg-raise.gif' WHERE name = 'Hanging Leg Raise';
UPDATE exercises SET demo_gif_url = '/exercise-demos/plank.gif' WHERE name = 'Plank';
