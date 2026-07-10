-- ============================================
-- ADDUCTOR / GLUTE MED / UPPER BACK + GRIP-FOREARM EXERCISES
-- ============================================
-- Follow-up to 20260705000001 (forearm/erector/oblique). Three standard
-- muscle groups still had NO exercise tagged as their PRIMARY mover:
--   * adductors   — only 0.5-credit secondary volume from squats/lunges
--   * glute_med   — only secondary from split squats / lunges
--   * upper_back  — rows tag 'back'/'lats', nothing tags 'upper_back'
-- and the direct grip work for forearms was still thin (only wrist curls).
--
-- This migration adds primary movers for each so the Exercise Library muscle
-- chips (and weekly volume targets) are reachable for every group, and
-- reclassifies three library rows whose primary muscle was mislabeled:
--   * 'Hip Adduction Machine'  glutes -> adductors  (adduction = adductors)
--   * 'Hip Abduction Machine'  glutes -> glute_med  (abduction  = glute med)
--   * "Farmer's Carry"         abs    -> forearms   (carries are grip-limited)
--
-- All inserts use ON CONFLICT (name) DO NOTHING and all reclassifies are
-- scoped to non-custom rows, so this is idempotent (safe to run twice) and
-- never touches user-created custom exercises. Column set matches
-- 20260705000001 exactly — no new schema fields introduced.
-- ============================================

INSERT INTO exercises (
  name, primary_muscle, secondary_muscles, mechanic,
  default_rep_range, default_rir, min_weight_increment_kg,
  form_cues, common_mistakes, setup_note,
  movement_pattern, equipment_required,
  difficulty, fatigue_rating, pattern, equipment,
  exercise_type, is_bodyweight,
  spinal_loading, requires_spinal_flexion, requires_spinal_extension, requires_spinal_rotation,
  position_stress, contraindications
) VALUES

-- ============================================
-- FOREARMS (direct grip work)
-- ============================================
('Behind-the-Back Wrist Curl', 'forearms', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 2.5,
  ARRAY['Hold the barbell behind your glutes, palms facing back', 'Curl the wrists up', 'Let the bar roll toward the fingertips for a stretch', 'Control the lowering'],
  ARRAY['Using too much weight', 'Bending the elbows', 'Bouncing at the bottom'],
  'Stand upright, hold a barbell behind your thighs with an overhand (palms-back) grip',
  'wrist_flexion', ARRAY['barbell'],
  'beginner', 1, 'isolation', 'barbell',
  'rep_based', false,
  'none', false, false, false,
  '{"wrists": true}'::jsonb, ARRAY['wrist_strain']),

('Barbell Reverse Wrist Curl', 'forearms', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 2.5,
  ARRAY['Forearms supported, palms down', 'Lift the knuckles toward the ceiling', 'Use light weight (extensors are weak)', 'Pause at the top'],
  ARRAY['Loading too heavy', 'Lifting the elbows off support', 'Jerky reps'],
  'Sit on a bench, forearms on thighs, palms down, wrists just past the knees, holding a barbell',
  'wrist_extension', ARRAY['barbell', 'bench'],
  'beginner', 1, 'isolation', 'barbell',
  'rep_based', false,
  'none', false, false, false,
  '{"wrists": true, "elbows": true}'::jsonb, ARRAY['wrist_strain', 'elbow_tendinitis']),

('Wrist Roller', 'forearms', ARRAY[]::TEXT[], 'isolation', ARRAY[3, 5], 2, 1.0,
  ARRAY['Hold the roller at arms length', 'Wind the weight up hand over hand', 'Lower it under control, do not drop', 'Keep the elbows still'],
  ARRAY['Using momentum from the shoulders', 'Dropping the weight', 'Bending the arms'],
  'Stand holding a wrist roller with a weight hung on the cord, arms extended in front',
  'wrist_flexion', ARRAY['weight plates'],
  'beginner', 1, 'isolation', 'barbell',
  'rep_based', false,
  'none', false, false, false,
  '{"wrists": true, "shoulders": true}'::jsonb, ARRAY['wrist_strain']),

