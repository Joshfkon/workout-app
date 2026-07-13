-- User-initiated joint pain events.
-- Set-level events (from the in-set joint picker) carry exercise_id + set_log_id;
-- the once-per-session finish-summary report carries neither.
-- Consumers:
--   - deload advisor signal 5: severity-weighted count over the trailing 2 weeks
--   - exercise-level pattern notice: >=3 events on one exercise within 6 weeks
--   - 'stop' severity immediately softens that exercise's next-set suggestion
CREATE TABLE IF NOT EXISTS joint_pain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES exercises(id) ON DELETE CASCADE,
  set_log_id UUID REFERENCES set_logs(id) ON DELETE SET NULL,
  joint TEXT NOT NULL CHECK (joint IN (
    'elbow', 'shoulder', 'knee', 'hip', 'wrist', 'lower_back', 'other'
  )),
  -- twinge < discomfort < pain < stop (stop = had to stop the set/exercise)
  severity TEXT NOT NULL CHECK (severity IN ('twinge', 'discomfort', 'pain', 'stop')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_joint_pain_events_user_time
  ON joint_pain_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_joint_pain_events_user_exercise
  ON joint_pain_events(user_id, exercise_id, created_at DESC);

ALTER TABLE joint_pain_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own joint pain events"
  ON joint_pain_events FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own joint pain events"
  ON joint_pain_events FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own joint pain events"
  ON joint_pain_events FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own joint pain events"
  ON joint_pain_events FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE joint_pain_events IS
  'User-initiated joint pain reports; deload signal 5 and exercise-swap pattern detection';
