-- ============================================================
-- FIX EXERCISE MUSCLE MAPPINGS (audit, 2026-07-02)
-- ============================================================
-- Audit of every stock exercise's primary_muscle / secondary_muscles against
-- the two-tier muscle taxonomy in types/schema.ts. Problems fixed:
--
--   1. Broken secondary tokens: 'rear delts' (space), 'hip flexors' (not in
--      any taxonomy) resolved to NOTHING in the volume/recovery credit paths,
--      so e.g. every row/face pull silently gave zero rear-delt credit.
--   2. Coarse secondary tokens ('shoulders' on presses, 'back' on hinges)
--      smeared 0.5-set credit across all delt heads / lats+upper_back when a
--      single specific muscle does the work (front_delts, erectors).
--   3. Missing obvious synergists: presses had no front_delts split, rows had
--      no forearms/rear_delts, squats had no adductors/erectors, hinges had
--      no erectors/traps/forearms, flys/pec deck had nothing at all.
--   4. Anatomically wrong or hopelessly coarse primaries where an
--      uncontroversial precise tag exists:
--        - shrugs were 'shoulders' (credited FRONT DELTS under the legacy
--          first-match rule) -> 'traps'
--        - Hip Adduction Machine was 'glutes' -> 'adductors'
--        - Hip Abduction Machine was 'glutes' -> 'glute_med'
--        - lateral raises / rear-delt work / presses were all 'shoulders'
--          -> 'lateral_delts' / 'rear_delts' / 'front_delts'
--        - vertical pulls were 'back' (ambiguous) -> 'lats'
--        - incline/decline pressing and dips were 'chest' -> chest_upper /
--          chest_lower
--        - Deadlift / Back Extension were 'back' (credited lats) -> 'glutes'
--        - anti-rotation / rotation core work was 'abs' -> 'obliques'
--
-- Deliberately KEPT coarse: flat pressing + flys ('chest'), rows ('back') —
-- these genuinely train both sub-groups; the volume tracker now splits legacy
-- primaries across their standard muscles (services/volumeTracker.ts,
-- resolvePrimaryMuscleCredits).
--
-- Values use StandardMuscleGroup tokens (types/schema.ts). All app-side
-- matching (pickers, program builder, swappers) is overlap-aware via
-- muscleMatchesGroup(), so legacy 'shoulders'/'back' filters still match the
-- precise tags. Idempotent: plain UPDATEs keyed by unique exercise name.
-- ============================================================

-- ============================================
-- CHEST
-- ============================================
-- Flat pressing stays 'chest' (both heads work hard); fix secondaries.
UPDATE exercises SET secondary_muscles = ARRAY['front_delts','triceps']
  WHERE name IN ('Barbell Bench Press', 'Dumbbell Bench Press', 'Machine Chest Press', 'Smith Machine Bench Press');

-- Flys work the pecs with meaningful anterior-delt assistance.
UPDATE exercises SET secondary_muscles = ARRAY['front_delts']
  WHERE name IN ('Cable Fly', 'Dumbbell Fly', 'Seated Cable Fly', 'Pec Deck');

-- Incline pressing is clavicular-head dominant, sternal head still assists.
UPDATE exercises SET primary_muscle = 'chest_upper', secondary_muscles = ARRAY['chest_lower','front_delts','triceps']
  WHERE name IN ('Incline Dumbbell Press', 'Smith Machine Incline Press');

-- Decline pressing / dips are sternal-head dominant, clavicular assists.
UPDATE exercises SET primary_muscle = 'chest_lower', secondary_muscles = ARRAY['chest_upper','front_delts','triceps']
  WHERE name IN ('Decline Barbell Press', 'Dips (Chest Focus)');

-- ============================================
-- BACK
-- ============================================
-- Rows stay 'back' (lats + upper back both loaded); add the missing
-- biceps/rear-delt/grip synergists ('rear delts' with a space resolved to
-- nothing before).
UPDATE exercises SET secondary_muscles = ARRAY['biceps','rear_delts','forearms']
  WHERE name IN ('Barbell Row', 'Dumbbell Row', 'Cable Row', 'Chest Supported Row', 'Seated Machine Row', 'Meadows Row');

