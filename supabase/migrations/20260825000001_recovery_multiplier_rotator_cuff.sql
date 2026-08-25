-- Add 'rotator_cuff' to the user_muscle_recovery_multipliers.muscle_group
-- CHECK vocabulary.
--
-- WHY: rotator_cuff joins STANDARD_MUSCLE_GROUPS as a first-class standard
-- muscle (types/schema.ts) for the stabilizer-recovery channel in
-- services/muscleRecovery. Without this widening, every learned-recovery
-- upsert for it would fail the constraint and soreness learning would be
-- silently dead for the muscle — the exact failure mode the previous
-- vocabulary migration (20260802000002) fixed for the six late-added heads.
--
-- PRESERVED DELIBERATELY:
--   * existing rows — this only widens the accepted domain, nothing is
--     rewritten or deleted;
--   * the numeric range 0.7–1.5 — the APPLICATION narrowed its own bounds to
--     0.85–1.35 and migrates by clamping on read, but older clients may still
--     write the wider range and must not start erroring.
--
-- DRIFT GUARD: the key list below is asserted against STANDARD_MUSCLE_GROUPS
-- in services/__tests__/recoveryMultiplierVocabulary.test.ts, which parses
-- THIS FILE. Adding a standard muscle without a follow-up migration fails
-- that test.

ALTER TABLE user_muscle_recovery_multipliers
  DROP CONSTRAINT IF EXISTS user_muscle_recovery_multipliers_muscle_group_check;

ALTER TABLE user_muscle_recovery_multipliers
  ADD CONSTRAINT user_muscle_recovery_multipliers_muscle_group_check
  CHECK (muscle_group IN (
    'chest_upper', 'chest_lower',
    'front_delts', 'lateral_delts', 'rear_delts', 'rotator_cuff',
    'lats', 'upper_back',
    'traps', 'upper_traps', 'mid_lower_traps',
    'biceps',
    'triceps', 'triceps_long', 'triceps_lat_med',
    'forearms',
    'quads', 'hamstrings',
    'glutes', 'glute_med',
    'adductors',
    'calves', 'gastrocnemius', 'soleus',
    'abs', 'obliques',
    'erectors'
  ));

COMMENT ON TABLE user_muscle_recovery_multipliers IS
  'Per-muscle learned recovery-window multiplier from soreness feedback. '
  'muscle_group uses the StandardMuscleGroup vocabulary in types/schema.ts '
  '(STANDARD_MUSCLE_GROUPS) — keep the CHECK list in sync with that array; a '
  'regression test parses this migration to enforce it. The numeric range '
  'stays 0.7-1.5 for older clients; the application clamps reads to its own '
  'narrower bounds (RECOVERY_MULTIPLIER_BOUNDS).';
