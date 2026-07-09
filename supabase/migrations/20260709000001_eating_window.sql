-- ============================================================
-- EATING WINDOW (per-user, drives intake pacing verdicts)
--
-- The Home Nutrition tile and the Log page's Today So Far grid judge
-- "on pace / behind / ahead" against the fraction of the eating window
-- that has elapsed. Default window is 07:00–21:00; these columns let the
-- user configure it. Stored as minutes from midnight on nutrition_targets
-- (one row per user, same row the pacing targets come from).
-- ============================================================

ALTER TABLE nutrition_targets
  ADD COLUMN IF NOT EXISTS eating_window_start_min INTEGER NOT NULL DEFAULT 420,
  ADD COLUMN IF NOT EXISTS eating_window_end_min INTEGER NOT NULL DEFAULT 1260;

-- Window must sit inside a day and be at least 2 hours long, so the
-- expected-by-now fraction is always well defined (and the first-hour
-- pacing grace period can't cover the whole window).
ALTER TABLE nutrition_targets
  ADD CONSTRAINT valid_eating_window CHECK (
    eating_window_start_min >= 0
    AND eating_window_end_min <= 1440
    AND eating_window_end_min - eating_window_start_min >= 120
  );

COMMENT ON COLUMN nutrition_targets.eating_window_start_min IS 'Eating window start, minutes from midnight local time (default 420 = 07:00)';
COMMENT ON COLUMN nutrition_targets.eating_window_end_min IS 'Eating window end, minutes from midnight local time (default 1260 = 21:00)';
