# Exercise Videos Setup Guide

The exercise videos feature adds demonstration images and YouTube videos to exercises. This guide will help you set it up.

## Required Migration

Run this migration in your Supabase SQL Editor:

**File**: `supabase/migrations/20251226000001_exercise_videos.sql`

This migration:
- Adds `demo_gif_url`, `demo_thumbnail_url`, and `youtube_video_id` columns to the `exercises` table
- Populates demo images for 28 common exercises
- Creates an index for filtering exercises with demos

## Verification

After running the migration, verify it worked by running this query in Supabase SQL Editor:

```sql
-- Check if columns exist
SELECT 
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'exercises'
  AND column_name IN ('demo_gif_url', 'demo_thumbnail_url', 'youtube_video_id');

-- Check if any exercises have video data
SELECT 
  name,
  demo_gif_url,
  youtube_video_id
FROM exercises
WHERE demo_gif_url IS NOT NULL 
   OR youtube_video_id IS NOT NULL
ORDER BY name
LIMIT 10;

-- Check specific exercise (Barbell Bench Press)
SELECT 
  name,
  demo_gif_url,
  youtube_video_id
FROM exercises
WHERE name ILIKE '%barbell%bench%press%';
```

## Expected Results

After running the migration:
- You should see 3 columns in the first query result
- You should see ~28 exercises with `demo_gif_url` populated
- "Barbell Bench Press" should have `demo_gif_url = '/exercise-demos/barbell-bench-press.jpg'`

## Troubleshooting

### Exercise Demo Section Not Showing

1. **Check if migration was run:**
   - Run the verification queries above
   - If columns don't exist, run the migration

2. **Check exercise names match:**
   - The migration uses exact name matching (case-sensitive)
   - If your exercise names don't match exactly, the UPDATE statements won't work
   - You can manually update exercises:
     ```sql
     UPDATE exercises 
     SET demo_gif_url = '/exercise-demos/barbell-bench-press.jpg' 
     WHERE name = 'Your Exact Exercise Name';
     ```

3. **Check browser console:**
   - Open the exercise details modal
   - Check the browser console for debug logs
   - Look for `[ExerciseDetailsModal]` messages showing what fields are found

4. **Clear exercise cache:**
   - The exercise service caches exercise data
   - If you updated exercises after the app loaded, you may need to refresh
   - Or clear the cache programmatically (if you have access)

## Adding More Videos

To add videos to more exercises:

1. **Add demo images:**
   - Place images in `public/exercise-demos/` folder
   - Update the exercise:
     ```sql
     UPDATE exercises 
     SET demo_gif_url = '/exercise-demos/your-image.jpg' 
     WHERE name = 'Exercise Name';
     ```

2. **Add YouTube videos:**
   - Get the YouTube video ID from the URL (e.g., `dQw4w9WgXcQ` from `youtube.com/watch?v=dQw4w9WgXcQ`)
   - Update the exercise:
     ```sql
     UPDATE exercises 
     SET youtube_video_id = 'dQw4w9WgXcQ' 
     WHERE name = 'Exercise Name';
     ```

## Image Sources

The demo images are from the free-exercise-db project (Public Domain):
- Source: https://github.com/yuhonas/free-exercise-db
- Images are stored in `public/exercise-demos/` folder

