-- Manual stock-catalog attribution correction (user report, 2026-08-14):
-- 'Dead Hang' was tagged forearms + [lats]. A dead hang loads the grip to
-- failure and holds the lats at long length under bodyweight traction — the
-- shoulder girdle is supporting, not working through a range. Crediting it as
-- lat work meant two sets fed 1.0 effective set into a lats MEV of 6-8 and,
-- worse, registered as a lat training bout for muscle-recovery gating. Primary
-- (forearms) is correct and unchanged; the lats secondary is removed.
--
-- Scope note: this is the DATA half of a two-part fix. The model half — a
-- recovery window that scales with dose instead of charging nearly the full
-- base window for any nonzero involvement — lands alongside it in
-- services/muscleRecovery.ts. Neither is sufficient on its own: retagging one
-- exercise does not stop the next light secondary from doing the same thing,
-- and the model fix alone would still credit lat volume that was never done.
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
SELECT id, '20260814000001', 'dead_hang_drop_lats_secondary',
       primary_muscle, secondary_muscles, primary_muscle,
       ARRAY[]::TEXT[]
FROM exercises
WHERE name = 'Dead Hang'
  AND is_custom IS NOT TRUE
  AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                 WHERE migration = '20260814000001');

UPDATE exercises SET secondary_muscles = ARRAY[]::TEXT[] WHERE name = 'Dead Hang' AND is_custom IS NOT TRUE;
