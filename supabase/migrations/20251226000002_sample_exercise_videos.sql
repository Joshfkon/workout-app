-- Sample exercise video URLs
-- IMPORTANT: This migration is a TEMPLATE. The placeholder URLs below won't work!
--
-- To add working videos, either:
-- 1. Run: npx ts-node scripts/fetch-exercise-videos.ts (downloads from MuscleWiki API)
-- 2. Manually download GIFs from musclewiki.com and upload to Supabase Storage
-- 3. Use your own video hosting solution
--
-- After uploading to Supabase Storage, update with real URLs like:
-- UPDATE exercises SET demo_gif_url = 'https://your-project.supabase.co/storage/v1/object/public/exercise-demos/barbell-bench-press.mp4'
-- WHERE name = 'Barbell Bench Press';
--
-- MuscleWiki content is CC BY-SA licensed - attribution required

-- Example template (commented out - replace with actual URLs):
/*
UPDATE exercises SET demo_gif_url = 'YOUR_SUPABASE_STORAGE_URL/barbell-bench-press.mp4' WHERE name = 'Barbell Bench Press';
UPDATE exercises SET demo_gif_url = 'YOUR_SUPABASE_STORAGE_URL/dumbbell-bench-press.mp4' WHERE name = 'Dumbbell Bench Press';
UPDATE exercises SET demo_gif_url = 'YOUR_SUPABASE_STORAGE_URL/pull-ups.mp4' WHERE name = 'Pull-Ups';
UPDATE exercises SET demo_gif_url = 'YOUR_SUPABASE_STORAGE_URL/barbell-squat.mp4' WHERE name = 'Barbell Back Squat';
UPDATE exercises SET demo_gif_url = 'YOUR_SUPABASE_STORAGE_URL/deadlift.mp4' WHERE name = 'Deadlift';
*/

-- This migration intentionally does nothing until you add real URLs
SELECT 'Exercise video fields ready - run scripts/fetch-exercise-videos.ts to populate' AS status;
