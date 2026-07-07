-- Enhanced Athlete Mode as a first-class profile fact.
--
-- Previously the flag lived only in user_volume_profiles.is_enhanced (the
-- adaptive-volume subsystem) and applied a flat +40% to volume baselines that
-- nothing else consumed. It now lives on the users row alongside the other
-- physiological profile facts (sex, height, weight, experience) so the
-- mesocycle generator, fatigue model, and weekly progression can all read it.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS enhanced_athlete_mode BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.enhanced_athlete_mode IS
  'Enhanced Athlete Mode: scales volume landmarks (MEV x1.10 / MAV x1.25 / MRV x1.375) and recovery constants. Joint-stress and injury safety limits deliberately ignore this flag.';

-- Backfill from the legacy adaptive-volume flag so existing enhanced users
-- keep their setting after the toggle moves to the profile.
UPDATE users
SET enhanced_athlete_mode = true
WHERE id IN (SELECT user_id FROM user_volume_profiles WHERE is_enhanced = true);

-- Tag mesocycles with the mode active at generation time so historical
-- volume analysis isn't polluted when the user switches modes mid-stream.
ALTER TABLE mesocycles
  ADD COLUMN IF NOT EXISTS generated_with_enhanced_mode BOOLEAN;

COMMENT ON COLUMN mesocycles.generated_with_enhanced_mode IS
  'Whether Enhanced Athlete Mode was on when this mesocycle plan was generated (or last regenerated). NULL for mesocycles created before the feature existed.';
