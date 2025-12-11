-- Add hypertrophy scoring columns to exercises table
-- Based on Jeff Nippard's evidence-based exercise ranking methodology

-- Add hypertrophy tier (S/A/B/C/D/F)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS hypertrophy_tier TEXT DEFAULT 'C' 
  CHECK (hypertrophy_tier IN ('S', 'A', 'B', 'C', 'D', 'F'));

-- Add stretch under load rating (1-5, higher = better lengthened tension)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS stretch_under_load SMALLINT DEFAULT 3 
  CHECK (stretch_under_load >= 1 AND stretch_under_load <= 5);

-- Add resistance profile rating (1-5, higher = smoother resistance throughout ROM)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS resistance_profile SMALLINT DEFAULT 3 
  CHECK (resistance_profile >= 1 AND resistance_profile <= 5);

-- Add progression ease rating (1-5, higher = easier to progressively overload)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS progression_ease SMALLINT DEFAULT 3 
  CHECK (progression_ease >= 1 AND progression_ease <= 5);

-- Create index for filtering by tier
CREATE INDEX IF NOT EXISTS idx_exercises_hypertrophy_tier ON exercises(hypertrophy_tier);

-- Add prioritize_hypertrophy preference to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS prioritize_hypertrophy BOOLEAN DEFAULT true;

-- Update existing exercises with hypertrophy scores based on Nippard's research
-- CHEST exercises
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 5, progression_ease = 5 
  WHERE name IN ('Cable Fly', 'Seated Cable Fly', 'Pec Deck');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 3, progression_ease = 5 
  WHERE name IN ('Barbell Bench Press', 'Dumbbell Bench Press', 'Incline Barbell Press', 'Incline Dumbbell Press');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 4, progression_ease = 5 
  WHERE name IN ('Machine Chest Press', 'Smith Machine Bench Press', 'Smith Machine Incline Press');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 3, progression_ease = 4 
  WHERE name IN ('Decline Barbell Press', 'Dip', 'Push-Up');

-- BACK exercises
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 4, progression_ease = 5 
  WHERE name IN ('Chest Supported Row', 'Seated Machine Row');
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 5, progression_ease = 5 
  WHERE name IN ('Cable Row', 'Seated Cable Row');
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 5, progression_ease = 4 
  WHERE name = 'Meadows Row';
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 5, progression_ease = 5 
  WHERE name IN ('Lat Pulldown', 'Close Grip Lat Pulldown');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 4, progression_ease = 4 
  WHERE name IN ('Pull-Up', 'Chin-Up', 'Assisted Pull-Up Machine');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 3, progression_ease = 4 
  WHERE name IN ('Barbell Row', 'T-Bar Row', 'Dumbbell Row');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 4, progression_ease = 4 
  WHERE name IN ('Straight Arm Pulldown', 'Back Extension');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 3, progression_ease = 5 
  WHERE name = 'Conventional Deadlift';

-- SHOULDERS exercises
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 5, progression_ease = 4 
  WHERE name IN ('Behind-the-Back Cable Lateral Raise', 'Cable Y-Raise');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 5, progression_ease = 4 
  WHERE name IN ('Cable Lateral Raise', 'Machine Lateral Raise');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 2, progression_ease = 3 
  WHERE name = 'Lateral Raise';
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 5, progression_ease = 4 
  WHERE name IN ('Reverse Cable Crossover', 'Rear Delt Machine');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 2, progression_ease = 3 
  WHERE name = 'Reverse Fly';
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 4, progression_ease = 5 
  WHERE name IN ('Machine Shoulder Press', 'Smith Machine Shoulder Press');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 3, progression_ease = 4 
  WHERE name IN ('Standing Overhead Press', 'Seated Dumbbell Shoulder Press', 'Arnold Press');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 5, progression_ease = 4 
  WHERE name = 'Face Pull';
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 3, progression_ease = 3 
  WHERE name IN ('Front Raise', 'Upright Row', 'Cable Upright Row');

