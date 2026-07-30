-- Phase 4 (muscle-attribution work): split triceps volume tracking into two
-- fine members — triceps_long (long head) and triceps_lat_med (lateral +
-- medial combined; they are never programmed separately in practice).
--
-- Attribution rule (approved 2026-07-27): elbow extension with the shoulder
-- flexed/overhead credits the long head substantially (long-head primary,
-- lateral/medial secondary); with the shoulder neutral the long-head credit
-- drops sharply (lateral/medial primary, long-head 0.5 secondary); with the
-- shoulder extended (kickbacks) the long head is maximally shortened and
-- gets no credit. Pressing movements credit lateral/medial and give the
-- long head little — press 'triceps' secondaries become 'triceps_lat_med'.
--
-- The coarse 'triceps' token remains VALID and keeps its credit on the
-- coarse standard muscle (traps/calves precedent) — it never smears across
-- the heads; only fine tags feed them. Reachability gating hides the split
-- from users whose exercise library can't feed it.
--
-- Part 1 below is NAME-KEYED (stock rows; parsed by scripts/seedTagParser.js
-- so the generated fallback tags pick the split up via
-- `npm run generate:exercise-tags`). Part 2 is PATTERN-KEYED for user-created
-- rows, using "UPDATE public.exercises" so the seed-tag parser skips it
-- (it throws on pattern-keyed bare "UPDATE exercises" statements), with
-- previous tags recorded in exercise_muscle_retag_audit (reversible).

-- ════════════════════════════════════════════════════════════════════════
-- Part 1 — stock rows, name-keyed
-- ════════════════════════════════════════════════════════════════════════

-- Overhead (shoulder flexed) elbow extension → long head
UPDATE exercises SET primary_muscle = 'triceps_long', secondary_muscles = ARRAY['triceps_lat_med']
  WHERE name IN ('Overhead Tricep Extension', 'Cable Overhead Tricep Extension', 'Katana Tricep Extension');

-- Lying extensions (~90° shoulder flexion, long head meaningfully lengthened)
UPDATE exercises SET primary_muscle = 'triceps_long', secondary_muscles = ARRAY['triceps_lat_med']
  WHERE name IN ('Skull Crusher', 'Triceps Extension (Dumbbell)', 'Machine Tricep Extension');

-- Neutral shoulder (pushdowns) → lateral/medial, long head at 0.5
UPDATE exercises SET primary_muscle = 'triceps_lat_med', secondary_muscles = ARRAY['triceps_long']
  WHERE name IN ('Tricep Pushdown', 'Cable Tricep Pushdown', 'Rope Tricep Pushdown');

-- Shoulder extended (kickbacks) → lateral/medial only
UPDATE exercises SET primary_muscle = 'triceps_lat_med', secondary_muscles = ARRAY[]::TEXT[]
  WHERE name = 'Dumbbell Kickback';

-- Pressing with a triceps-primary tag → lateral/medial, secondaries kept
UPDATE exercises SET primary_muscle = 'triceps_lat_med', secondary_muscles = ARRAY['chest','front_delts']
  WHERE name = 'Close Grip Bench Press';
UPDATE exercises SET primary_muscle = 'triceps_lat_med', secondary_muscles = ARRAY['chest_lower','front_delts']
  WHERE name IN ('Dips (Tricep Focus)', 'Assisted Dip Machine');

-- Press/dip 'triceps' SECONDARIES → 'triceps_lat_med' (full-array rewrites,
-- name-keyed so the parser applies them to the snapshot)
UPDATE exercises SET secondary_muscles = ARRAY['front_delts','triceps_lat_med']
  WHERE name IN ('Barbell Bench Press', 'Dumbbell Bench Press', 'Machine Chest Press', 'Smith Machine Bench Press');
UPDATE exercises SET secondary_muscles = ARRAY['chest_upper','front_delts','triceps_lat_med']
  WHERE name IN ('Decline Barbell Press', 'Dips (Chest Focus)');
UPDATE exercises SET secondary_muscles = ARRAY['chest_lower','front_delts','triceps_lat_med']
  WHERE name IN ('Incline Dumbbell Press', 'Smith Machine Incline Press');
UPDATE exercises SET secondary_muscles = ARRAY['triceps_lat_med','chest_upper']
  WHERE name IN ('Smith Machine Shoulder Press', 'Dumbbell Shoulder Press', 'Overhead Press');
UPDATE exercises SET secondary_muscles = ARRAY['triceps_lat_med']
  WHERE name = 'L-Sit';

-- ════════════════════════════════════════════════════════════════════════
-- Part 2 — user-created rows, pattern-keyed (audited, first-match-wins)
-- ════════════════════════════════════════════════════════════════════════

-- Overhead/French/skull-class extensions → long head
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'triceps'
    AND name ~* 'overhead|skull|french|katana|behind.?the.?head'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000002')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000002', 'triceps_overhead', primary_muscle, secondary_muscles, 'triceps_long',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[]) || ARRAY['triceps_lat_med']) AS s
        WHERE lower(s) NOT IN ('triceps', 'triceps_long'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000002' AND a.rule = 'triceps_overhead';

-- Pushdown-class (neutral shoulder) → lateral/medial + long 0.5
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'triceps'
    AND name ~* 'pushdown|push.?down'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000002')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000002', 'triceps_pushdown', primary_muscle, secondary_muscles, 'triceps_lat_med',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[]) || ARRAY['triceps_long']) AS s
        WHERE lower(s) NOT IN ('triceps', 'triceps_lat_med'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000002' AND a.rule = 'triceps_pushdown';

-- Kickbacks (shoulder extended) → lateral/medial, no long-head credit
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'triceps'
    AND name ~* 'kickback'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000002')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000002', 'triceps_kickback', primary_muscle, secondary_muscles, 'triceps_lat_med',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[])) AS s
        WHERE lower(s) NOT IN ('triceps', 'triceps_lat_med'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000002' AND a.rule = 'triceps_kickback';

-- Remaining generic extensions (lying-class default, medium confidence)
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'triceps'
    AND name ~* 'extension|crusher'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000002')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000002', 'triceps_extension', primary_muscle, secondary_muscles, 'triceps_long',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[]) || ARRAY['triceps_lat_med']) AS s
        WHERE lower(s) NOT IN ('triceps', 'triceps_long'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000002' AND a.rule = 'triceps_extension';

-- Pressing/dip-class with triceps primary → lateral/medial, secondaries kept
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'triceps'
    AND name ~* 'dip|close.?grip|press'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000002')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000002', 'triceps_press', primary_muscle, secondary_muscles, 'triceps_lat_med',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[])) AS s
        WHERE lower(s) NOT IN ('triceps', 'triceps_lat_med'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000002' AND a.rule = 'triceps_press';

-- Press/push/dip/bench rows whose SECONDARIES include coarse 'triceps':
-- pressing feeds lateral/medial (element-wise replace; other rows keep the
-- coarse secondary — it still credits the coarse triceps member correctly).
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE 'triceps' = ANY(coalesce(secondary_muscles, '{}'::text[]))
    AND name ~* 'press|push.?up|dip|bench'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000002')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000002', 'press_secondary_triceps', primary_muscle, secondary_muscles, primary_muscle,
  array_replace(secondary_muscles, 'triceps', 'triceps_lat_med')
FROM candidates;

UPDATE public.exercises e
SET secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000002' AND a.rule = 'press_secondary_triceps';

-- Rows no rule matches keep coarse 'triceps' — still valid, credit stays on
-- the coarse member, and the runtime dry-run report surfaces them for review.
