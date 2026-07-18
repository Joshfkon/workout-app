-- Date-spanned training phases (bulk / cut / recomp / maintenance), the
-- first-class entity behind the Body tab's phase-aware assessment. Unlike
-- phase_history (an append-only log of current-phase switches with no end
-- dates), these are user-editable retroactive SPANS with an optional signed
-- weekly rate target.
--
-- Days are stored as localDay strings ('YYYY-MM-DD'), consistent with how the
-- app buckets days everywhere else; all comparisons go through
-- lib/date/localDay. Invariants (no overlaps, at most one open-ended phase,
-- start <= end) are enforced in application logic (services/phasePlanning.ts),
-- not DB triggers — phases are low-frequency single-writer rows.
CREATE TABLE IF NOT EXISTS training_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase_type TEXT NOT NULL CHECK (phase_type IN ('bulk', 'cut', 'recomp', 'maintenance')),
  -- localDay 'YYYY-MM-DD'
  start_day TEXT NOT NULL,
  -- null = current/active phase
  end_day TEXT,
  -- Signed lb/week: +0.5 for a bulk, -1.0 for a cut, null for recomp/maintenance
  target_rate_lbs_per_week NUMERIC,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_phases_user_start
  ON training_phases(user_id, start_day DESC);

ALTER TABLE training_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own training phases"
  ON training_phases FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own training phases"
  ON training_phases FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own training phases"
  ON training_phases FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own training phases"
  ON training_phases FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE training_phases IS
  'User-editable bulk/cut/recomp/maintenance date spans driving the phase-aware body assessment';
