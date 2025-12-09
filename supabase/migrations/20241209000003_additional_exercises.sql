-- ============================================
-- ADDITIONAL EXERCISES
-- Common exercises requested by users
-- ============================================

INSERT INTO exercises (name, primary_muscle, secondary_muscles, mechanic, default_rep_range, default_rir, min_weight_increment_kg, form_cues, common_mistakes, setup_note, movement_pattern, equipment_required) VALUES

-- TRICEP EXERCISES
('Cable Overhead Tricep Extension', 'triceps', ARRAY[]::TEXT[], 'isolation', ARRAY[10, 15], 2, 2.5,
  ARRAY['Keep elbows close to head', 'Full stretch at bottom', 'Squeeze triceps at top', 'Face away from cable'],
  ARRAY['Flaring elbows out', 'Using shoulder to lift', 'Not getting full stretch'],
  'Face away from low pulley, rope overhead, step forward for tension',
  'elbow_extension', ARRAY['cable machine', 'rope attachment']),

('Cable Tricep Pushdown', 'triceps', ARRAY[]::TEXT[], 'isolation', ARRAY[10, 15], 2, 2.5,
  ARRAY['Pin elbows to sides', 'Full lockout at bottom', 'Control the negative', 'Slight forward lean'],
  ARRAY['Elbows drifting forward', 'Using momentum', 'Partial reps'],
  'Use straight bar, V-bar, or rope attachment',
  'elbow_extension', ARRAY['cable machine']),

-- SHOULDER EXERCISES  
('Cable Cross Body Lateral Raise', 'shoulders', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 15], 2, 2.5,
  ARRAY['Pull across body to opposite side', 'Lead with elbow', 'Control the negative', 'Slight forward lean'],
  ARRAY['Using too much weight', 'Jerking the movement', 'Not crossing midline'],
  'Stand sideways to cable, low pulley, pull handle across body',
  'shoulder_isolation', ARRAY['cable machine']),

('Barbell Shrug', 'shoulders', ARRAY['back'], 'isolation', ARRAY[10, 15], 2, 2.5,
  ARRAY['Shrug straight up toward ears', 'Hold at top briefly', 'Control descent', 'Keep arms straight'],
  ARRAY['Rolling shoulders', 'Bending elbows', 'Using momentum'],
  'Grip slightly wider than shoulders, stand upright',
  'shoulder_isolation', ARRAY['barbell']),

-- BICEP EXERCISES
('Cable Bicep Curl', 'biceps', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 15], 2, 2.5,
  ARRAY['Pin elbows to sides', 'Full contraction at top', 'Control negative', 'Constant tension'],
  ARRAY['Swinging body', 'Elbows moving forward', 'Using momentum'],
  'Use straight bar or EZ bar attachment, low pulley',
  'elbow_flexion', ARRAY['cable machine']),

-- BACK EXERCISES
('Assisted Pull-Up', 'back', ARRAY['biceps'], 'compound', ARRAY[8, 12], 2, 5.0,
  ARRAY['Full hang at bottom', 'Pull chest to bar', 'Control descent', 'Squeeze shoulder blades'],
  ARRAY['Using too much assistance', 'Kipping', 'Partial reps'],
  'Set assistance weight so you can complete target reps with good form',
  'vertical_pull', ARRAY['assisted pull-up machine']),

-- QUAD EXERCISES
('Incline Leg Press', 'quads', ARRAY['glutes', 'hamstrings'], 'compound', ARRAY[8, 15], 2, 10.0,
  ARRAY['Full depth without butt lifting', 'Push through whole foot', 'Control eccentric', 'Don''t lock knees hard'],
  ARRAY['Knees caving in', 'Butt coming off pad', 'Bouncing at bottom'],
  '45-degree angle machine, feet shoulder width on platform',
  'squat', ARRAY['incline leg press machine']),

-- CALF EXERCISES
('Calf Press Machine', 'calves', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 5.0,
  ARRAY['Full stretch at bottom', 'Pause at peak contraction', 'Control tempo', 'Keep legs straight'],
  ARRAY['Bouncing', 'Partial reps', 'Bending knees'],
  'Position balls of feet on platform edge, push through toes',
  'calf_raise', ARRAY['calf machine']),

-- AB EXERCISES
('Hammer Strength Ab Crunch', 'abs', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 5.0,
  ARRAY['Crunch ribcage toward pelvis', 'Exhale as you crunch', 'Control the return', 'Feel abs contract'],
  ARRAY['Using arms to pull', 'Just bending at hips', 'Going too heavy'],
  'Adjust seat so chest pad is at upper chest, grab handles',
  'core', ARRAY['hammer strength ab machine']),

-- GLUTE/HIP EXERCISES
('Hip Abduction Machine', 'glutes', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 15], 2, 5.0,
  ARRAY['Push knees outward', 'Control the return', 'Keep back against pad', 'Squeeze at full abduction'],
  ARRAY['Using momentum', 'Leaning forward', 'Partial reps'],
  'Sit with back against pad, legs inside pads at knee level',
  'hip_hinge', ARRAY['hip abduction machine'])

ON CONFLICT (name) DO NOTHING;

