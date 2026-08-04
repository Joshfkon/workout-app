-- Motion capture: persist the calibration-free analysis metrics with each
-- capture (display-only feature; nothing reads these yet).
--
-- Shape (types/motion.ts CaptureAnalysisMetrics): per-rep ROM, mean/peak
-- concentric angular velocity, bottom dwell, and bottom-turnaround peak
-- angular acceleration, plus capture-level PC1 variance share and the
-- PC1-to-gravity angle so later analysis can filter on capture quality.
-- This is the feature set for a future velocity-loss -> RIR fit. It is
-- DESCRIPTIVE data: no field judges a rep, and nothing feeds prescription,
-- progression, or logged set data.

ALTER TABLE motion_captures
  ADD COLUMN IF NOT EXISTS analysis_metrics JSONB;

COMMENT ON COLUMN motion_captures.analysis_metrics IS
  'CaptureAnalysisMetrics (types/motion.ts): per-rep ROM/velocity/dwell/turnaround-acceleration from the calibration-free pipeline + PC1 variance share and PC1-to-gravity angle. Feature set for a future velocity-loss->RIR fit; display-only, read by nothing.';
