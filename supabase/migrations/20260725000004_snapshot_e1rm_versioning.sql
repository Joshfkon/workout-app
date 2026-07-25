-- ADD 1: versioned e1RM backfill support for exercise_performance_snapshots.
--
-- Existing rows were written by an RPE-blind, formula-divergent estimator
-- (five implementations pre-Phase-1). The backfill
-- (scripts/backfillSnapshotE1rm.ts) recomputes every row with the canonical
-- RPE-aware estimator so trend charts stop mixing vintages.
--
-- VERSIONED, NOT IN-PLACE: the original value is preserved in
-- estimated_e1rm_legacy (written once, never overwritten on re-runs) and
-- e1rm_version records which estimator produced the live value:
--   1 = legacy writers (pre-canonical)
--   2 = canonical estimator (services/shared/e1rm), RPE-aware,
--       NULL when no set of the session is estimable
-- Schema-only change; row values are touched only by the audited script.

ALTER TABLE exercise_performance_snapshots
  ADD COLUMN IF NOT EXISTS estimated_e1rm_legacy DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS e1rm_version INTEGER NOT NULL DEFAULT 1;
