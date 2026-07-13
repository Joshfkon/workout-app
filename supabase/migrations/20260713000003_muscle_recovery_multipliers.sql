-- Per-user, per-muscle learned recovery multiplier.
-- Scales the muscle's base recovery window in services/muscleRecovery.ts
-- (RECOVERY_CONFIG.windowHoursByMuscle). Learned from start-of-session
-- soreness answers: "still sore" when the model said fresh/recovering -> +0.05;
-- "wasn't sore" when the model said fatigued -> -0.05. Bounded 0.7-1.5.
-- muscle_group uses the 20-group StandardMuscleGroup vocabulary the recovery
-- heuristic is keyed on (types/schema.ts STANDARD_MUSCLE_GROUPS).
CREATE TABLE IF NOT EXISTS user_muscle_recovery_multipliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muscle_group TEXT NOT NULL CHECK (muscle_group IN (
    'chest_upper', 'chest_lower', 'front_delts', 'lateral_delts', 'rear_delts',
    'lats', 'upper_back', 'traps', 'biceps', 'triceps', 'forearms',
    'quads', 'hamstrings', 'glutes', 'glute_med', 'adductors', 'calves',
    'abs', 'obliques', 'erectors'
  )),
  recovery_multiplier NUMERIC(3, 2) NOT NULL DEFAULT 1.0
    CHECK (recovery_multiplier >= 0.7 AND recovery_multiplier <= 1.5),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, muscle_group)
);

CREATE INDEX IF NOT EXISTS idx_user_muscle_recovery_multipliers_user
  ON user_muscle_recovery_multipliers(user_id);

ALTER TABLE user_muscle_recovery_multipliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recovery multipliers"
  ON user_muscle_recovery_multipliers FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recovery multipliers"
  ON user_muscle_recovery_multipliers FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recovery multipliers"
  ON user_muscle_recovery_multipliers FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own recovery multipliers"
  ON user_muscle_recovery_multipliers FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE user_muscle_recovery_multipliers IS
  'Per-muscle learned recovery-window multiplier (0.7-1.5) from soreness feedback';
