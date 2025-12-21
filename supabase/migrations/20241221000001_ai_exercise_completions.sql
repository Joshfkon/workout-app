-- Migration: AI Exercise Completions Tracking
-- Description: Tracks AI usage for custom exercise metadata completion
-- to enforce daily and monthly rate limits

-- Create the ai_exercise_completions table
CREATE TABLE IF NOT EXISTS ai_exercise_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for efficient user-based lookups
CREATE INDEX idx_ai_exercise_completions_user_date
  ON ai_exercise_completions(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE ai_exercise_completions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own usage
CREATE POLICY "Users can view their own AI usage"
  ON ai_exercise_completions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own usage records
CREATE POLICY "Users can insert their own AI usage"
  ON ai_exercise_completions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Add additional exercise metadata columns if they don't exist
DO $$
BEGIN
  -- Add stabilizers column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'stabilizers'
  ) THEN
    ALTER TABLE exercises ADD COLUMN stabilizers TEXT[] DEFAULT '{}';
  END IF;

  -- Add spinal_loading column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'spinal_loading'
  ) THEN
    ALTER TABLE exercises ADD COLUMN spinal_loading TEXT DEFAULT 'low';
  END IF;

  -- Add requires_back_arch column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'requires_back_arch'
  ) THEN
    ALTER TABLE exercises ADD COLUMN requires_back_arch BOOLEAN DEFAULT false;
  END IF;

  -- Add requires_spinal_flexion column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'requires_spinal_flexion'
  ) THEN
    ALTER TABLE exercises ADD COLUMN requires_spinal_flexion BOOLEAN DEFAULT false;
  END IF;

  -- Add requires_spinal_extension column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'requires_spinal_extension'
  ) THEN
    ALTER TABLE exercises ADD COLUMN requires_spinal_extension BOOLEAN DEFAULT false;
  END IF;

  -- Add requires_spinal_rotation column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'requires_spinal_rotation'
  ) THEN
    ALTER TABLE exercises ADD COLUMN requires_spinal_rotation BOOLEAN DEFAULT false;
  END IF;

  -- Add position_stress column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'position_stress'
  ) THEN
    ALTER TABLE exercises ADD COLUMN position_stress JSONB DEFAULT '{}';
  END IF;

  -- Add contraindications column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'contraindications'
  ) THEN
    ALTER TABLE exercises ADD COLUMN contraindications TEXT[] DEFAULT '{}';
  END IF;

  -- Add form_cues column if not exists (for storing AI-generated form cues)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'form_cues'
  ) THEN
    ALTER TABLE exercises ADD COLUMN form_cues TEXT[] DEFAULT '{}';
  END IF;
END $$;

-- Comment on table
COMMENT ON TABLE ai_exercise_completions IS 'Tracks AI usage for exercise metadata completion to enforce rate limits';
