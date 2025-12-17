-- Daily check-in table for tracking wellness indicators
CREATE TABLE IF NOT EXISTS daily_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  
  -- Sleep
  sleep_hours DECIMAL(3,1),
  sleep_quality INTEGER CHECK (sleep_quality >= 1 AND sleep_quality <= 5),
  
  -- Energy & Mood
  energy_level INTEGER CHECK (energy_level >= 1 AND energy_level <= 5),
  mood_rating INTEGER CHECK (mood_rating >= 1 AND mood_rating <= 5),
  
  -- Cut-specific (hormonal health indicators)
  focus_rating INTEGER CHECK (focus_rating >= 1 AND focus_rating <= 5),
  libido_rating INTEGER CHECK (libido_rating >= 1 AND libido_rating <= 5),
  hunger_level INTEGER CHECK (hunger_level >= 1 AND hunger_level <= 5),
  
  -- Recovery
  soreness_level INTEGER CHECK (soreness_level >= 1 AND soreness_level <= 5),
  stress_level INTEGER CHECK (stress_level >= 1 AND stress_level <= 5),
  
  -- Notes
  notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint: one check-in per user per day
  UNIQUE(user_id, date)
);

-- Enable RLS
ALTER TABLE daily_check_ins ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own check-ins"
  ON daily_check_ins FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own check-ins"
  ON daily_check_ins FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own check-ins"
  ON daily_check_ins FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own check-ins"
  ON daily_check_ins FOR DELETE
  USING (auth.uid() = user_id);

-- Index for faster lookups
CREATE INDEX idx_daily_check_ins_user_date ON daily_check_ins(user_id, date DESC);

-- Comment
COMMENT ON TABLE daily_check_ins IS 'Daily wellness check-ins for tracking sleep, energy, mood, and cut-specific metrics like focus and libido for refeed detection';

