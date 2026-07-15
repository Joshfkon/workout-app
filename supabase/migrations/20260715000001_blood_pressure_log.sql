-- Blood pressure log (manual capture).
--
-- Unlike sleep_log / weight_log (one row per user per local day), blood
-- pressure is often measured MORE THAN ONCE a day (morning vs evening,
-- pre/post-workout, doctor office). So there is deliberately NO UNIQUE
-- constraint on (user_id, local_day): every save is a NEW reading. A day's
-- "value" is the average of that day's readings, computed in the app layer
-- (services/bloodPressure.ts) — the DB just stores raw readings.
--
-- Columns:
--   measured_at  full timestamp of the reading (defaults to now, editable in
--                the UI so a user can back-date a reading they wrote down).
--   local_day    YYYY-MM-DD in the USER'S local timezone, written via
--                getLocalDateString — the grouping/filtering key, same
--                convention as sleep_log.local_day and daily_check_ins.date.
--   systolic     mmHg, adult range guard.
--   diastolic    mmHg, adult range guard; must be below systolic.
--   pulse        optional resting heart rate, bpm.
--   context      optional measurement context (morning / evening / etc.).
--   notes        optional free text.
--   source       'manual' today; leaves room for a future wearable import.
--
-- Consumers:
--   - Wellness tab Blood Pressure card: latest reading + category + 7-day avg
--   - /dashboard/blood-pressure history page: readings grouped by day, trend
--     chart (systolic + diastolic), period stats and filters.
CREATE TABLE IF NOT EXISTS blood_pressure_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  local_day DATE NOT NULL,
  systolic INTEGER NOT NULL CHECK (systolic BETWEEN 70 AND 250),
  diastolic INTEGER NOT NULL CHECK (diastolic BETWEEN 40 AND 150),
  pulse INTEGER CHECK (pulse IS NULL OR pulse BETWEEN 30 AND 220),
  context TEXT CHECK (
    context IS NULL OR context IN (
      'morning', 'evening', 'pre_workout', 'post_workout', 'doctor_office', 'other'
    )
  ),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A meaningful reading always has systolic above diastolic.
  CONSTRAINT bp_systolic_above_diastolic CHECK (systolic > diastolic)
);

CREATE INDEX IF NOT EXISTS idx_blood_pressure_log_user_day
  ON blood_pressure_log(user_id, local_day DESC);

CREATE INDEX IF NOT EXISTS idx_blood_pressure_log_user_measured
  ON blood_pressure_log(user_id, measured_at DESC);

ALTER TABLE blood_pressure_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own blood pressure"
  ON blood_pressure_log FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own blood pressure"
  ON blood_pressure_log FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own blood pressure"
  ON blood_pressure_log FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own blood pressure"
  ON blood_pressure_log FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE blood_pressure_log IS
  'Blood pressure readings (systolic/diastolic + optional pulse/context/notes). One or more readings per user per local day; feeds the Wellness BP card and the blood-pressure history/trends page.';
