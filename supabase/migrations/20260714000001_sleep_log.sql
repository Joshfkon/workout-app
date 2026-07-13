-- Sleep log (Phase 1 — manual capture).
-- One editable entry per user per LOCAL day; a second save for the same day
-- edits the row (UNIQUE user_id + local_day, writers upsert), never duplicates.
-- `source` distinguishes manual entries from a future HealthKit import
-- (Phase 2); manual entries override imported ones by upserting the same row.
-- Consumers:
--   - Home grid Sleep card: last night + 7-day average + trailing-week sparkline
--   - muscle recovery heuristic: trailing-2-night avg scales recovery windows
--   - deload advisor: chronic short sleep (7d avg) adds a small capped signal
--   - TDEE/nutrition: intentionally NOT wired — sleep never touches calorie math
CREATE TABLE IF NOT EXISTS sleep_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- YYYY-MM-DD in the USER'S local timezone (the morning the night is logged
  -- against), written via getLocalDateString — same convention as
  -- daily_check_ins.date / food_log.logged_at.
  local_day DATE NOT NULL,
  hours NUMERIC(4, 2) NOT NULL CHECK (hours >= 0 AND hours <= 24),
  quality TEXT NOT NULL CHECK (quality IN ('poor', 'ok', 'good')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'healthkit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, local_day)
);

CREATE INDEX IF NOT EXISTS idx_sleep_log_user_day
  ON sleep_log(user_id, local_day DESC);

ALTER TABLE sleep_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sleep log"
  ON sleep_log FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sleep log"
  ON sleep_log FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sleep log"
  ON sleep_log FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sleep log"
  ON sleep_log FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE sleep_log IS
  'One sleep entry per user per local day (hours + poor/ok/good quality); feeds the home Sleep card, recovery windows and the deload advisor';
