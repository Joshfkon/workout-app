-- Fix weight_log table to ensure correct structure

-- Add unit column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'weight_log' AND column_name = 'unit'
  ) THEN
    ALTER TABLE weight_log ADD COLUMN unit TEXT DEFAULT 'lb' CHECK (unit IN ('lb', 'kg'));
  END IF;
END $$;

-- Ensure RLS policies exist
DO $$
BEGIN
  -- Drop and recreate policies to ensure they're correct
  DROP POLICY IF EXISTS "Users can view their own weight log" ON weight_log;
  DROP POLICY IF EXISTS "Users can insert their own weight log" ON weight_log;
  DROP POLICY IF EXISTS "Users can update their own weight log" ON weight_log;
  DROP POLICY IF EXISTS "Users can delete their own weight log" ON weight_log;
  
  -- Also drop old policy names if they exist
  DROP POLICY IF EXISTS "Users can view own weight log" ON weight_log;
  DROP POLICY IF EXISTS "Users can insert own weight log" ON weight_log;
  DROP POLICY IF EXISTS "Users can update own weight log" ON weight_log;
  DROP POLICY IF EXISTS "Users can delete own weight log" ON weight_log;
END $$;

-- Create RLS policies
CREATE POLICY "Users can view their own weight log"
  ON weight_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own weight log"
  ON weight_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own weight log"
  ON weight_log FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own weight log"
  ON weight_log FOR DELETE
  USING (auth.uid() = user_id);

-- Make sure RLS is enabled
ALTER TABLE weight_log ENABLE ROW LEVEL SECURITY;

