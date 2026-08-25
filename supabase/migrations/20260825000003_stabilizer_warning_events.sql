-- Stabilizer warning events (cloned from the joint_pain_events template).
--
-- One row per fired pre-set stabilizer warning (services/muscleRecovery
-- evaluateStabilizerWarning): which muscle gated which exercise, the
-- readiness and intensity ratios at evaluation time, and what the user did
-- about it. The row is written when the warning is SHOWN (response 'shown')
-- and patched when the user responds:
--   'dismissed'  — tapped dismiss; the block stays quiet for the session
--   'proceeded'  — logged a set on the block with the warning still up
-- Rows are append-per-warning; the response patch is the only update.
--
-- Writes are routed through the offline outbox (lib/offline/setOutbox —
-- client-generated ids, idempotent upserts), unlike joint_pain_events'
-- direct fire-and-forget insert, per the approved spec.
--
-- Consumers: the recovery debug page's warning history, and threshold
-- calibration (was a dismissed warning followed by symptoms?).

CREATE TABLE IF NOT EXISTS stabilizer_warning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES exercises(id) ON DELETE CASCADE,
  -- StandardMuscleGroup token, restricted to the stabilizer-TRACKED muscles
  -- (services/shared/stabilizerTags.STABILIZER_TRACKED_MUSCLES). Widening the
  -- tracked set requires widening this CHECK in a follow-up migration.
  muscle_group TEXT NOT NULL CHECK (muscle_group IN (
    'erectors', 'rotator_cuff', 'rear_delts', 'forearms'
  )),
  -- Stabilizer-channel readiness ratio [0,1] at evaluation time.
  readiness_ratio NUMERIC NOT NULL CHECK (readiness_ratio >= 0 AND readiness_ratio <= 1),
  -- planned_load_kg / reference_load_kg at evaluation time.
  intensity_ratio NUMERIC NOT NULL CHECK (intensity_ratio > 0),
  planned_load_kg NUMERIC,
  reference_load_kg NUMERIC,
  response TEXT NOT NULL DEFAULT 'shown' CHECK (response IN (
    'shown', 'dismissed', 'proceeded'
  )),
  shown_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stabilizer_warning_events_user_time
  ON stabilizer_warning_events(user_id, shown_at DESC);
CREATE INDEX IF NOT EXISTS idx_stabilizer_warning_events_user_muscle
  ON stabilizer_warning_events(user_id, muscle_group, shown_at DESC);

ALTER TABLE stabilizer_warning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own stabilizer warning events"
  ON stabilizer_warning_events FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own stabilizer warning events"
  ON stabilizer_warning_events FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own stabilizer warning events"
  ON stabilizer_warning_events FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own stabilizer warning events"
  ON stabilizer_warning_events FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE stabilizer_warning_events IS
  'Pre-set stabilizer-fatigue warnings (services/muscleRecovery '
  'evaluateStabilizerWarning) with the user''s response; feeds the recovery '
  'debug page and threshold calibration.';
