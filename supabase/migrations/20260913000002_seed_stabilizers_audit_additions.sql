-- Stock stabilizer additions from the 2026-09-13 coverage audit
-- (docs/STABILIZER_COVERAGE_AUDIT.md, approved).
--
-- Same mechanism, scope and statement shape as
-- 20260825000002_seed_stabilizers.sql: stock rows only, idempotent UPDATEs,
-- values restricted to the tracked vocabulary. SOURCE OF TRUTH is
-- services/shared/stabilizerTags.ts (STABILIZERS_BY_EXERCISE_NAME); the
-- drift-guard test (services/__tests__/stabilizerSeed.test.ts) parses the
-- UNION of both stock seed migrations and compares it to that map — edit the
-- map and the migrations together or that test fails.
--
-- WHY these six:
--   * Band Pull-Apart — the external-rotation-dominant pull class already
--     tagged for cuff dose visibility (Face Pull et al.); its omission was an
--     oversight, not a decision.
--   * Dumbbell Fly — the one fly variant where the cuff carries full load in
--     the deepest stretch (cable flys / Pec Deck stay untagged).
--   * The three overhead tricep extensions — shoulder held at end-range
--     flexion under load for the whole set.
--   * Bulgarian Split Squat — heavy rear-elevated work is un-supported
--     standing load, matching the already-tagged lunge family. Forearms
--     deliberately NOT tagged (equipment-dependent).

UPDATE exercises SET stabilizers = ARRAY['rotator_cuff'] WHERE name = 'Band Pull-Apart' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff'] WHERE name = 'Dumbbell Fly' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff'] WHERE name = 'Overhead Tricep Extension' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff'] WHERE name = 'Cable Overhead Tricep Extension' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff'] WHERE name = 'Katana Tricep Extension' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors'] WHERE name = 'Bulgarian Split Squat' AND is_custom IS NOT TRUE;
