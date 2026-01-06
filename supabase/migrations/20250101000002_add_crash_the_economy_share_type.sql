-- Migration: Add 'crash_the_economy' as a share_type option
-- This allows users to share high-volume, intense workouts with this specific type

-- Alter the CHECK constraint to include the new share_type
ALTER TABLE shared_workouts 
  DROP CONSTRAINT IF EXISTS shared_workouts_share_type_check;

ALTER TABLE shared_workouts 
  ADD CONSTRAINT shared_workouts_share_type_check 
  CHECK (share_type IN ('single_workout', 'program', 'template', 'crash_the_economy'));

