-- Add sample MuscleWiki demo GIF URLs to common exercises
-- MuscleWiki content is CC BY-SA licensed
-- URLs follow pattern: https://musclewiki.com/media/uploads/videos/branded/{muscle}/{exercise}.mp4

-- Note: MuscleWiki uses .mp4 files which work as video/gif in modern browsers
-- For actual implementation, you may want to use WebM/MP4 for better quality

-- CHEST EXERCISES
UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-barbell-bench-press-front.mp4'
WHERE name = 'Barbell Bench Press';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-dumbbell-bench-press-front.mp4'
WHERE name = 'Dumbbell Bench Press';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-dumbbell-incline-bench-press-front.mp4'
WHERE name = 'Incline Dumbbell Press';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-cable-fly-front.mp4'
WHERE name = 'Cable Fly';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-bodyweight-dip-front.mp4'
WHERE name = 'Dips (Chest Focus)';

-- BACK EXERCISES
UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-barbell-bent-over-row-front.mp4'
WHERE name = 'Barbell Row';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-dumbbell-bent-over-row-front.mp4'
WHERE name = 'Dumbbell Row';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-cable-lat-pulldown-front.mp4'
WHERE name = 'Lat Pulldown';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-bodyweight-pull-up-front.mp4'
WHERE name = 'Pull-Ups';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-barbell-deadlift-front.mp4'
WHERE name = 'Deadlift';

-- SHOULDER EXERCISES
UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-barbell-overhead-press-front.mp4'
WHERE name = 'Overhead Press';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-dumbbell-lateral-raise-front.mp4'
WHERE name = 'Lateral Raise';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-dumbbell-rear-delt-fly-front.mp4'
WHERE name = 'Rear Delt Fly';

-- LEG EXERCISES
UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-barbell-squat-front.mp4'
WHERE name = 'Barbell Back Squat';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-leg-press-front.mp4'
WHERE name = 'Leg Press';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-barbell-romanian-deadlift-front.mp4'
WHERE name = 'Romanian Deadlift';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-machine-leg-curl-front.mp4'
WHERE name = 'Lying Leg Curl';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-machine-leg-extension-front.mp4'
WHERE name = 'Leg Extension';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-dumbbell-lunge-front.mp4'
WHERE name = 'Dumbbell Lunges';

-- ARM EXERCISES
UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-barbell-bicep-curl-front.mp4'
WHERE name = 'Barbell Curl';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-dumbbell-bicep-curl-front.mp4'
WHERE name = 'Dumbbell Curl';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-dumbbell-hammer-curl-front.mp4'
WHERE name = 'Hammer Curl';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-cable-triceps-pushdown-front.mp4'
WHERE name = 'Tricep Pushdown';

UPDATE exercises SET demo_gif_url = 'https://musclewiki.com/media/uploads/videos/branded/male-dumbbell-skullcrusher-front.mp4'
WHERE name = 'Skull Crushers';

-- Note: These are example URLs based on MuscleWiki's general structure
-- You should verify each URL or use Supabase Storage for self-hosted videos
-- MuscleWiki API: https://musclewiki.com/api/exercises for exercise data
