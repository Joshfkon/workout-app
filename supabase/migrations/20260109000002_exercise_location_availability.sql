-- ============================================
-- EXERCISE LOCATION AVAILABILITY
-- ============================================
-- Allows users to mark which exercises are available at each gym location.
-- This is a simpler, user-controlled approach to equipment filtering.

-- Create table for tracking exercise availability per location
CREATE TABLE IF NOT EXISTS exercise_location_availability (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES gym_locations(id) ON DELETE CASCADE,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each user can only have one entry per exercise-location combination
  UNIQUE(user_id, exercise_id, location_id)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_exercise_location_user ON exercise_location_availability(user_id);
CREATE INDEX IF NOT EXISTS idx_exercise_location_exercise ON exercise_location_availability(exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercise_location_location ON exercise_location_availability(location_id);
CREATE INDEX IF NOT EXISTS idx_exercise_location_available ON exercise_location_availability(user_id, location_id, is_available);

-- Enable RLS
ALTER TABLE exercise_location_availability ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own exercise availability settings
CREATE POLICY "Users can view their own exercise availability"
  ON exercise_location_availability FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own exercise availability"
  ON exercise_location_availability FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own exercise availability"
  ON exercise_location_availability FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own exercise availability"
  ON exercise_location_availability FOR DELETE
  USING (auth.uid() = user_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_exercise_location_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_exercise_location_availability_updated_at
  BEFORE UPDATE ON exercise_location_availability
  FOR EACH ROW
  EXECUTE FUNCTION update_exercise_location_updated_at();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE exercise_location_availability IS
  'Tracks which exercises are available at each gym location per user';
COMMENT ON COLUMN exercise_location_availability.is_available IS
  'Whether the exercise can be performed at this location (true = available)';
