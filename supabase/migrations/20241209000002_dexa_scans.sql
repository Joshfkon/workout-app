-- Add height to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS height_cm DECIMAL(5,1);

-- Create DEXA scans table
CREATE TABLE IF NOT EXISTS dexa_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_date DATE NOT NULL,
  weight_kg DECIMAL(5,2) NOT NULL,
  lean_mass_kg DECIMAL(5,2) NOT NULL,
  fat_mass_kg DECIMAL(5,2) NOT NULL,
  body_fat_percent DECIMAL(4,1) NOT NULL,
  bone_mass_kg DECIMAL(4,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE dexa_scans ENABLE ROW LEVEL SECURITY;

-- RLS policies for dexa_scans
CREATE POLICY "Users can view own DEXA scans"
  ON dexa_scans FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own DEXA scans"
  ON dexa_scans FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own DEXA scans"
  ON dexa_scans FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own DEXA scans"
  ON dexa_scans FOR DELETE
  USING (auth.uid() = user_id);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_dexa_scans_user_date ON dexa_scans(user_id, scan_date DESC);

