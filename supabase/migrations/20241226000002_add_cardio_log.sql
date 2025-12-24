-- Create cardio_log table to track daily cardio sessions
CREATE TABLE IF NOT EXISTS cardio_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_at DATE NOT NULL,
  minutes INTEGER NOT NULL,
  modality TEXT NOT NULL CHECK (modality IN ('incline_walk', 'bike', 'elliptical', 'rower', 'other')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, logged_at, modality)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_cardio_log_user_date ON cardio_log(user_id, logged_at DESC);

-- Enable RLS
ALTER TABLE cardio_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own cardio logs"
  ON cardio_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own cardio logs"
  ON cardio_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own cardio logs"
  ON cardio_log FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own cardio logs"
  ON cardio_log FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_cardio_log_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_cardio_log_updated_at
  BEFORE UPDATE ON cardio_log
  FOR EACH ROW
  EXECUTE FUNCTION update_cardio_log_updated_at();

COMMENT ON TABLE cardio_log IS 'Daily cardio session logs for tracking Zone 2 cardio minutes and modality';