-- BICEPS exercises
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 5, progression_ease = 4 
  WHERE name = 'Bayesian Cable Curl';
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 4, progression_ease = 4 
  WHERE name IN ('Incline Dumbbell Curl', '45° Preacher Curl');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 5, progression_ease = 4 
  WHERE name IN ('Cable Curl', 'Machine Bicep Curl');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 2, resistance_profile = 3, progression_ease = 4 
  WHERE name IN ('Barbell Curl', 'EZ Bar Curl', 'Dumbbell Curl', 'Hammer Curl');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 3, progression_ease = 4 
  WHERE name IN ('Preacher Curl', 'Concentration Curl');

-- TRICEPS exercises
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 5, progression_ease = 4 
  WHERE name IN ('Overhead Tricep Extension', 'Katana Tricep Extension');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 5, progression_ease = 5 
  WHERE name IN ('Tricep Pushdown', 'Rope Tricep Pushdown', 'Machine Tricep Extension');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 3, progression_ease = 4 
  WHERE name IN ('Skull Crusher', 'Close-Grip Bench Press', 'Dumbbell Kickback');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 3, progression_ease = 4 
  WHERE name = 'Assisted Dip Machine';

-- QUADS exercises
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 4, progression_ease = 5 
  WHERE name = 'Leg Extension';
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 4, progression_ease = 5 
  WHERE name IN ('Hack Squat', 'Pendulum Squat');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 4, progression_ease = 5 
  WHERE name IN ('Leg Press', 'Smith Machine Squat');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 3, progression_ease = 5 
  WHERE name IN ('Barbell Back Squat', 'Front Squat');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 3, progression_ease = 4 
  WHERE name IN ('Goblet Squat', 'Bulgarian Split Squat', 'Walking Lunge', 'Reverse Lunge', 'Step Up');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 2, progression_ease = 3 
  WHERE name = 'Sissy Squat';

-- HAMSTRINGS exercises
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 4, progression_ease = 5 
  WHERE name IN ('Lying Leg Curl', 'Seated Leg Curl');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 3, progression_ease = 4 
  WHERE name IN ('Romanian Deadlift', 'Dumbbell RDL', 'Stiff Leg Deadlift', 'Single Leg RDL');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 3, progression_ease = 4 
  WHERE name = 'Good Morning';
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 5, resistance_profile = 2, progression_ease = 2 
  WHERE name = 'Nordic Curl';

-- GLUTES exercises
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 4, progression_ease = 5 
  WHERE name IN ('Hip Thrust', 'Glute Drive Machine');
UPDATE exercises SET hypertrophy_tier = 'S', stretch_under_load = 5, resistance_profile = 5, progression_ease = 5 
  WHERE name = 'Hip Abduction Machine';
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 5, progression_ease = 4 
  WHERE name IN ('Cable Pull-Through', 'Cable Glute Kickback');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 3, progression_ease = 3 
  WHERE name IN ('Glute Bridge', 'Single Leg Hip Thrust');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 3, progression_ease = 5 
  WHERE name = 'Sumo Deadlift';
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 5, progression_ease = 5 
  WHERE name = 'Hip Adduction Machine';

-- CALVES exercises
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 4, progression_ease = 5 
  WHERE name IN ('Standing Calf Raise', 'Seated Calf Raise', 'Leg Press Calf Raise', 'Smith Machine Calf Raise', 'Donkey Calf Raise');

-- ABS exercises
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 5, progression_ease = 5 
  WHERE name IN ('Cable Crunch', 'Machine Ab Crunch');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 3, progression_ease = 3 
  WHERE name IN ('Hanging Leg Raise', 'Captain''s Chair Leg Raise', 'Ab Wheel Rollout');
UPDATE exercises SET hypertrophy_tier = 'C', stretch_under_load = 2, resistance_profile = 2, progression_ease = 2 
  WHERE name IN ('Plank', 'Dead Bug', 'Decline Crunch', 'Russian Twist');
UPDATE exercises SET hypertrophy_tier = 'A', stretch_under_load = 4, resistance_profile = 5, progression_ease = 4 
  WHERE name IN ('Pallof Press', 'Cable Woodchop');
UPDATE exercises SET hypertrophy_tier = 'B', stretch_under_load = 3, resistance_profile = 3, progression_ease = 4 
  WHERE name IN ('Farmer''s Carry', 'Suitcase Carry');

