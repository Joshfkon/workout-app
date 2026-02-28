-- Migration: Remove 'crash_the_economy' from share_type options
-- This removes the joke share type option from the shared_workouts table

-- First update any existing rows that have crash_the_economy to single_workout
UPDATE shared_workouts
SET share_type = 'single_workout'
WHERE share_type = 'crash_the_economy';

-- Then update the CHECK constraint to remove crash_the_economy
ALTER TABLE shared_workouts
  DROP CONSTRAINT IF EXISTS shared_workouts_share_type_check;

ALTER TABLE shared_workouts
  ADD CONSTRAINT shared_workouts_share_type_check
  CHECK (share_type IN ('single_workout', 'program', 'template'));