-- Vertical pulls are lat-dominant.
UPDATE exercises SET primary_muscle = 'lats', secondary_muscles = ARRAY['biceps','upper_back','rear_delts']
  WHERE name IN ('Lat Pulldown', 'Close Grip Lat Pulldown', 'Assisted Pull-Up', 'Assisted Pull-Up Machine');

UPDATE exercises SET primary_muscle = 'lats', secondary_muscles = ARRAY['biceps','upper_back','rear_delts','forearms']
  WHERE name = 'Pull-Ups';

UPDATE exercises SET primary_muscle = 'lats', secondary_muscles = ARRAY[]::TEXT[]
  WHERE name = 'Straight Arm Pulldown';

-- Deadlift is a hip hinge: glute-dominant with hamstring/erector/trap/grip
-- work; 'back' primary was crediting lats with every deadlift set. Matches
-- Sumo Deadlift, which was already 'glutes'.
UPDATE exercises SET primary_muscle = 'glutes', secondary_muscles = ARRAY['hamstrings','erectors','traps','forearms','quads']
  WHERE name = 'Deadlift';

-- Back Extension trains the posterior chain, not lats/upper back.
UPDATE exercises SET primary_muscle = 'glutes', secondary_muscles = ARRAY['hamstrings','erectors']
  WHERE name = 'Back Extension';

-- ============================================
-- SHOULDERS
-- ============================================
-- Overhead pressing is front-delt dominant (triceps + upper chest assist).
UPDATE exercises SET primary_muscle = 'front_delts', secondary_muscles = ARRAY['triceps','chest_upper']
  WHERE name IN ('Overhead Press', 'Dumbbell Shoulder Press', 'Smith Machine Shoulder Press');

-- Lateral raises: side delts, full stop.
UPDATE exercises SET primary_muscle = 'lateral_delts', secondary_muscles = ARRAY[]::TEXT[]
  WHERE name IN ('Lateral Raise', 'Machine Lateral Raise', 'Cable Cross Body Lateral Raise', 'Behind-the-Back Cable Lateral Raise');

UPDATE exercises SET primary_muscle = 'lateral_delts', secondary_muscles = ARRAY['traps']
  WHERE name = 'Cable Y-Raise';

-- Rear-delt work (Face Pull's old secondaries were 'rear delts','back' —
-- the first resolved to nothing, the second smeared across lats).
UPDATE exercises SET primary_muscle = 'rear_delts', secondary_muscles = ARRAY['upper_back','traps']
  WHERE name = 'Face Pull';

UPDATE exercises SET primary_muscle = 'rear_delts', secondary_muscles = ARRAY['upper_back']
  WHERE name IN ('Rear Delt Fly', 'Rear Delt Machine', 'Reverse Cable Crossover');

UPDATE exercises SET primary_muscle = 'front_delts', secondary_muscles = ARRAY[]::TEXT[]
  WHERE name = 'Front Raise';

-- Upright rows: side delts + traps + elbow flexors.
UPDATE exercises SET primary_muscle = 'lateral_delts', secondary_muscles = ARRAY['traps','biceps']
  WHERE name IN ('Upright Row', 'Cable Upright Row');

-- Shrugs are trap work; as 'shoulders' they credited front delts.
UPDATE exercises SET primary_muscle = 'traps', secondary_muscles = ARRAY[]::TEXT[]
  WHERE name IN ('Dumbbell Shrug', 'Barbell Shrug');

-- ============================================
-- TRICEPS (compound pressing variants)
-- ============================================
-- Close-grip pressing / upright dips still train the chest ('chest' as a
-- coarse secondary splits 0.25/0.25 across the heads) and front delts.
UPDATE exercises SET secondary_muscles = ARRAY['chest','front_delts']
  WHERE name = 'Close Grip Bench Press';

