-- Interval training schedules ("every other day")
--
-- preferred_workout_days can only express schedules that repeat on a 7-day
-- grid. A cadence like "every other day" is 3.5 sessions/week and lands on
-- different weekdays each week, so it needs its own representation:
--
--   schedule_mode = 'fixed_days' -> preferred_workout_days drives the calendar
--   schedule_mode = 'interval'   -> train every training_interval_days days,
--                                   counting from mesocycles.start_date
--
-- Existing rows keep the fixed-weekday behavior they already had.

ALTER TABLE mesocycles
  ADD COLUMN IF NOT EXISTS schedule_mode TEXT NOT NULL DEFAULT 'fixed_days';

ALTER TABLE mesocycles
  ADD COLUMN IF NOT EXISTS training_interval_days INTEGER DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mesocycles_schedule_mode_check'
  ) THEN
    ALTER TABLE mesocycles
      ADD CONSTRAINT mesocycles_schedule_mode_check
      CHECK (schedule_mode IN ('fixed_days', 'interval'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mesocycles_training_interval_days_check'
  ) THEN
    ALTER TABLE mesocycles
      ADD CONSTRAINT mesocycles_training_interval_days_check
      CHECK (
        training_interval_days IS NULL
        OR (training_interval_days BETWEEN 2 AND 14)
      );
  END IF;

  -- An interval schedule without an interval would schedule nothing at all.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mesocycles_interval_requires_days_check'
  ) THEN
    ALTER TABLE mesocycles
      ADD CONSTRAINT mesocycles_interval_requires_days_check
      CHECK (schedule_mode <> 'interval' OR training_interval_days IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN mesocycles.schedule_mode IS
  '''fixed_days'' = same weekdays each week (preferred_workout_days); ''interval'' = every training_interval_days days from start_date.';

COMMENT ON COLUMN mesocycles.training_interval_days IS
  'Interval schedules only: train every N days counting from start_date (2 = every other day). NULL for fixed-day schedules.';
