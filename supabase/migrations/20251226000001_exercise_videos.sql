-- Add video demonstration fields to exercises table
-- Supports MuscleWiki GIFs (primary) and YouTube videos (secondary)

-- Add video URL fields
ALTER TABLE exercises
ADD COLUMN IF NOT EXISTS demo_gif_url TEXT,
ADD COLUMN IF NOT EXISTS demo_thumbnail_url TEXT,
ADD COLUMN IF NOT EXISTS youtube_video_id TEXT;

-- Add comments for documentation
COMMENT ON COLUMN exercises.demo_gif_url IS 'URL to demonstration GIF/animation (from MuscleWiki, Supabase Storage, etc.)';
COMMENT ON COLUMN exercises.demo_thumbnail_url IS 'URL to thumbnail image for the demo (optional, can be generated from GIF)';
COMMENT ON COLUMN exercises.youtube_video_id IS 'YouTube video ID for form tutorials (e.g., "dQw4w9WgXcQ" from youtube.com/watch?v=dQw4w9WgXcQ)';

-- Create index for exercises with videos (for filtering)
CREATE INDEX IF NOT EXISTS idx_exercises_has_demo ON exercises ((demo_gif_url IS NOT NULL));
