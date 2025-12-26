-- Update exercise demo URLs to use MuscleWiki GIFs
-- Run this after executing scripts/fetch-musclewiki-gifs.mjs
-- This migration updates existing exercises to use .gif format from MuscleWiki

-- Note: Update these paths after running the fetch script
-- The script will generate a SQL file with the correct paths

-- Chest
UPDATE exercises SET demo_gif_url = '/exercise-demos/barbell-bench-press.gif' WHERE name = 'Barbell Bench Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/dumbbell-bench-press.gif' WHERE name = 'Dumbbell Bench Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/incline-dumbbell-press.gif' WHERE name = 'Incline Dumbbell Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/cable-fly.gif' WHERE name = 'Cable Fly';
UPDATE exercises SET demo_gif_url = '/exercise-demos/dips--chest-focus-.gif' WHERE name = 'Dips (Chest Focus)';

-- Back
UPDATE exercises SET demo_gif_url = '/exercise-demos/barbell-row.gif' WHERE name = 'Barbell Row';
UPDATE exercises SET demo_gif_url = '/exercise-demos/dumbbell-row.gif' WHERE name = 'Dumbbell Row';
UPDATE exercises SET demo_gif_url = '/exercise-demos/lat-pulldown.gif' WHERE name = 'Lat Pulldown';
UPDATE exercises SET demo_gif_url = '/exercise-demos/pull-ups.gif' WHERE name = 'Pull-Ups';
UPDATE exercises SET demo_gif_url = '/exercise-demos/cable-row.gif' WHERE name = 'Cable Row';
UPDATE exercises SET demo_gif_url = '/exercise-demos/deadlift.gif' WHERE name = 'Deadlift';

-- Shoulders
UPDATE exercises SET demo_gif_url = '/exercise-demos/overhead-press.gif' WHERE name = 'Overhead Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/lateral-raise.gif' WHERE name = 'Lateral Raise';
UPDATE exercises SET demo_gif_url = '/exercise-demos/rear-delt-fly.gif' WHERE name = 'Rear Delt Fly';

-- Legs
UPDATE exercises SET demo_gif_url = '/exercise-demos/barbell-back-squat.gif' WHERE name = 'Barbell Back Squat';
UPDATE exercises SET demo_gif_url = '/exercise-demos/leg-press.gif' WHERE name = 'Leg Press';
UPDATE exercises SET demo_gif_url = '/exercise-demos/romanian-deadlift.gif' WHERE name = 'Romanian Deadlift';
UPDATE exercises SET demo_gif_url = '/exercise-demos/lying-leg-curl.gif' WHERE name = 'Lying Leg Curl';
UPDATE exercises SET demo_gif_url = '/exercise-demos/leg-extension.gif' WHERE name = 'Leg Extension';
UPDATE exercises SET demo_gif_url = '/exercise-demos/dumbbell-lunges.gif' WHERE name = 'Dumbbell Lunges';
UPDATE exercises SET demo_gif_url = '/exercise-demos/calf-raise.gif' WHERE name = 'Calf Raise';

-- Arms
UPDATE exercises SET demo_gif_url = '/exercise-demos/barbell-curl.gif' WHERE name = 'Barbell Curl';
UPDATE exercises SET demo_gif_url = '/exercise-demos/dumbbell-curl.gif' WHERE name = 'Dumbbell Curl';
UPDATE exercises SET demo_gif_url = '/exercise-demos/hammer-curl.gif' WHERE name = 'Hammer Curl';
UPDATE exercises SET demo_gif_url = '/exercise-demos/tricep-pushdown.gif' WHERE name = 'Tricep Pushdown';
UPDATE exercises SET demo_gif_url = '/exercise-demos/skull-crushers.gif' WHERE name = 'Skull Crushers';

