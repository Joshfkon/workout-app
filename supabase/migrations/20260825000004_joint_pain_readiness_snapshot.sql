-- Readiness snapshot on joint pain events (the injury/tweak tag).
--
-- A joint-pain report IS the app's injury/tweak tag — set-level via the
-- in-set picker, session-level via the finish summary. For threshold
-- calibration ("what did every recovery signal look like at the moment
-- something hurt?") each event now snapshots the full readiness state at
-- write time:
--
--   {
--     "capturedAt": "<ISO>",
--     "muscles":     { "<StandardMuscleGroup>": { "status": "...", "ratio": 0.42 }, ... },
--     "stabilizers": { "<tracked muscle>":      { "status": "...", "ratio": 0.31 }, ... }
--   }
--
-- muscles = the mover model (computeMuscleRecovery), stabilizers = the
-- stabilizer channel (computeStabilizerRecovery). Shape is pinned by the
-- ReadinessSnapshot type in app/(dashboard)/dashboard/workout/[id]/_lib/
-- readinessSnapshot.ts. The snapshot is deliberately DENORMALIZED: engine
-- constants change over time, so the values at report time are not
-- recomputable later — this is the sanctioned moment-capture exception to
-- the no-stored-aggregates policy (see 20260730000001_drop_weekly_muscle_volume).
--
-- Additive and nullable; events written by older clients simply carry NULL.

ALTER TABLE joint_pain_events
  ADD COLUMN IF NOT EXISTS readiness_snapshot JSONB;

COMMENT ON COLUMN joint_pain_events.readiness_snapshot IS
  'Per-muscle mover readiness + stabilizer-channel readiness at report time '
  '(ReadinessSnapshot in _lib/readinessSnapshot.ts). Moment-capture: not '
  'recomputable once engine constants move. NULL on events from older clients.';
