-- Local-only schema fixups for replaying supabase/migrations from scratch.
--
-- The repo's migration history does not replay cleanly on an empty database
-- (production got these columns through paths that are not in the files):
--   * 20241209000005 / 20241217000007 are stub files (" */").
--   * 20241215000000_nutrition_tables: food_log already exists from an earlier
--     migration, so CREATE TABLE IF NOT EXISTS is skipped and food_id & co.
--     never get added.
--   * 20260718000001_training_phases: same story — an older training_phases
--     table wins and start_day/end_day/... never appear.
-- These ALTERs bring the two tables to the shape the app code reads. Never
-- run this against production.
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS fiber NUMERIC(6,1);
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS sugar NUMERIC(6,1);
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS sodium NUMERIC(8,1);
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS food_id TEXT;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS notes TEXT;
CREATE INDEX IF NOT EXISTS idx_food_log_food_id ON food_log(food_id) WHERE food_id IS NOT NULL;

ALTER TABLE training_phases ADD COLUMN IF NOT EXISTS start_day TEXT;
ALTER TABLE training_phases ADD COLUMN IF NOT EXISTS end_day TEXT;
ALTER TABLE training_phases ADD COLUMN IF NOT EXISTS target_rate_lbs_per_week NUMERIC;
ALTER TABLE training_phases ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE training_phases ALTER COLUMN start_date DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_training_phases_user_start ON training_phases(user_id, start_day DESC);
NOTIFY pgrst, 'reload schema';

-- Columns/tables whose migrations are the two stub files (20241209000005
-- extended_user_profile, 20241217000007 hydration_and_equipment) or that
-- otherwise never land on a fresh replay. Found with local-db/check-env.mjs.
ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS feedback JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE nutrition_targets ADD COLUMN IF NOT EXISTS water_ml INTEGER;
CREATE TABLE IF NOT EXISTS hydration_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logged_at DATE NOT NULL DEFAULT CURRENT_DATE,
  amount_ml INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE hydration_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own hydration" ON hydration_log;
CREATE POLICY "own hydration" ON hydration_log FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT ALL ON hydration_log TO authenticated;
-- users.training_age: the Settings page saves it (years, parseFloat) but no
-- migration creates it (see the comment in app/(dashboard)/dashboard/settings/page.tsx).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS training_age NUMERIC(4,1) DEFAULT 0;

-- users.body_fat_percent: read on the workout and onboarding paths, never
-- added to users by a migration (only dexa_scans has it).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS body_fat_percent NUMERIC(4,1);

NOTIFY pgrst, 'reload schema';
