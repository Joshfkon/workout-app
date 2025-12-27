-- Check which exercises are missing videos
-- Run this in Supabase SQL Editor

-- Summary counts
SELECT 
  COUNT(*) as total_exercises,
  COUNT(demo_gif_url) as exercises_with_videos,
  COUNT(*) - COUNT(demo_gif_url) as exercises_missing_videos,
  ROUND(100.0 * COUNT(demo_gif_url) / COUNT(*), 1) as percentage_with_videos
FROM exercises;

-- List all exercises missing videos
SELECT 
  id,
  name,
  primary_muscle,
  equipment,
  demo_gif_url,
  youtube_video_id
FROM exercises
WHERE demo_gif_url IS NULL 
  AND youtube_video_id IS NULL
ORDER BY primary_muscle, name;

-- Count by muscle group
SELECT 
  primary_muscle,
  COUNT(*) as total,
  COUNT(demo_gif_url) as with_videos,
  COUNT(*) - COUNT(demo_gif_url) as missing_videos
FROM exercises
GROUP BY primary_muscle
ORDER BY primary_muscle;

