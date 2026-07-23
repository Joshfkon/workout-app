-- ============================================
-- ISOMETRIC HOLD EXERCISES (duration-based)
-- ============================================
-- Part of the duration-based-set feature. Several common isometric holds were
-- named in 20260110000001_add_exercise_type.sql's UPDATE list but never
-- actually seeded, so those UPDATEs matched zero rows. This migration seeds a
-- curated subset, born with exercise_type = 'duration_based' — no retroactive
-- flagging needed. default_rep_range holds SECONDS for these rows (the
-- documented duration convention).
--
-- Deliberately skipped: sled push/drag, yoke, and other distance-modality
-- work — distance is a future modality, not a duration exercise.
--
-- All inserts use ON CONFLICT (name) DO NOTHING, so this is idempotent and
-- never touches user-created custom exercises. Column set matches
-- 20260710000001 exactly — no new schema fields introduced.
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

('Wall Sit', 'quads', ARRAY['glutes'], 'isolation', ARRAY[30, 60], 2, 0,
  ARRAY['Back flat against the wall', 'Slide down until thighs are parallel to the floor', 'Knees over ankles, not past the toes', 'Drive through the whole foot and breathe'],
  ARRAY['Sitting too high', 'Knees drifting past the toes', 'Hands pushing on the thighs'],
  'Lean against a wall and slide down to a seated position, thighs parallel; hold a plate on the thighs to add load; time the set',
  'squat', ARRAY[]::TEXT[],
  'beginner', 1, 'isolation', 'bodyweight',
  'duration_based', true,
  'none', false, false, false,
  '{"knees": true}'::jsonb, ARRAY[]::TEXT[]),

('Hollow Body Hold', 'abs', ARRAY[]::TEXT[], 'isolation', ARRAY[20, 45], 2, 0,
  ARRAY['Press the lower back into the floor', 'Lift shoulders and legs a few inches up', 'Arms extended overhead or at your sides to scale', 'Keep ribs pulled down'],
  ARRAY['Lower back arching off the floor', 'Chin tucked to chest', 'Holding breath'],
  'Lie on your back and lift shoulders and legs off the floor into a shallow dish shape; time the set',
  'core', ARRAY[]::TEXT[],
  'intermediate', 1, 'isolation', 'bodyweight',
  'duration_based', true,
  'low', true, false, false,
  '{"lower_back": true}'::jsonb, ARRAY['lower_back_pain']),

('L-Sit', 'abs', ARRAY['triceps'], 'compound', ARRAY[10, 30], 2, 0,
  ARRAY['Support on parallettes or dip bars, arms locked', 'Lift both legs straight out to horizontal', 'Push the shoulders down away from the ears', 'Point the toes'],
  ARRAY['Bending the knees without meaning to', 'Shrugging the shoulders', 'Leaning too far back'],
  'Support your weight on parallettes or dip bars and hold both legs out horizontal; bend knees to scale; time the set',
  'core', ARRAY['dip bars'],
  'advanced', 2, 'isolation', 'bodyweight',
  'duration_based', true,
  'low', true, false, false,
  '{"shoulders": true, "wrists": true}'::jsonb, ARRAY[]::TEXT[]),

('RKC Plank', 'abs', ARRAY['glutes', 'obliques'], 'isolation', ARRAY[10, 30], 2, 0,
  ARRAY['Elbows under the shoulders, fists together', 'Squeeze the glutes and quads as hard as possible', 'Pull the elbows toward the toes without moving', 'Full-body tension for the whole hold'],
  ARRAY['Treating it like a regular plank (too little tension)', 'Hips sagging', 'Holding breath'],
  'Short maximal-tension plank: brace everything at once and pull elbows and toes toward each other; time the set',
  'core', ARRAY[]::TEXT[],
  'intermediate', 2, 'isolation', 'bodyweight',
  'duration_based', true,
  'none', false, false, false,
  '{"shoulders": true, "lower_back": true}'::jsonb, ARRAY[]::TEXT[]),

('Glute Bridge Hold', 'glutes', ARRAY['hamstrings'], 'isolation', ARRAY[20, 45], 2, 0,
  ARRAY['Heels close to the glutes, drive the hips up', 'Squeeze the glutes at the top', 'Ribs down, do not arch the lower back', 'Hold the top position'],
  ARRAY['Arching the lower back instead of extending the hips', 'Pushing through the toes', 'Letting the hips drop'],
  'Lie on your back, knees bent, and hold the top of a glute bridge; rest a plate on the hips to add load; time the set',
  'hip_hinge', ARRAY[]::TEXT[],
  'beginner', 1, 'isolation', 'bodyweight',
  'duration_based', true,
  'none', false, false, false,
  '{"lower_back": true}'::jsonb, ARRAY[]::TEXT[]),

('Overhead Carry', 'shoulders', ARRAY['traps', 'abs', 'forearms'], 'compound', ARRAY[30, 60], 2, 2.5,
  ARRAY['Press the weight overhead and lock the arm', 'Biceps close to the ear, ribs down', 'Walk with short controlled steps', 'Keep the torso tall, no leaning'],
  ARRAY['Elbow bending during the carry', 'Arching the lower back', 'Rushing the steps'],
  'Walk holding a dumbbell or kettlebell locked out overhead; switch sides between sets; time the set',
  'carry', ARRAY['dumbbells'],
  'intermediate', 2, 'compound', 'dumbbell',
  'duration_based', false,
  'moderate', false, false, false,
  '{"shoulders": true, "lower_back": true}'::jsonb, ARRAY['shoulder_impingement'])

ON CONFLICT (name) DO NOTHING;
