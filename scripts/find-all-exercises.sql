-- Find all exercises in the database and check which ones have videos
-- Run this in Supabase SQL Editor

-- Get all exercises with their video status
SELECT 
  name,
  primary_muscle,
  equipment,
  CASE 
    WHEN demo_gif_url IS NOT NULL THEN 'Has Video'
    WHEN youtube_video_id IS NOT NULL THEN 'Has YouTube'
    ELSE 'Missing Video'
  END as video_status,
  demo_gif_url,
  youtube_video_id
FROM exercises
ORDER BY 
  CASE 
    WHEN demo_gif_url IS NOT NULL THEN 1
    WHEN youtube_video_id IS NOT NULL THEN 2
    ELSE 3
  END,
  primary_muscle,
  name;

