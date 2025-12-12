-- Supabase Storage Setup for Progress Photos
-- Run this in the Supabase SQL editor to create the storage bucket and policies

-- Create the storage bucket for progress photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('progress-photos', 'progress-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: Allow authenticated users to upload files to their own folder
CREATE POLICY "Users can upload progress photos to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'progress-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Storage policy: Allow users to read their own photos
CREATE POLICY "Users can read own progress photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'progress-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Storage policy: Allow users to update their own photos
CREATE POLICY "Users can update own progress photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'progress-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Storage policy: Allow users to delete their own photos
CREATE POLICY "Users can delete own progress photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'progress-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
