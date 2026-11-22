-- ============================================
-- EXTENDED USER PROFILE FOR AI MESOCYCLE BUILDER
-- ============================================

-- Create equipment type for validation
CREATE TYPE equipment_type AS ENUM ('barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell');

-- Add extended profile fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS age INTEGER CHECK (age > 0 AND age < 120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS sleep_quality INTEGER DEFAULT 3 CHECK (sleep_quality >= 1 AND sleep_quality <= 5);
ALTER TABLE users ADD COLUMN IF NOT EXISTS stress_level INTEGER DEFAULT 3 CHECK (stress_level >= 1 AND stress_level <= 5);
ALTER TABLE users ADD COLUMN IF NOT EXISTS training_age DECIMAL(4,1) DEFAULT 0 CHECK (training_age >= 0 AND training_age < 100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS available_equipment TEXT[] DEFAULT ARRAY['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];
ALTER TABLE users ADD COLUMN IF NOT EXISTS injury_history TEXT[] DEFAULT '{}';

-- Comment on new columns for documentation
COMMENT ON COLUMN users.age IS 'User age in years - affects recovery capacity and exercise selection';
COMMENT ON COLUMN users.sleep_quality IS 'Subjective sleep quality rating 1-5 (1=poor, 5=excellent) - affects volume recommendations';
COMMENT ON COLUMN users.stress_level IS 'Current life stress level 1-5 (1=low, 5=high) - affects recovery capacity';
COMMENT ON COLUMN users.training_age IS 'Years of consistent resistance training - affects periodization model selection';
COMMENT ON COLUMN users.available_equipment IS 'Equipment types available at user gym - filters exercise selection';
COMMENT ON COLUMN users.injury_history IS 'Muscle groups with injury history - used to avoid or modify exercises';


