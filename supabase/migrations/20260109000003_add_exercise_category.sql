-- ============================================
-- Add exercise category column for fatigue modeling
-- Categories: isolation, compound_accessory, compound_primary
-- ============================================

-- Add the category column with a default value
ALTER TABLE exercises
ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'compound_accessory'
CHECK (category IN ('isolation', 'compound_accessory', 'compound_primary'));

-- Update existing exercises based on their mechanic and movement pattern
-- Primary compounds: Main strength lifts
UPDATE exercises SET category = 'compound_primary'
WHERE name IN (
  'Barbell Bench Press',
  'Incline Barbell Press',
  'Barbell Back Squat',
  'Deadlift',
  'Overhead Press',
  'Barbell Row'
);

-- Compound accessories: Secondary compound movements
UPDATE exercises SET category = 'compound_accessory'
WHERE name IN (
  'Dumbbell Bench Press',
  'Incline Dumbbell Press',
  'Machine Chest Press',
  'Dips (Chest Focus)',
  'Dumbbell Row',
  'Lat Pulldown',
  'Pull-Ups',
  'Cable Row',
  'Chest Supported Row',
  'Dumbbell Shoulder Press',
  'Close Grip Bench Press',
  'Dips (Tricep Focus)',
  'Leg Press',
  'Hack Squat',
  'Bulgarian Split Squat',
  'Walking Lunges',
  'Romanian Deadlift',
  'Good Morning',
  'Hip Thrust',
  'Cable Pull Through',
  'Hanging Leg Raise',
  'Ab Wheel Rollout'
);

-- Isolation exercises: Single-joint movements
UPDATE exercises SET category = 'isolation'
WHERE name IN (
  'Cable Fly',
  'Dumbbell Fly',
  'Lateral Raise',
  'Face Pull',
  'Rear Delt Fly',
  'Front Raise',
  'Dumbbell Shrug',
  'Barbell Shrug',
  'Barbell Curl',
  'Dumbbell Curl',
  'Incline Dumbbell Curl',
  'Hammer Curl',
  'Cable Curl',
  'Preacher Curl',
  'EZ Bar Curl',
  'Concentration Curl',
  'Tricep Pushdown',
  'Skull Crusher',
  'Overhead Tricep Extension',
  'Triceps Extension (Dumbbell)',
  'Dumbbell Kickback',
  'Leg Extension',
  'Lying Leg Curl',
  'Seated Leg Curl',
  'Glute Bridge',
  'Standing Calf Raise',
  'Seated Calf Raise',
  'Leg Press Calf Raise',
  'Cable Crunch',
  'Plank'
);

-- Also set isolation category for any exercise with mechanic = 'isolation' that wasn't explicitly listed
UPDATE exercises SET category = 'isolation'
WHERE mechanic = 'isolation' AND category = 'compound_accessory';

-- Create an index on the category column for efficient filtering
CREATE INDEX IF NOT EXISTS idx_exercises_category ON exercises(category);
