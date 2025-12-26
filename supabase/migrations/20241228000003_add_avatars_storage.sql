-- Migration: Create storage bucket for avatars
-- Note: Storage bucket creation is typically done via Supabase dashboard or CLI
-- This migration documents the required setup

-- Create the avatars bucket (run via Supabase CLI or dashboard)
-- supabase storage create avatars --public

-- The following policies should be applied to the avatars bucket:

-- Policy: Allow authenticated users to upload their own avatars
-- Target: INSERT
-- Policy: (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])

-- Policy: Allow users to update their own avatars
-- Target: UPDATE
-- Policy: (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])

-- Policy: Allow users to delete their own avatars
-- Target: DELETE
-- Policy: (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])

-- Policy: Allow public read access to all avatars
-- Target: SELECT
-- Policy: (bucket_id = 'avatars')

-- Note: The actual storage bucket and policies need to be created via:
-- 1. Supabase Dashboard > Storage > New Bucket
-- 2. Name: avatars, Public: true
-- 3. Add the RLS policies above

-- This is a placeholder to document the storage setup
-- Supabase SQL doesn't have direct commands for storage bucket creation
SELECT 'Avatars storage bucket documentation - see comments for setup instructions' AS note;
