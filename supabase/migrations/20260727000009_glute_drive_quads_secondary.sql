-- Manual stock-catalog attribution correction (user report, 2026-07-27):
-- the Glute Drive Machine (hip-thrust machine) was tagged glutes +
-- [hamstrings] only. The knee-extension component of driving the platform
-- makes the quads a genuine secondary — for some lifters the limiting
-- muscle — so weekly volume and muscle-recovery gating were blind to real
-- quad work. Add 'quads' as a secondary; primary and hamstrings unchanged.
--
-- AUDIT + REVERSIBILITY (policy: audit before data changes): previous tags
-- are recorded in exercise_muscle_retag_audit BEFORE the update; rollback is
-- a rejoin against that table. The candidate filter excludes rows already
-- audited by this migration so a re-run cannot duplicate audit rows.
--
-- PARSER NOTE: the UPDATE is name-keyed and UNQUALIFIED on purpose — this is
-- a stock-catalog tag change and must feed the generated tag snapshot
-- (services/generated/seedExerciseTags.ts via scripts/seedTagParser.js).
-- Run `npm run generate:exercise-tags` after adding statements here.

INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000003', 'glute_drive_quads_secondary',
       primary_muscle, secondary_muscles, primary_muscle,
       ARRAY['hamstrings', 'quads']
FROM exercises
WHERE name = 'Glute Drive Machine'
  AND is_custom IS NOT TRUE
  AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                 WHERE migration = '20260727000003');

UPDATE exercises SET secondary_muscles = ARRAY['hamstrings', 'quads'] WHERE name = 'Glute Drive Machine' AND is_custom IS NOT TRUE;
