-- Let user_muscle_priorities.muscle_group name a single HEAD, not only a
-- coarse group: side delts, upper chest, the triceps long head, and the other
-- prioritizable heads in MUSCLE_PRIORITY_HEADS (types/schema.ts).
--
-- WHY: a bodybuilder bringing up one head ("I couldn't target side delts
-- separately", UX panel) could only prioritize 'shoulders', which spread the
-- extra sets over all three delts. The builder now reads a head row as half
-- the group multiplier on its parent plus an exercise-choice lead for that
-- head (lib/training/builderDefaults priorityVolumeAdjustments).
--
-- PRESERVED DELIBERATELY: existing rows and the priority range 1–5. This only
-- widens the accepted domain; nothing is rewritten or deleted.
--
-- DRIFT GUARD: the key list below is asserted against MUSCLE_GROUPS plus
-- MUSCLE_PRIORITY_HEADS in services/__tests__/musclePriorityVocabulary.test.ts,
-- which parses THIS FILE.

ALTER TABLE user_muscle_priorities
  DROP CONSTRAINT IF EXISTS user_muscle_priorities_muscle_group_check;

ALTER TABLE user_muscle_priorities
  ADD CONSTRAINT user_muscle_priorities_muscle_group_check
  CHECK (muscle_group IN (
    'chest', 'back', 'shoulders', 'biceps', 'triceps',
    'quads', 'hamstrings', 'glutes', 'calves', 'abs',
    'adductors', 'forearms', 'traps',
    'erectors',
    'chest_upper', 'chest_lower',
    'front_delts', 'lateral_delts', 'rear_delts',
    'lats', 'upper_back',
    'triceps_long', 'triceps_lat_med',
    'glute_med',
    'gastrocnemius', 'soleus',
    'obliques',
    'upper_traps', 'mid_lower_traps'
  ));

COMMENT ON TABLE user_muscle_priorities IS
  'Per-user training priority (1 = highest focus, 5 = maintenance) per coarse '
  'muscle group (MUSCLE_GROUPS) or prioritizable head (MUSCLE_PRIORITY_HEADS), '
  'both in types/schema.ts — keep the CHECK list in sync; a regression test '
  'parses this migration to enforce it.';