('Plate Pinch Hold', 'forearms', ARRAY[]::TEXT[], 'isolation', ARRAY[20, 45], 2, 1.0,
  ARRAY['Pinch smooth plates together with fingers and thumb', 'Stand tall, arms at your sides', 'Squeeze hard for the whole hold', 'Set down before the grip fully fails'],
  ARRAY['Letting the plates rest on the fingers instead of pinching', 'Using the rough knurled sides', 'Holding your breath'],
  'Pinch one or two smooth-sided weight plates in each hand and hold; time the set',
  'carry', ARRAY['weight plates'],
  'beginner', 1, 'isolation', 'weight plates',
  'duration_based', false,
  'none', false, false, false,
  '{"wrists": true}'::jsonb, ARRAY[]::TEXT[]),

('Dead Hang', 'forearms', ARRAY['lats'], 'isolation', ARRAY[20, 60], 2, 0,
  ARRAY['Grip the bar slightly wider than shoulders', 'Hang with straight arms', 'Keep the shoulders active, not fully shrugged up', 'Breathe steadily'],
  ARRAY['Fully relaxing the shoulders', 'Swinging', 'Using a thumbless grip'],
  'Hang from a pull-up bar with an overhand grip; time the set',
  'hang', ARRAY['pull-up bar'],
  'beginner', 1, 'isolation', 'bodyweight',
  'duration_based', true,
  'none', false, false, false,
  '{"shoulders": true, "wrists": true}'::jsonb, ARRAY[]::TEXT[]),

-- ============================================
-- ADDUCTORS
-- ============================================
('Copenhagen Plank', 'adductors', ARRAY['obliques', 'abs'], 'isolation', ARRAY[20, 45], 2, 0,
  ARRAY['Rest the top foot or knee on a bench', 'Lift the hips into a straight side-plank line', 'Drive the top leg down into the bench', 'Do not let the hips sag'],
  ARRAY['Hips dropping', 'Rotating the torso', 'Holding breath'],
  'Side plank with the top leg supported on a bench; hold per side',
  'core', ARRAY['bench'],
  'advanced', 2, 'isolation', 'bodyweight',
  'duration_based', true,
  'low', false, false, false,
  '{"groin": true, "shoulders": true}'::jsonb, ARRAY['groin_strain']),

('Cossack Squat', 'adductors', ARRAY['quads', 'glutes'], 'compound', ARRAY[8, 12], 2, 2.0,
  ARRAY['Shift your weight over one bent leg', 'Keep the other leg straight with toes up', 'Sit deep, chest tall', 'Push through the heel to switch sides'],
  ARRAY['Knee caving inward', 'Rounding the back', 'Heel lifting off the floor'],
  'Take a wide stance and shift side to side over one leg; hold a dumbbell at the chest for load',
  'lunge', ARRAY['dumbbells'],
  'intermediate', 2, 'lunge', 'dumbbell',
  'rep_based', false,
  'low', false, false, false,
  '{"knees": true, "groin": true}'::jsonb, ARRAY['groin_strain']),

('Cable Hip Adduction', 'adductors', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 2.5,
  ARRAY['Ankle cuff on the inside leg', 'Pull the leg across the midline', 'Squeeze at full adduction', 'Control the return'],
  ARRAY['Using momentum', 'Rotating the hips', 'Too much range at the top'],
  'Stand side-on to a low pulley with an ankle strap on the near (inside) leg',
  'hip_adduction', ARRAY['cable machine'],
  'beginner', 1, 'isolation', 'cable',
  'rep_based', false,
  'none', false, false, false,
  '{"groin": true}'::jsonb, ARRAY['groin_strain']),

