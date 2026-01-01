-- ============================================
-- STEP TRACKING MIGRATION
-- ============================================
-- This migration ensures the daily_activity_data table
-- is properly configured for manual step tracking.
-- 
-- The table was originally created in 20241223000001_wearable_integration.sql,
-- but this migration ensures all required columns and constraints exist
-- for manual step tracking functionality.
-- ============================================

-- Ensure daily_activity_data table exists with step tracking columns
DO $$
BEGIN
  -- Check if table exists, if not create it
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'daily_activity_data'
  ) THEN
    CREATE TABLE daily_activity_data (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
      date date NOT NULL,

      -- Step data
      steps_total integer NOT NULL DEFAULT 0,
      steps_source text NOT NULL DEFAULT 'manual' CHECK (steps_source IN ('apple_healthkit', 'google_fit', 'fitbit', 'samsung_health', 'garmin', 'manual')),
      steps_hourly_breakdown integer[], -- 24 values for each hour (null for manual entries)
      steps_confidence text NOT NULL DEFAULT 'manual' CHECK (steps_confidence IN ('measured', 'estimated', 'manual')),

      -- Wearable-reported calories (used cautiously)
      wearable_active_calories integer,
      wearable_active_calories_source text CHECK (wearable_active_calories_source IN ('apple_healthkit', 'google_fit', 'fitbit', 'samsung_health', 'garmin', 'manual')),

      -- Calculated expenditures
      step_expenditure integer NOT NULL DEFAULT 0,
      workout_expenditure integer NOT NULL DEFAULT 0,
      total_activity_expenditure integer NOT NULL DEFAULT 0,
      activity_level text NOT NULL DEFAULT 'sedentary' CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),

      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),

      -- One entry per user per day
      UNIQUE(user_id, date)
    );
  END IF;
END $$;

-- Ensure step tracking columns exist
DO $$
BEGIN
  -- Add steps_total if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_activity_data' AND column_name = 'steps_total'
  ) THEN
    ALTER TABLE daily_activity_data ADD COLUMN steps_total integer NOT NULL DEFAULT 0;
  END IF;

  -- Add steps_source if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_activity_data' AND column_name = 'steps_source'
  ) THEN
    ALTER TABLE daily_activity_data ADD COLUMN steps_source text NOT NULL DEFAULT 'manual';
    ALTER TABLE daily_activity_data ADD CONSTRAINT daily_activity_data_steps_source_check 
      CHECK (steps_source IN ('apple_healthkit', 'google_fit', 'fitbit', 'samsung_health', 'garmin', 'manual'));
  END IF;

  -- Add steps_hourly_breakdown if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_activity_data' AND column_name = 'steps_hourly_breakdown'
  ) THEN
    ALTER TABLE daily_activity_data ADD COLUMN steps_hourly_breakdown integer[];
  END IF;

  -- Add steps_confidence if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_activity_data' AND column_name = 'steps_confidence'
  ) THEN
    ALTER TABLE daily_activity_data ADD COLUMN steps_confidence text NOT NULL DEFAULT 'manual';
    ALTER TABLE daily_activity_data ADD CONSTRAINT daily_activity_data_steps_confidence_check 
      CHECK (steps_confidence IN ('measured', 'estimated', 'manual'));
  END IF;

  -- Add step_expenditure if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_activity_data' AND column_name = 'step_expenditure'
  ) THEN
    ALTER TABLE daily_activity_data ADD COLUMN step_expenditure integer NOT NULL DEFAULT 0;
  END IF;

  -- Add workout_expenditure if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_activity_data' AND column_name = 'workout_expenditure'
  ) THEN
    ALTER TABLE daily_activity_data ADD COLUMN workout_expenditure integer NOT NULL DEFAULT 0;
  END IF;

  -- Add total_activity_expenditure if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_activity_data' AND column_name = 'total_activity_expenditure'
  ) THEN
    ALTER TABLE daily_activity_data ADD COLUMN total_activity_expenditure integer NOT NULL DEFAULT 0;
  END IF;

  -- Add activity_level if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'daily_activity_data' AND column_name = 'activity_level'
  ) THEN
    ALTER TABLE daily_activity_data ADD COLUMN activity_level text NOT NULL DEFAULT 'sedentary';
    ALTER TABLE daily_activity_data ADD CONSTRAINT daily_activity_data_activity_level_check 
      CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active'));
  END IF;
END $$;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_daily_activity_user_id ON daily_activity_data(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_activity_date ON daily_activity_data(date);
CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date ON daily_activity_data(user_id, date);

-- Ensure RLS is enabled
ALTER TABLE daily_activity_data ENABLE ROW LEVEL SECURITY;

-- Ensure RLS policies exist (drop and recreate to ensure they're correct)
DO $$
BEGIN
  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS "Users can view own daily activity data" ON daily_activity_data;
  DROP POLICY IF EXISTS "Users can insert own daily activity data" ON daily_activity_data;
  DROP POLICY IF EXISTS "Users can update own daily activity data" ON daily_activity_data;
  DROP POLICY IF EXISTS "Users can delete own daily activity data" ON daily_activity_data;
  
  -- Also drop old policy names if they exist
  DROP POLICY IF EXISTS "Users can view own daily activity" ON daily_activity_data;
  DROP POLICY IF EXISTS "Users can insert own daily activity" ON daily_activity_data;
  DROP POLICY IF EXISTS "Users can update own daily activity" ON daily_activity_data;
  DROP POLICY IF EXISTS "Users can delete own daily activity" ON daily_activity_data;
END $$;

-- Create RLS policies
CREATE POLICY "Users can view own daily activity data"
  ON daily_activity_data FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily activity data"
  ON daily_activity_data FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily activity data"
  ON daily_activity_data FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own daily activity data"
  ON daily_activity_data FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================
COMMENT ON TABLE daily_activity_data IS 'Stores daily activity data including manual and wearable-tracked steps';
COMMENT ON COLUMN daily_activity_data.steps_total IS 'Total steps for the day (can be manually entered or from wearable)';
COMMENT ON COLUMN daily_activity_data.steps_source IS 'Source of step data: manual entry or wearable device';
COMMENT ON COLUMN daily_activity_data.steps_hourly_breakdown IS 'Hourly step breakdown (24 values). Null for manual entries.';
COMMENT ON COLUMN daily_activity_data.steps_confidence IS 'Confidence level: measured (wearable), estimated (calculated), or manual (user-entered)';
COMMENT ON COLUMN daily_activity_data.step_expenditure IS 'Calculated calories burned from steps (in calories)';
COMMENT ON COLUMN daily_activity_data.workout_expenditure IS 'Calculated calories burned from workouts (in calories)';
COMMENT ON COLUMN daily_activity_data.total_activity_expenditure IS 'Total calories burned from activity (steps + workouts)';
COMMENT ON COLUMN daily_activity_data.activity_level IS 'Activity level classification based on steps and workouts';

