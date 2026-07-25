-- Canonical e1RM (Phase 1): the estimator returns NO estimate for sets with
-- more than 15 effective reps (reps + RIR) instead of extrapolating. The
-- snapshot writer must therefore be able to store "no estimate" honestly.
--
-- Schema-only change: existing rows are untouched (their values were written
-- by the old formulas and are addressed by the Phase 6 migration/comms work).
-- NULL means "no valid e1RM estimate for this session", which readers must
-- render as absent — never as 0.

ALTER TABLE exercise_performance_snapshots
  ALTER COLUMN estimated_e1rm DROP NOT NULL;
