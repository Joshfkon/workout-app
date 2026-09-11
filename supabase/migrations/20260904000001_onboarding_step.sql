-- Add onboarding_step to track user's progress through onboarding flow
-- Allows users to resume from where they left off instead of restarting

ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_step TEXT;

COMMENT ON COLUMN users.onboarding_step IS 'Current step in onboarding flow: units, body_comp, goal, benchmarks, calibrate, complete, profile, enhanced, install, or NULL if not started';

-- Create index for queries filtering by incomplete onboarding
CREATE INDEX IF NOT EXISTS idx_users_onboarding_incomplete 
  ON users(id) 
  WHERE onboarding_completed = false AND onboarding_step IS NOT NULL;
