-- Per-muscle post-session feedback (RP-style auto-regulation inputs).
-- pump + workload are captured at the END of the session that trained the muscle;
-- soreness_before is written later, at the START of the next session that hits
-- the same muscle (it describes recovery from THIS session, so it lives on this row).
CREATE TABLE IF NOT EXISTS session_muscle_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  muscle_group TEXT NOT NULL,
  -- 0 none, 1 mild, 2 sore (healed just in time), 3 still sore at next session
  soreness_before SMALLINT CHECK (soreness_before >= 0 AND soreness_before <= 3),
  -- 0 none, 1 mild, 2 good, 3 extreme
  pump SMALLINT CHECK (pump >= 0 AND pump <= 3),
  -- 0 too easy, 1 just right, 2 pushed it, 3 too much
  workload SMALLINT CHECK (workload >= 0 AND workload <= 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, muscle_group)
);

CREATE INDEX IF NOT EXISTS idx_session_muscle_feedback_user
  ON session_muscle_feedback(user_id, muscle_group, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_muscle_feedback_session
  ON session_muscle_feedback(session_id);

ALTER TABLE session_muscle_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own muscle feedback"
  ON session_muscle_feedback FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own muscle feedback"
  ON session_muscle_feedback FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own muscle feedback"
  ON session_muscle_feedback FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own muscle feedback"
  ON session_muscle_feedback FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE session_muscle_feedback IS
  'Per-muscle soreness/pump/workload feedback driving weekly set progression (weeklyProgressionEngine)';
