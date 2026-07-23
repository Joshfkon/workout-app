-- Widen the set_logs.reps bound from 100 to 600.
--
-- Duration-based exercises store seconds in the reps column (see
-- 20260110000001_add_exercise_type.sql), and the logging UI allows holds up
-- to 600 seconds — but the original CHECK capped reps at 100, so any hold or
-- carry longer than 1:40 passed UI validation and was then rejected at
-- insert. Widening a CHECK cannot invalidate existing rows.
--
-- Per-modality tightness (<=100 for rep_based, <=600 for duration_based) is
-- enforced in app-layer validation, which can join the exercise's modality;
-- a plain CHECK here cannot reference the exercises table.

ALTER TABLE set_logs DROP CONSTRAINT IF EXISTS set_logs_reps_check;
ALTER TABLE set_logs ADD CONSTRAINT set_logs_reps_check
  CHECK (reps >= 0 AND reps <= 600);