('Adductor Side Lunge', 'adductors', ARRAY['glutes', 'quads'], 'compound', ARRAY[10, 15], 2, 2.0,
  ARRAY['Step wide to one side', 'Sit back into the bent hip', 'Keep the trailing leg straight', 'Push back to the start'],
  ARRAY['Letting the knee cave', 'Rounding the lower back', 'Short, shallow steps'],
  'Stand tall and step laterally into a deep side lunge; hold dumbbells for load',
  'lunge', ARRAY['dumbbells'],
  'beginner', 2, 'lunge', 'dumbbell',
  'rep_based', false,
  'low', false, false, false,
  '{"knees": true, "groin": true}'::jsonb, ARRAY['groin_strain']),

-- ============================================
-- GLUTE MED
-- ============================================
('Banded Lateral Walk', 'glute_med', ARRAY['glutes'], 'isolation', ARRAY[12, 20], 2, 0,
  ARRAY['Band around the knees or ankles', 'Hold a quarter-squat athletic stance', 'Step sideways keeping band tension', 'Do not let the knees cave in'],
  ARRAY['Feet coming together and losing tension', 'Standing up too tall', 'Leading with the torso'],
  'Loop a mini-band around the legs, stay in a half-squat, and step side to side',
  'hip_abduction', ARRAY['resistance band'],
  'beginner', 1, 'isolation', 'band',
  'rep_based', false,
  'none', false, false, false,
  '{"hips": true}'::jsonb, ARRAY[]::TEXT[]),

('Clamshell', 'glute_med', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 0,
  ARRAY['Lie on your side with knees bent about 90 degrees', 'Stack the hips', 'Open the top knee like a clam', 'Keep the feet together with no hip roll'],
  ARRAY['Rolling the top hip back', 'Using momentum', 'Opening past a comfortable range'],
  'Lie on your side, knees bent and stacked; add a mini-band above the knees to load',
  'hip_abduction', ARRAY['resistance band'],
  'beginner', 1, 'isolation', 'band',
  'rep_based', false,
  'none', false, false, false,
  '{"hips": true}'::jsonb, ARRAY[]::TEXT[]),

('Cable Hip Abduction', 'glute_med', ARRAY['glutes'], 'isolation', ARRAY[12, 20], 2, 2.5,
  ARRAY['Ankle cuff on the outside leg', 'Raise the leg out to the side', 'Keep the torso upright', 'Control the return'],
  ARRAY['Leaning into the cable', 'Using momentum', 'Rotating the foot outward'],
  'Stand side-on to a low pulley with an ankle strap on the far (outside) leg',
  'hip_abduction', ARRAY['cable machine'],
  'beginner', 1, 'isolation', 'cable',
  'rep_based', false,
  'none', false, false, false,
  '{"hips": true}'::jsonb, ARRAY[]::TEXT[]),

('Side-Lying Hip Abduction', 'glute_med', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 1.0,
  ARRAY['Lie on your side with legs straight', 'Raise the top leg toward the ceiling', 'Lead with the heel, toes slightly down', 'Lower under control'],
  ARRAY['Rolling the hip back', 'Swinging the leg', 'Letting the leg drift forward (hip flexor takes over)'],
  'Lie on your side, bottom leg bent for support; add an ankle weight to load',
  'hip_abduction', ARRAY[]::TEXT[],
  'beginner', 1, 'isolation', 'bodyweight',
  'rep_based', true,
  'none', false, false, false,
  '{"hips": true}'::jsonb, ARRAY[]::TEXT[]),

-- ============================================
-- UPPER BACK
-- ============================================
('Seal Row', 'upper_back', ARRAY['lats', 'biceps', 'rear_delts'], 'compound', ARRAY[8, 12], 2, 2.5,
  ARRAY['Lie chest-down on a raised bench', 'Let the bar hang at full stretch', 'Row to the lower chest with elbows about 45 degrees', 'Squeeze the shoulder blades'],
  ARRAY['Using the legs or hips', 'Shrugging the traps up', 'Cutting the range short'],
  'Lie face down on a bench raised so the bar clears the floor; use a barbell or dumbbells',
  'horizontal_pull', ARRAY['barbell', 'bench'],
  'intermediate', 2, 'horizontal_pull', 'barbell',
  'rep_based', false,
  'low', false, false, false,
  '{"shoulders": true}'::jsonb, ARRAY[]::TEXT[]),

