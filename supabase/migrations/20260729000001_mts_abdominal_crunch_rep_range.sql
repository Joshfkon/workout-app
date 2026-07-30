-- 2026-07-29 prescription-defects remediation, step 6 (data fix).
--
-- MTS Abdominal Crunch: configured rep range 8-12 -> 12-18. The lifter's
-- sessions consistently log ~15 reps; against 8-12 the rep-total planner
-- had to choose between violating the range and mispricing the load. The
-- range moves to match how the exercise is actually trained.
--
-- Scope (config only — logged set data is never altered):
--   - the exercise's default range;
--   - block targets on sessions that have NOT been completed (planned /
--     in-progress). Completed sessions keep their historical targets: they
--     are a record of what was prescribed at the time.
--   - template rows storing the textual '8-12' default for this exercise.
--
-- Guarded on the current value so a user who already customized the range
-- is not overwritten.
--
-- Companion audit (review-only, no writes):
-- scripts/auditRepRangeLast3Sessions.ts lists every other exercise whose
-- last 3 sessions consistently logged outside its configured range.

UPDATE exercises
SET default_rep_range = '{12,18}'
WHERE name = 'MTS Abdominal Crunch'
  AND default_rep_range = '{8,12}';

UPDATE exercise_blocks eb
SET target_rep_range = '{12,18}'
FROM workout_sessions ws
WHERE eb.workout_session_id = ws.id
  AND ws.state IN ('planned', 'in_progress')
  AND eb.target_rep_range = '{8,12}'
  AND eb.exercise_id IN (SELECT id FROM exercises WHERE name = 'MTS Abdominal Crunch');

UPDATE workout_template_exercises
SET default_reps = '12-18'
WHERE exercise_name = 'MTS Abdominal Crunch'
  AND default_reps = '8-12';
