-- HealthKit (Apple Health) read-only integration: sleep auto-fill source,
-- daily wellness metrics (HRV / resting HR), and per-type sync anchors.
-- All changes are additive; no existing rows are modified.

-- ---------------------------------------------------------------------------
-- 1. Sleep source on daily_check_ins
--    NULL / 'manual'  -> user-entered (manual ALWAYS wins over auto-fill)
--    'healthkit'      -> auto-filled from Apple Health, safe to overwrite
-- ---------------------------------------------------------------------------
ALTER TABLE daily_check_ins
  ADD COLUMN IF NOT EXISTS sleep_source TEXT
  CHECK (sleep_source IN ('manual', 'healthkit'));

COMMENT ON COLUMN daily_check_ins.sleep_source IS
  'Origin of sleep_hours: NULL/manual = user-entered (always wins), healthkit = auto-filled from Apple Health';

-- ---------------------------------------------------------------------------
-- 2. Daily wellness metrics (HRV SDNN, resting heart rate), keyed by local day
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_wellness_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,

  -- Heart rate variability (SDNN, milliseconds). NULL when the source wrote
  -- nothing for the day (e.g. Garmin often omits HRV) — absence is normal.
  hrv_sdnn_ms NUMERIC(6,2) CHECK (hrv_sdnn_ms > 0 AND hrv_sdnn_ms < 500),

  -- Resting heart rate (beats per minute).
  resting_hr_bpm NUMERIC(5,2) CHECK (resting_hr_bpm > 20 AND resting_hr_bpm < 200),

  source TEXT NOT NULL DEFAULT 'healthkit' CHECK (source IN ('healthkit')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, date, source)
);

ALTER TABLE daily_wellness_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wellness metrics"
  ON daily_wellness_metrics FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own wellness metrics"
  ON daily_wellness_metrics FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wellness metrics"
  ON daily_wellness_metrics FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own wellness metrics"
  ON daily_wellness_metrics FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_daily_wellness_metrics_user_date
  ON daily_wellness_metrics(user_id, date DESC);

COMMENT ON TABLE daily_wellness_metrics IS
  'Per-local-day wearable wellness metrics (HRV SDNN, resting HR) used for the global recovery modifier. Additive; per-type absence is expected.';

-- ---------------------------------------------------------------------------
-- 3. Sync anchors: incremental foreground pulls fetch only samples newer than
--    the persisted anchor (minus a lookback window handled in app code).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS healthkit_sync_anchors (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data_type TEXT NOT NULL
    CHECK (data_type IN ('sleep', 'hrv', 'resting_heart_rate', 'steps', 'active_energy')),
  -- End timestamp of the newest sample ingested for this type.
  last_sample_end_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, data_type)
);

ALTER TABLE healthkit_sync_anchors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sync anchors"
  ON healthkit_sync_anchors FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync anchors"
  ON healthkit_sync_anchors FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sync anchors"
  ON healthkit_sync_anchors FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sync anchors"
  ON healthkit_sync_anchors FOR DELETE
  USING (auth.uid() = user_id);

COMMENT ON TABLE healthkit_sync_anchors IS
  'Per-user, per-data-type anchor (newest ingested sample end time) for incremental HealthKit foreground sync.';

-- ---------------------------------------------------------------------------
-- 4. updated_at maintenance (reuses the shared trigger fn if present)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE TRIGGER update_daily_wellness_metrics_updated_at
      BEFORE UPDATE ON daily_wellness_metrics
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE TRIGGER update_healthkit_sync_anchors_updated_at
      BEFORE UPDATE ON healthkit_sync_anchors
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