('Wide-Grip Seated Cable Row', 'upper_back', ARRAY['lats', 'biceps', 'rear_delts'], 'compound', ARRAY[10, 15], 2, 5.0,
  ARRAY['Use a wide bar with an overhand grip', 'Pull to the upper abdomen', 'Drive the elbows out and back', 'Squeeze the shoulder blades together'],
  ARRAY['Leaning back excessively', 'Shrugging', 'Using momentum'],
  'Seated cable row with a wide overhand grip on a long bar',
  'horizontal_pull', ARRAY['cable machine', 'row handle'],
  'beginner', 1, 'horizontal_pull', 'cable',
  'rep_based', false,
  'none', false, false, false,
  '{}'::jsonb, ARRAY[]::TEXT[]),

('Prone Y-Raise', 'upper_back', ARRAY['rear_delts', 'traps'], 'isolation', ARRAY[12, 20], 2, 1.0,
  ARRAY['Lie chest-down on an incline bench', 'Raise the arms into a Y overhead', 'Lead with the thumbs up', 'Squeeze the lower traps at the top'],
  ARRAY['Shrugging the upper traps', 'Using momentum', 'Going too heavy'],
  'Lie face down on a 30-degree incline bench with light dumbbells',
  'shoulder_isolation', ARRAY['dumbbells', 'incline bench'],
  'beginner', 1, 'isolation', 'dumbbell',
  'rep_based', false,
  'none', false, false, false,
  '{"shoulders": true}'::jsonb, ARRAY[]::TEXT[]),

('Band Pull-Apart', 'upper_back', ARRAY['rear_delts'], 'isolation', ARRAY[15, 25], 2, 0,
  ARRAY['Hold a band at shoulder height with arms straight', 'Pull the band apart to the chest', 'Squeeze the shoulder blades', 'Return under control'],
  ARRAY['Bending the elbows', 'Shrugging', 'Using a band that is too heavy'],
  'Stand tall holding a resistance band in front at shoulder height',
  'horizontal_pull', ARRAY['resistance band'],
  'beginner', 1, 'isolation', 'band',
  'rep_based', false,
  'none', false, false, false,
  '{"shoulders": true}'::jsonb, ARRAY[]::TEXT[])

ON CONFLICT (name) DO NOTHING;

-- ============================================
-- RECLASSIFY MISLABELED LIBRARY ROWS (non-custom only)
-- ============================================
-- Reclassification changes only primary_muscle / secondary_muscles: the row's
-- id and name are untouched, so any logged sets keep resolving. Nothing is
-- renamed or deleted. Scoped to is_custom IS NOT TRUE so user-created custom
-- exercises are never modified. Idempotent (re-running sets the same value).

-- Adduction trains the adductors, not the glutes.
UPDATE exercises
SET primary_muscle = 'adductors'
WHERE name = 'Hip Adduction Machine'
  AND is_custom IS NOT TRUE;

-- Abduction trains the glute medius, not the glute max.
UPDATE exercises
SET primary_muscle = 'glute_med'
WHERE name = 'Hip Abduction Machine'
  AND is_custom IS NOT TRUE;

-- Loaded carries are limited by grip; forearms are the primary mover, with
-- the traps, abs, and glutes stabilizing.
UPDATE exercises
SET primary_muscle = 'forearms',
    secondary_muscles = ARRAY['traps', 'abs', 'glutes']
WHERE name = 'Farmer''s Carry'
  AND is_custom IS NOT TRUE;
