-- Body measurements tracking table
CREATE TABLE IF NOT EXISTS body_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_at DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Measurements in cm (can convert to inches in UI)
  neck DECIMAL(5,1),
  shoulders DECIMAL(5,1),
  chest DECIMAL(5,1),
  left_bicep DECIMAL(5,1),
  right_bicep DECIMAL(5,1),
  left_forearm DECIMAL(5,1),
  right_forearm DECIMAL(5,1),
  waist DECIMAL(5,1),
  hips DECIMAL(5,1),
  left_thigh DECIMAL(5,1),
  right_thigh DECIMAL(5,1),
  left_calf DECIMAL(5,1),
  right_calf DECIMAL(5,1),
  
  -- Optional notes
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- One entry per user per day
  UNIQUE(user_id, logged_at)
);

-- Enable RLS
ALTER TABLE body_measurements ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own measurements"
  ON body_measurements FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own measurements"
  ON body_measurements FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own measurements"
  ON body_measurements FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own measurements"
  ON body_measurements FOR DELETE
  USING (auth.uid() = user_id);

-- Index for faster queries
CREATE INDEX idx_body_measurements_user_date ON body_measurements(user_id, logged_at DESC);

