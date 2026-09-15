-- Non-gym activity log: bike rides, runs, hikes, sports — anything outside the
-- app that taxes muscles. Feeds the RECOVERY model only (as synthetic
-- recovery-debt sessions); deliberately NOT weekly training volume, MEV/MRV
-- counting, or progression. See services/nonGymActivity.ts.
CREATE TABLE IF NOT EXISTS non_gym_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- When the activity HAPPENED (not when it was logged) — this timestamp is
  -- the recovery-debt clock, so it carries time-of-day, unlike cardio_log's
  -- date-only logged_at.
  performed_at TIMESTAMPTZ NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('bike', 'run', 'swim', 'hike', 'sport', 'other')),
  -- Optional free-text label ("pickup basketball", "MTB ride").
  name TEXT,
  duration_minutes INTEGER CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  -- Perceived effort of the activity itself — the input the fatigue mapping
  -- converts into an effective-set dose. NOT a soreness report.
  intensity TEXT NOT NULL CHECK (intensity IN ('light', 'moderate', 'hard')),
  -- Affected muscles as StandardMuscleGroup tokens (types/schema.ts). The app
  -- validates membership; unknown tokens are ignored on read rather than
  -- trusted, so a stale enum here can never corrupt the recovery model.
  muscle_groups TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_non_gym_activities_user_performed
  ON non_gym_activities(user_id, performed_at DESC);

ALTER TABLE non_gym_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own non-gym activities"
  ON non_gym_activities FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own non-gym activities"
  ON non_gym_activities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own non-gym activities"
  ON non_gym_activities FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own non-gym activities"
  ON non_gym_activities FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_non_gym_activities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_non_gym_activities_updated_at
  BEFORE UPDATE ON non_gym_activities
  FOR EACH ROW
  EXECUTE FUNCTION update_non_gym_activities_updated_at();

COMMENT ON TABLE non_gym_activities IS
  'User-logged non-gym activities (rides, runs, sports). Source for synthetic recovery-debt sessions in the muscle recovery model; never counted as training volume.';
