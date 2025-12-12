-- Create standalone progress photos table
-- Progress photos are separate from DEXA scans to allow flexible photo tracking

CREATE TABLE IF NOT EXISTS progress_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_date DATE NOT NULL,
  photo_url TEXT NOT NULL,
  weight_kg DECIMAL(5,2),
  body_fat_percent DECIMAL(4,1),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE progress_photos ENABLE ROW LEVEL SECURITY;

-- RLS policies for progress_photos
CREATE POLICY "Users can view own progress photos"
  ON progress_photos FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own progress photos"
  ON progress_photos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own progress photos"
  ON progress_photos FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own progress photos"
  ON progress_photos FOR DELETE
  USING (auth.uid() = user_id);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_progress_photos_user_date ON progress_photos(user_id, photo_date DESC);

-- Remove the progress_photo_url column from dexa_scans since we're using a separate table
ALTER TABLE dexa_scans DROP COLUMN IF EXISTS progress_photo_url;
