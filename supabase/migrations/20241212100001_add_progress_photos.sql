-- Add progress photo URL column to dexa_scans table
-- This allows users to upload and track progress photos with their DEXA scans

ALTER TABLE dexa_scans
ADD COLUMN IF NOT EXISTS progress_photo_url TEXT DEFAULT NULL;

COMMENT ON COLUMN dexa_scans.progress_photo_url IS 'URL to progress photo stored in Supabase Storage';

-- Create storage bucket for progress photos (run separately via Supabase dashboard or JS)
-- CREATE BUCKET progress-photos WITH (public = false);

-- Storage policies will need to be set up via Supabase dashboard:
-- 1. Allow authenticated users to upload files to progress-photos/{user_id}/*
-- 2. Allow users to read their own photos from progress-photos/{user_id}/*
-- 3. Allow users to delete their own photos from progress-photos/{user_id}/*