UPDATE exercises SET secondary_muscles = ARRAY['chest_lower','front_delts']
  WHERE name IN ('Dips (Tricep Focus)', 'Assisted Dip Machine');

-- ============================================
-- QUADS
-- ============================================
-- Squats: glutes + adductors + (free-weight) erectors. Hamstring credit from
-- squatting is a known myth (biarticular) — removed.
UPDATE exercises SET secondary_muscles = ARRAY['glutes','adductors','erectors']
  WHERE name = 'Barbell Back Squat';

UPDATE exercises SET secondary_muscles = ARRAY['glutes','adductors']
  WHERE name IN ('Leg Press', 'Incline Leg Press', 'Hack Squat', 'Smith Machine Squat', 'Pendulum Squat');

-- Single-leg work adds glute-med stabilization.
UPDATE exercises SET secondary_muscles = ARRAY['glutes','glute_med','adductors']
  WHERE name IN ('Bulgarian Split Squat', 'Walking Lunges', 'Reverse Lunge');

UPDATE exercises SET secondary_muscles = ARRAY['glutes','glute_med']
  WHERE name = 'Step Up';

-- ============================================
-- HAMSTRINGS / HIP HINGE
-- ============================================
-- RDL-pattern hinges: glutes + erectors + grip/traps ('back' secondary was
-- crediting lats).
UPDATE exercises SET secondary_muscles = ARRAY['glutes','erectors','forearms','traps']
  WHERE name IN ('Romanian Deadlift', 'Stiff Leg Deadlift');

UPDATE exercises SET secondary_muscles = ARRAY['glutes','erectors','glute_med']
  WHERE name = 'Single Leg RDL';

UPDATE exercises SET secondary_muscles = ARRAY['glutes','erectors']
  WHERE name = 'Good Morning';

-- ============================================
-- GLUTES / HIPS
-- ============================================
UPDATE exercises SET secondary_muscles = ARRAY['hamstrings','erectors']
  WHERE name = 'Cable Pull Through';

UPDATE exercises SET secondary_muscles = ARRAY['hamstrings','glute_med']
  WHERE name = 'Single Leg Hip Thrust';

UPDATE exercises SET secondary_muscles = ARRAY['hamstrings','quads','adductors','erectors','traps','forearms']
  WHERE name = 'Sumo Deadlift';

-- Machine abduction targets glute med, not glute max.
UPDATE exercises SET primary_muscle = 'glute_med', secondary_muscles = ARRAY['glutes']
  WHERE name = 'Hip Abduction Machine';

-- Machine adduction targets the adductors — 'glutes' was simply wrong.
UPDATE exercises SET primary_muscle = 'adductors', secondary_muscles = ARRAY[]::TEXT[]
  WHERE name = 'Hip Adduction Machine';

-- ============================================
-- CORE
-- ============================================
-- 'hip flexors' isn't in any taxonomy and resolved to nothing.
UPDATE exercises SET secondary_muscles = ARRAY['obliques']
  WHERE name IN ('Hanging Leg Raise', 'Captain''s Chair Leg Raise');

-- Plank's 'shoulders' secondary was trivial; obliques do the stabilizing.
UPDATE exercises SET secondary_muscles = ARRAY['obliques']
  WHERE name = 'Plank';

-- Anti-rotation / rotation work is oblique-primary.
UPDATE exercises SET primary_muscle = 'obliques', secondary_muscles = ARRAY['abs']
  WHERE name IN ('Pallof Press', 'Russian Twist', 'Cable Woodchop');

-- Loaded carries: traps + grip + trunk, not 'shoulders'/'back'.
UPDATE exercises SET secondary_muscles = ARRAY['traps','forearms','obliques','erectors']
  WHERE name = 'Farmer''s Carry';

UPDATE exercises SET secondary_muscles = ARRAY['obliques','traps','forearms','erectors']
  WHERE name = 'Suitcase Carry';
