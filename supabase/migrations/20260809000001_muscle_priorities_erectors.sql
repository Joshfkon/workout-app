-- Add 'erectors' to the user_muscle_priorities.muscle_group vocabulary.
--
-- WHY: erectors was promoted from a sub-muscle of 'back' to a standalone
-- top-level group (MUSCLE_GROUPS in types/schema.ts, COARSE_MUSCLES in
-- services/volumeBands.ts). It now has its own volume band, its own readiness
-- row and its own generator preset, so it must also be assignable a training
-- priority. The original CHECK list was written against the 13-group taxonomy
-- and would reject the insert.
--
-- NOT A LIVE BUG FIX: the settings UI never rendered a control for erectors,
-- and handleSave only writes priorities that differ from the default 3 — so no
-- upsert has ever carried 'erectors' and no existing row can violate anything.
-- This widens the domain FIRST so the UI change that ships alongside it (adding
-- erectors to the Core & Spine region) cannot fail on save.
--
-- PRESERVED DELIBERATELY: existing rows and the priority range 1–5. This only
-- widens the accepted domain; nothing is rewritten or deleted.
--
-- DRIFT GUARD: the key list below is asserted against MUSCLE_GROUPS in
-- services/__tests__/musclePriorityVocabulary.test.ts, which parses THIS FILE.
-- Adding a coarse muscle group without a follow-up migration fails that test.

ALTER TABLE user_muscle_priorities
  DROP CONSTRAINT IF EXISTS user_muscle_priorities_muscle_group_check;

ALTER TABLE user_muscle_priorities
  ADD CONSTRAINT user_muscle_priorities_muscle_group_check
  CHECK (muscle_group IN (
    'chest', 'back', 'shoulders', 'biceps', 'triceps',
    'quads', 'hamstrings', 'glutes', 'calves', 'abs',
    'adductors', 'forearms', 'traps',
    'erectors'
  ));

COMMENT ON TABLE user_muscle_priorities IS
  'Per-user training priority (1 = highest focus, 5 = maintenance) per coarse '
  'muscle group. muscle_group uses the legacy MuscleGroup vocabulary in '
  'types/schema.ts (MUSCLE_GROUPS) — keep the CHECK list in sync with that '
  'array; a regression test parses this migration to enforce it.';
