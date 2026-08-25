-- Seed exercises.stabilizers for the stock library (reconciliation).
--
-- WHY: the stabilizers column has existed since 20241221000001 but no seed
-- ever populated it — every stock row carried '{}' while a drifted hand-
-- written fallback list in services/exerciseService.ts held unrelated coarse
-- tags that nothing consumed. This migration makes the column the seeded
-- source of truth for the stabilizer-recovery channel in
-- services/muscleRecovery (stabilizer windows + pre-set warnings).
--
-- SOURCE OF TRUTH: services/shared/stabilizerTags.ts
-- (STABILIZERS_BY_EXERCISE_NAME). A drift-guard test parses THIS FILE and
-- compares it to that map (services/__tests__/stabilizerSeed.test.ts) — edit
-- the map and this migration together or that test fails.
--
-- VOCABULARY: values are StandardMuscleGroup tokens, restricted to the
-- stabilizer-TRACKED muscles: erectors, rotator_cuff, rear_delts, forearms.
-- 'rotator_cuff' joins the standard taxonomy in the same release.
--
-- SCOPE, deliberately:
--   * stock rows only (is_custom IS NOT TRUE) — user customs are never touched;
--   * only the names listed here are written; every other row keeps whatever
--     it carries (AI-completed customs included). Stock exercises whose
--     classification was not obvious are deliberately NOT seeded — they are
--     enumerated in stabilizerTags.UNSEEDED_STABILIZER_EXERCISES for review;
--   * re-runnable: plain idempotent UPDATEs, no data deleted.

-- ── Hinges ─────────────────────────────────────────────────────────────────
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Deadlift' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Sumo Deadlift' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Romanian Deadlift' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Stiff Leg Deadlift' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Single Leg RDL' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors'] WHERE name = 'Good Morning' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Cable Pull Through' AND is_custom IS NOT TRUE;

-- ── Squats / standing lower-body ───────────────────────────────────────────
UPDATE exercises SET stabilizers = ARRAY['erectors'] WHERE name = 'Barbell Back Squat' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors'] WHERE name = 'Smith Machine Squat' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors'] WHERE name = 'Walking Lunges' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors'] WHERE name = 'Reverse Lunge' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors'] WHERE name = 'Step Up' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors'] WHERE name = 'Standing Calf Raise' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors'] WHERE name = 'Smith Machine Calf Raise' AND is_custom IS NOT TRUE;

-- ── Carries ────────────────────────────────────────────────────────────────
UPDATE exercises SET stabilizers = ARRAY['erectors'] WHERE name = 'Farmer''s Carry' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Suitcase Carry' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors','rotator_cuff'] WHERE name = 'Overhead Carry' AND is_custom IS NOT TRUE;

-- ── Rows and hand-supported pulling ────────────────────────────────────────
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Barbell Row' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Meadows Row' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Cable Row' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Wide-Grip Seated Cable Row' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms'] WHERE name = 'Dumbbell Row' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms'] WHERE name = 'Seated Machine Row' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms'] WHERE name = 'Chest Supported Row' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms'] WHERE name = 'Seal Row' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms'] WHERE name = 'Pull-Ups' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms'] WHERE name = 'Assisted Pull-Up' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms'] WHERE name = 'Assisted Pull-Up Machine' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms'] WHERE name = 'Lat Pulldown' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms'] WHERE name = 'Close Grip Lat Pulldown' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms'] WHERE name = 'Straight Arm Pulldown' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms'] WHERE name = 'Hanging Leg Raise' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Barbell Shrug' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['erectors','forearms'] WHERE name = 'Dumbbell Shrug' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms','rotator_cuff'] WHERE name = 'Upright Row' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['forearms','rotator_cuff'] WHERE name = 'Cable Upright Row' AND is_custom IS NOT TRUE;

-- ── Horizontal pressing ────────────────────────────────────────────────────
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Barbell Bench Press' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Dumbbell Bench Press' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Incline Dumbbell Press' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Decline Barbell Press' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Machine Chest Press' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Smith Machine Bench Press' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Smith Machine Incline Press' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Close Grip Bench Press' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Dips (Chest Focus)' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Dips (Tricep Focus)' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Assisted Dip Machine' AND is_custom IS NOT TRUE;

-- ── Overhead pressing ──────────────────────────────────────────────────────
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts','erectors'] WHERE name = 'Overhead Press' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Dumbbell Shoulder Press' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff','rear_delts'] WHERE name = 'Smith Machine Shoulder Press' AND is_custom IS NOT TRUE;

-- ── External-rotation-dominant pulls (cuff dose visibility) ────────────────
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff'] WHERE name = 'Face Pull' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff'] WHERE name = 'Rear Delt Fly' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff'] WHERE name = 'Rear Delt Machine' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff'] WHERE name = 'Reverse Cable Crossover' AND is_custom IS NOT TRUE;
UPDATE exercises SET stabilizers = ARRAY['rotator_cuff'] WHERE name = 'Prone Y-Raise' AND is_custom IS NOT TRUE;

COMMENT ON COLUMN exercises.stabilizers IS
  'Muscles loaded isometrically for stability (StandardMuscleGroup tokens). '
  'Stock values are seeded from services/shared/stabilizerTags.ts '
  '(drift-guarded by a test that parses the seeding migration). Consumed ONLY '
  'by the stabilizer-recovery channel in services/muscleRecovery — never by '
  'volume credit or the prescription engine.';
