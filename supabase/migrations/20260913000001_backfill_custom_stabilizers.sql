-- Backfill exercises.stabilizers for CUSTOM exercises that duplicate a
-- classified stock movement under a different name.
--
-- WHY: the stabilizer-recovery channel (services/muscleRecovery — stabilizer
-- dose + the pre-set warning) is gated entirely on `stabilizers` tags. The
-- stock seed (20260825000002) deliberately never touched custom rows, and the
-- read-time fallback (exerciseService.mapDbExercise and friends) deliberately
-- never falls back for them — so a custom row like 'Shrug (Dumbbell)' created
-- before the channel shipped carries '{}' and silently opts out of both the
-- warning and the dose credit, even though the classified 'Dumbbell Shrug' is
-- the same movement. On a custom row, '{}' is indistinguishable from
-- never-classified (the exercise-details About tab already flags it as
-- incomplete data), so an empty row matching a classified stock name gets the
-- stock classification once, here.
--
-- SOURCE OF TRUTH: services/shared/stabilizerTags.ts
-- (STABILIZERS_BY_EXERCISE_NAME). A drift-guard test parses THIS FILE and
-- compares the canonical VALUES list to that map
-- (services/__tests__/stabilizerCustomBackfill.test.ts) — edit the map and
-- this migration together or that test fails.
--
-- MATCHING: names are compared as normalized token SETS — lowercase, split on
-- any non-alphanumeric run, deduplicated, sorted — so 'Shrug (Dumbbell)'
-- matches 'Dumbbell Shrug'. The drift-guard test asserts the canonical map's
-- token sets are pairwise unique, so a custom row can never match two entries
-- with different tags.
--
-- SCOPE, deliberately:
--   * custom rows only (is_custom IS TRUE) — the stock seed already owns
--     stock rows;
--   * empty rows only: a custom row that already carries stabilizer tags
--     (AI-completed, variation-inherited, or user-edited) is never touched;
--   * one-time data repair: the read-time rule that custom rows never fall
--     back to the name map is unchanged;
--   * re-runnable: idempotent UPDATE, no data deleted.

CREATE OR REPLACE FUNCTION pg_temp.stabilizer_name_tokens(txt TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $fn$
  SELECT COALESCE(array_agg(DISTINCT tok ORDER BY tok), ARRAY[]::TEXT[])
  FROM regexp_split_to_table(lower(regexp_replace(txt, '[^a-zA-Z0-9]+', ' ', 'g')), ' ') AS tok
  WHERE tok <> '';
$fn$;

WITH canonical(name, stabs) AS (
  VALUES
    ('Deadlift', ARRAY['erectors','forearms']),
    ('Sumo Deadlift', ARRAY['erectors','forearms']),
    ('Romanian Deadlift', ARRAY['erectors','forearms']),
    ('Stiff Leg Deadlift', ARRAY['erectors','forearms']),
    ('Single Leg RDL', ARRAY['erectors','forearms']),
    ('Good Morning', ARRAY['erectors']),
    ('Cable Pull Through', ARRAY['erectors','forearms']),
    ('Barbell Back Squat', ARRAY['erectors']),
    ('Smith Machine Squat', ARRAY['erectors']),
    ('Walking Lunges', ARRAY['erectors']),
    ('Reverse Lunge', ARRAY['erectors']),
    ('Step Up', ARRAY['erectors']),
    ('Standing Calf Raise', ARRAY['erectors']),
    ('Smith Machine Calf Raise', ARRAY['erectors']),
    ('Farmer''s Carry', ARRAY['erectors']),
    ('Suitcase Carry', ARRAY['erectors','forearms']),
    ('Overhead Carry', ARRAY['erectors','rotator_cuff']),
    ('Barbell Row', ARRAY['erectors','forearms']),
    ('Meadows Row', ARRAY['erectors','forearms']),
    ('Cable Row', ARRAY['erectors','forearms']),
    ('Wide-Grip Seated Cable Row', ARRAY['erectors','forearms']),
    ('Dumbbell Row', ARRAY['forearms']),
    ('Seated Machine Row', ARRAY['forearms']),
    ('Chest Supported Row', ARRAY['forearms']),
    ('Seal Row', ARRAY['forearms']),
    ('Pull-Ups', ARRAY['forearms']),
    ('Assisted Pull-Up', ARRAY['forearms']),
    ('Assisted Pull-Up Machine', ARRAY['forearms']),
    ('Lat Pulldown', ARRAY['forearms']),
    ('Close Grip Lat Pulldown', ARRAY['forearms']),
    ('Straight Arm Pulldown', ARRAY['forearms']),
    ('Hanging Leg Raise', ARRAY['forearms']),
    ('Barbell Shrug', ARRAY['erectors','forearms']),
    ('Dumbbell Shrug', ARRAY['erectors','forearms']),
    ('Upright Row', ARRAY['forearms','rotator_cuff']),
    ('Cable Upright Row', ARRAY['forearms','rotator_cuff']),
    ('Barbell Bench Press', ARRAY['rotator_cuff','rear_delts']),
    ('Dumbbell Bench Press', ARRAY['rotator_cuff','rear_delts']),
    ('Incline Dumbbell Press', ARRAY['rotator_cuff','rear_delts']),
    ('Decline Barbell Press', ARRAY['rotator_cuff','rear_delts']),
    ('Machine Chest Press', ARRAY['rotator_cuff','rear_delts']),
    ('Smith Machine Bench Press', ARRAY['rotator_cuff','rear_delts']),
    ('Smith Machine Incline Press', ARRAY['rotator_cuff','rear_delts']),
    ('Close Grip Bench Press', ARRAY['rotator_cuff','rear_delts']),
    ('Dips (Chest Focus)', ARRAY['rotator_cuff','rear_delts']),
    ('Dips (Tricep Focus)', ARRAY['rotator_cuff','rear_delts']),
    ('Assisted Dip Machine', ARRAY['rotator_cuff','rear_delts']),
    ('Overhead Press', ARRAY['rotator_cuff','rear_delts','erectors']),
    ('Dumbbell Shoulder Press', ARRAY['rotator_cuff','rear_delts']),
    ('Smith Machine Shoulder Press', ARRAY['rotator_cuff','rear_delts']),
    ('Face Pull', ARRAY['rotator_cuff']),
    ('Rear Delt Fly', ARRAY['rotator_cuff']),
    ('Rear Delt Machine', ARRAY['rotator_cuff']),
    ('Reverse Cable Crossover', ARRAY['rotator_cuff']),
    ('Prone Y-Raise', ARRAY['rotator_cuff'])
)
UPDATE exercises e
   SET stabilizers = c.stabs
  FROM canonical c
 WHERE e.is_custom IS TRUE
   AND (e.stabilizers IS NULL OR e.stabilizers = '{}')
   AND pg_temp.stabilizer_name_tokens(e.name) = pg_temp.stabilizer_name_tokens(c.name);
