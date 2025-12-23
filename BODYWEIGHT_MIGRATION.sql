-- Bodyweight Exercise Tracking Migration
-- Adds support for bodyweight exercises with weight modifications (added weight, assistance)
-- Run this in your Supabase SQL Editor

-- ============================================
-- ADD BODYWEIGHT COLUMNS TO EXERCISES TABLE
-- ============================================

-- Add is_bodyweight flag
ALTER TABLE exercises
ADD COLUMN IF NOT EXISTS is_bodyweight BOOLEAN NOT NULL DEFAULT false;

-- Add bodyweight_type enum
-- Values: 'pure', 'weighted_possible', 'assisted_possible', 'both'
ALTER TABLE exercises
ADD COLUMN IF NOT EXISTS bodyweight_type TEXT CHECK (
    bodyweight_type IS NULL OR
    bodyweight_type IN ('pure', 'weighted_possible', 'assisted_possible', 'both')
);

-- Add default assistance_type for assisted exercises
-- Values: 'machine', 'band', 'partner'
ALTER TABLE exercises
ADD COLUMN IF NOT EXISTS assistance_type TEXT CHECK (
    assistance_type IS NULL OR
    assistance_type IN ('machine', 'band', 'partner')
);

-- ============================================
-- ADD BODYWEIGHT DATA COLUMN TO SET_LOGS TABLE
-- ============================================

-- Add bodyweight_data JSONB column for storing bodyweight-specific set data
ALTER TABLE set_logs
ADD COLUMN IF NOT EXISTS bodyweight_data JSONB;

-- ============================================
-- UPDATE EXISTING BODYWEIGHT EXERCISES
-- ============================================

-- Mark bodyweight equipment exercises
UPDATE exercises
SET is_bodyweight = true
WHERE equipment = 'bodyweight';

-- Set bodyweight types for common exercises
-- Pull-up and Chin-up: can be weighted or assisted
UPDATE exercises
SET bodyweight_type = 'both', assistance_type = 'band'
WHERE name IN ('Pull-Up', 'Chin-Up') AND is_bodyweight = true;

-- Dip: can be weighted or assisted
UPDATE exercises
SET bodyweight_type = 'both', assistance_type = 'machine'
WHERE name = 'Dip' AND is_bodyweight = true;

-- Push-up: can be weighted
UPDATE exercises
SET bodyweight_type = 'weighted_possible'
WHERE name = 'Push-Up' AND is_bodyweight = true;

-- Back Extension: can be weighted
UPDATE exercises
SET bodyweight_type = 'weighted_possible'
WHERE name = 'Back Extension' AND is_bodyweight = true;

-- Nordic Curl: can be assisted
UPDATE exercises
SET bodyweight_type = 'assisted_possible', assistance_type = 'band'
WHERE name = 'Nordic Curl' AND is_bodyweight = true;

-- Glute Bridge and Single Leg Hip Thrust: can be weighted
UPDATE exercises
SET bodyweight_type = 'weighted_possible'
WHERE name IN ('Glute Bridge', 'Single Leg Hip Thrust') AND is_bodyweight = true;

-- Pure bodyweight exercises (no modification possible)
UPDATE exercises
SET bodyweight_type = 'pure'
WHERE name IN ('Plank', 'Dead Bug', 'Ab Wheel Rollout') AND is_bodyweight = true;

-- Core exercises that can be weighted
UPDATE exercises
SET bodyweight_type = 'weighted_possible'
WHERE name IN (
    'Decline Crunch',
    'Hanging Leg Raise',
    'Russian Twist'
) AND is_bodyweight = true;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Index for filtering bodyweight exercises
CREATE INDEX IF NOT EXISTS idx_exercises_is_bodyweight
ON exercises(is_bodyweight)
WHERE is_bodyweight = true;

-- Index for bodyweight_data on set_logs
CREATE INDEX IF NOT EXISTS idx_set_logs_bodyweight_data
ON set_logs USING gin(bodyweight_data)
WHERE bodyweight_data IS NOT NULL;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN exercises.is_bodyweight IS 'Whether this exercise uses bodyweight as primary resistance';
COMMENT ON COLUMN exercises.bodyweight_type IS 'Type of bodyweight exercise: pure (no modifications), weighted_possible, assisted_possible, or both';
COMMENT ON COLUMN exercises.assistance_type IS 'Default assistance type for assisted bodyweight exercises: machine, band, or partner';
COMMENT ON COLUMN set_logs.bodyweight_data IS 'Bodyweight-specific data including user weight, modification type, added/assistance weight, and effective load';

