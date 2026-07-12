-- Per-user training-phase history (bulk / cut / maintenance intervals).
-- Until now only the CURRENT phase existed (users.goal, plus the v3.3 macro
-- calculator's nutrition_targets.phase_status.phaseStartDate). Date-scoped
-- features — the nutrition calendar's phase-aware compliance rings — need to
-- know which phase was active on an arbitrary past day, since a month can
-- span a cut→bulk switch. Rows are appended by updateTrainingPhase
-- (lib/actions/phase.ts); "phase on date X" = the row with the greatest
-- started_on <= X (dates before the earliest row fall back to users.goal).
CREATE TABLE IF NOT EXISTS phase_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('bulk', 'cut', 'maintenance')),
  -- Local date the phase became active. One row per day: switching phase
  -- twice in a day keeps only the final choice (upsert on this key).
  started_on DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, started_on)
);

CREATE INDEX IF NOT EXISTS idx_phase_history_user_started
  ON phase_history(user_id, started_on DESC);

ALTER TABLE phase_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own phase history"
  ON phase_history FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own phase history"
  ON phase_history FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own phase history"
  ON phase_history FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own phase history"
  ON phase_history FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE phase_history IS
  'Append-only log of training phase changes; resolves phase-on-date for the nutrition calendar';
