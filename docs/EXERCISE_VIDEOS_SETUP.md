# Exercise Videos Setup Guide

The exercise videos feature adds animated GIF demonstrations and YouTube videos to exercises. This guide will help you set it up.

## Required Migrations

### 1. Initial Migration (Add Columns)

Run this migration in your Supabase SQL Editor:

**File**: `supabase/migrations/20251226000001_exercise_videos.sql`

This migration:
- Adds `demo_gif_url`, `demo_thumbnail_url`, and `youtube_video_id` columns to the `exercises` table
- Creates an index for filtering exercises with demos

### 2. Fetch MuscleWiki GIFs

**Recommended**: Use MuscleWiki for animated GIFs (better quality, animated demonstrations)

1. **Run the fetch script**:
   ```bash
   node scripts/fetch-musclewiki-gifs.mjs
   ```

2. This will:
   - Download animated GIFs from MuscleWiki API
   - Save them to `public/exercise-demos/` folder
   - Generate a SQL file with update statements

3. **Run the generated SQL** (or use the migration):
   - The script creates `public/exercise-demos/update-urls.sql`
   - OR run: `supabase/migrations/20251226000002_update_to_musclewiki_gifs.sql`

## Verification

After running the migrations, verify it worked by running this query in Supabase SQL Editor:

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

After running the migrations:
- You should see 3 columns in the first query result
- After fetching GIFs, you should see exercises with `demo_gif_url` populated (e.g., `/exercise-demos/barbell-bench-press.gif`)

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
     SET demo_gif_url = '/exercise-demos/barbell-bench-press.gif' 
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

1. **Add demo GIFs (MuscleWiki):**
   - Run `node scripts/fetch-musclewiki-gifs.mjs` (it will try to find the exercise)
   - Or manually add GIFs to `public/exercise-demos/` folder
   - Update the exercise:
     ```sql
     UPDATE exercises 
     SET demo_gif_url = '/exercise-demos/your-exercise.gif' 
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

## Alternative: Using free-exercise-db (Static Images)

If you prefer static images from free-exercise-db instead of MuscleWiki GIFs:

1. **Run the fetch script**:
   ```bash
   node scripts/fetch-exercise-videos.mjs
   ```

2. This downloads static images (JPG/PNG) from free-exercise-db

## Image Sources

- **MuscleWiki**: Animated GIFs from https://api.musclewiki.com (recommended)
- **free-exercise-db**: Static images from https://github.com/yuhonas/free-exercise-db (Public Domain)
