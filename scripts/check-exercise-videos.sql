-- Quick check script to verify exercise videos migration status
-- Run this in Supabase SQL Editor to check if the migration has been applied

-- Check if columns exist
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'exercises'
  AND column_name IN ('demo_gif_url', 'demo_thumbnail_url', 'youtube_video_id')
ORDER BY column_name;

-- Check if any exercises have video data
SELECT 
  name,
  demo_gif_url,
  demo_thumbnail_url,
  youtube_video_id
FROM exercises
WHERE demo_gif_url IS NOT NULL 
   OR demo_thumbnail_url IS NOT NULL 
   OR youtube_video_id IS NOT NULL
ORDER BY name
LIMIT 10;

-- Check specific exercise (Barbell Bench Press)
SELECT 
  name,
  demo_gif_url,
  youtube_video_id
FROM exercises
WHERE name ILIKE '%barbell%bench%press%'
ORDER BY name;

