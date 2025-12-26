-- Add phase_status column to nutrition_targets for aggressive phase tracking
ALTER TABLE nutrition_targets
ADD COLUMN IF NOT EXISTS phase_status JSONB NULL;

COMMENT ON COLUMN nutrition_targets.phase_status IS 'Aggressive phase tracking: currentWeeksInPhase, plannedDurationWeeks, phaseStartDate. Used for v3.3 macro calculator to enforce time limits on aggressive cuts.';

