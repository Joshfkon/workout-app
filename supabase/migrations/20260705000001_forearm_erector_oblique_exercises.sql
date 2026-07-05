-- ============================================
-- FOREARM / ERECTOR / OBLIQUE EXERCISES
-- The library had no exercises with forearms or erectors as the primary
-- muscle (only 0.5-credit secondary volume from rows/hinges/carries), and
-- only three oblique-primary movements. These direct exercises make the
-- weekly volume targets for those muscles reachable.
-- Note: 'Side Plank' and 'Superman Hold' are already listed as
-- duration-based names in 20260110000001_add_exercise_type.sql, so they
-- are inserted here with exercise_type = 'duration_based' directly.
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
-- FOREARMS
-- ============================================
('Barbell Wrist Curl', 'forearms', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 2.5,
  ARRAY['Rest forearms on thighs or bench', 'Curl wrists up fully', 'Let bar roll toward fingertips for a stretch', 'Control the negative'],
  ARRAY['Using too much weight', 'Bouncing reps', 'Lifting elbows off support'],
  'Sit on bench, forearms on thighs, wrists just past knees, palms up',
  'wrist_flexion', ARRAY['barbell', 'bench'],
  'beginner', 1, 'isolation', 'barbell',
  'rep_based', false,
  'none', false, false, false,
  '{"wrists": true}'::jsonb, ARRAY['wrist_strain']),

('Dumbbell Wrist Curl', 'forearms', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 1.0,
  ARRAY['Support forearm on thigh or bench', 'Full range at the wrist', 'Let dumbbell roll toward fingertips', 'Slow eccentric'],
  ARRAY['Going too heavy', 'Partial range of motion', 'Moving the elbow'],
  'Sit on bench, forearm on thigh, wrist just past knee, palm up',
  'wrist_flexion', ARRAY['dumbbells', 'bench'],
  'beginner', 1, 'isolation', 'dumbbell',
  'rep_based', false,
  'none', false, false, false,
  '{"wrists": true}'::jsonb, ARRAY['wrist_strain']),

('Reverse Wrist Curl', 'forearms', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 1.0,
  ARRAY['Palms down, lift knuckles toward ceiling', 'Keep forearms supported', 'Use lighter weight than wrist curls', 'Pause at the top'],
  ARRAY['Loading too heavy (extensors are weak)', 'Jerky reps', 'Elbows lifting off support'],
  'Sit on bench, forearms on thighs, palms down, wrists just past knees',
  'wrist_extension', ARRAY['dumbbells', 'bench'],
  'beginner', 1, 'isolation', 'dumbbell',
  'rep_based', false,
  'none', false, false, false,
  '{"wrists": true, "elbows": true}'::jsonb, ARRAY['wrist_strain', 'elbow_tendinitis']),

('EZ Bar Reverse Curl', 'forearms', ARRAY['biceps'], 'isolation', ARRAY[10, 15], 2, 2.5,
  ARRAY['Overhand grip', 'Pin elbows to sides', 'Curl without wrist flick', 'Control the negative'],
  ARRAY['Swinging body', 'Wrists breaking backward', 'Elbows drifting forward'],
  'Grip EZ bar overhand at the outer camber, stand upright',
  'elbow_flexion', ARRAY['ez bar'],
  'beginner', 1, 'isolation', 'barbell',
  'rep_based', false,
  'none', false, false, false,
  '{"wrists": true, "elbows": true}'::jsonb, ARRAY['elbow_tendinitis']),

-- ============================================
-- ERECTORS (LOWER BACK)
-- ============================================
('Machine Back Extension', 'erectors', ARRAY['glutes'], 'isolation', ARRAY[12, 15], 2, 5.0,
  ARRAY['Round through the machine''s range under control', 'Drive back pad with mid-back', 'Squeeze erectors at full extension', 'Slow eccentric'],
  ARRAY['Using momentum', 'Hyperextending violently at the top', 'Setting pad too high'],
  'Adjust seat so pad sits across shoulder blades, hips anchored',
  'spinal_extension', ARRAY['back extension machine'],
  'beginner', 1, 'isolation', 'machine',
  'rep_based', false,
  'moderate', false, true, false,
  '{"lowerBack": true}'::jsonb, ARRAY['herniated_disc', 'lower_back_strain']),

('Superman Hold', 'erectors', ARRAY['glutes'], 'isolation', ARRAY[30, 60], 2, 0,
  ARRAY['Lift arms and legs simultaneously', 'Squeeze glutes and lower back', 'Keep neck neutral', 'Breathe while holding'],
  ARRAY['Craning the neck up', 'Holding breath', 'Only lifting the chest'],
  'Lie face down on floor, arms extended overhead',
  'spinal_extension', ARRAY[]::TEXT[],
  'beginner', 1, 'isolation', 'bodyweight',
  'duration_based', true,
  'low', false, true, false,
  '{"lowerBack": true}'::jsonb, ARRAY['lower_back_strain']),

('Jefferson Curl', 'erectors', ARRAY['hamstrings'], 'compound', ARRAY[8, 12], 2, 2.0,
  ARRAY['Roll down one vertebra at a time', 'Keep legs straight', 'Use light weight only', 'Stand tall and reverse slowly'],
  ARRAY['Going too heavy', 'Rushing the descent', 'Bending the knees to reach depth'],
  'Stand on a box or bench holding a light dumbbell, feet together',
  'hip_hinge', ARRAY['dumbbells', 'bench'],
  'advanced', 2, 'isolation', 'dumbbell',
  'rep_based', false,
  'high', true, false, false,
  '{"lowerBack": true}'::jsonb, ARRAY['herniated_disc', 'lower_back_strain', 'sciatica']),

-- ============================================
-- OBLIQUES
-- ============================================
('Side Plank', 'obliques', ARRAY['abs'], 'isolation', ARRAY[30, 60], 2, 0,
  ARRAY['Stack shoulders, hips, and feet', 'Push the floor away with forearm', 'Keep hips high', 'Straight line head to heels'],
  ARRAY['Hips sagging', 'Rolling the chest forward', 'Holding breath'],
  'Lie on side, elbow under shoulder, lift hips; hold per side',
  'core', ARRAY[]::TEXT[],
  'beginner', 1, 'isolation', 'bodyweight',
  'duration_based', true,
  'none', false, false, false,
  '{"shoulders": true}'::jsonb, ARRAY[]::TEXT[]),

('Dumbbell Side Bend', 'obliques', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 15], 2, 2.0,
  ARRAY['Hold dumbbell on one side only', 'Bend directly sideways', 'Feel stretch on the loaded side', 'Pull back up with the opposite oblique'],
  ARRAY['Holding dumbbells in both hands (cancels the load)', 'Leaning forward or backward', 'Using momentum'],
  'Stand tall, dumbbell in one hand, other hand behind head',
  'core', ARRAY['dumbbells'],
  'beginner', 1, 'isolation', 'dumbbell',
  'rep_based', false,
  'low', false, false, false,
  '{"lowerBack": true}'::jsonb, ARRAY['herniated_disc'])

ON CONFLICT (name) DO NOTHING;
