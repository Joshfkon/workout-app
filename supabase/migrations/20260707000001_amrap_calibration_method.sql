-- ============================================
-- AMRAP CALIBRATION METHOD VERSIONING
-- The calibration prediction is now fatigue-adjusted: prior sets' implied
-- maxes are decayed for the working sets performed between the report and
-- the AMRAP, so normal intra-session rep decline no longer reads as RIR
-- overestimation.
--
-- Existing rows were computed with the naive method and would pollute the
-- new bias average, so records are versioned. Legacy rows keep
-- method = 'naive_v1' and are excluded from rolling bias calculations; the
-- calibration engine recomputes historical points from raw set_logs (which
-- retain the inputs), so no backfill of this table is needed.
-- ============================================

ALTER TABLE amrap_calibrations
  ADD COLUMN IF NOT EXISTS raw_predicted_max_reps NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'naive_v1';

ALTER TABLE amrap_calibrations
  ADD CONSTRAINT amrap_calibrations_method_check
  CHECK (method IN ('naive_v1', 'fatigue_adjusted_v2'));

COMMENT ON COLUMN amrap_calibrations.method IS 'How predicted_max_reps/bias were computed. naive_v1 = raw reps+RIR average (not fatigue-adjusted, excluded from rolling bias); fatigue_adjusted_v2 = decayed per intervening working set.';
COMMENT ON COLUMN amrap_calibrations.raw_predicted_max_reps IS 'Naive (non-fatigue-adjusted) prediction kept for auditability; predicted_max_reps holds the fatigue-adjusted value under fatigue_adjusted_v2.';
