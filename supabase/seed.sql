-- ============================================
-- EXERCISE SEED DATA
-- ~50 common hypertrophy exercises
-- ============================================

INSERT INTO exercises (name, primary_muscle, secondary_muscles, mechanic, default_rep_range, default_rir, min_weight_increment_kg, form_cues, common_mistakes, setup_note, movement_pattern, equipment_required) VALUES

-- ============================================
-- CHEST EXERCISES
-- ============================================
('Barbell Bench Press', 'chest', ARRAY['triceps', 'shoulders'], 'compound', ARRAY[6, 10], 2, 2.5,
  ARRAY['Arch upper back, not lower', 'Tuck elbows 45 degrees', 'Touch mid-chest', 'Drive feet into floor'],
  ARRAY['Bouncing bar off chest', 'Flaring elbows 90 degrees', 'Lifting hips off bench'],
  'Set up with eyes under bar, grip slightly wider than shoulders',
  'horizontal_push', ARRAY['barbell', 'bench']),

('Dumbbell Bench Press', 'chest', ARRAY['triceps', 'shoulders'], 'compound', ARRAY[8, 12], 2, 2.0,
  ARRAY['Keep shoulder blades pinched', 'Control the eccentric', 'Press in slight arc'],
  ARRAY['Going too heavy too fast', 'Letting dumbbells drift outward at bottom'],
  'Kick dumbbells up from thighs to start position',
  'horizontal_push', ARRAY['dumbbells', 'bench']),

('Incline Dumbbell Press', 'chest', ARRAY['shoulders', 'triceps'], 'compound', ARRAY[8, 12], 2, 2.0,
  ARRAY['30-45 degree incline', 'Drive through upper chest', 'Full stretch at bottom'],
  ARRAY['Angle too steep (becomes shoulder press)', 'Cutting range of motion short'],
  'Set bench to 30-45 degrees, avoid going higher',
  'horizontal_push', ARRAY['dumbbells', 'adjustable bench']),

('Cable Fly', 'chest', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 15], 2, 2.5,
  ARRAY['Slight bend in elbows', 'Squeeze at peak contraction', 'Control the stretch'],
  ARRAY['Using too much weight', 'Turning it into a press'],
  'Set cables at chest height for mid-chest focus',
  'horizontal_push', ARRAY['cable machine']),

('Machine Chest Press', 'chest', ARRAY['triceps', 'shoulders'], 'compound', ARRAY[8, 12], 2, 5.0,
  ARRAY['Keep chest up', 'Drive through chest not shoulders', 'Full range of motion'],
  ARRAY['Letting shoulders roll forward', 'Using momentum'],
  'Adjust seat so handles align with mid-chest',
  'horizontal_push', ARRAY['chest press machine']),

('Dips (Chest Focus)', 'chest', ARRAY['triceps', 'shoulders'], 'compound', ARRAY[8, 12], 2, 2.5,
  ARRAY['Lean forward 30 degrees', 'Go to 90 degree elbow bend', 'Keep elbows slightly flared'],
  ARRAY['Staying too upright (tricep focus)', 'Going too deep causing shoulder strain'],
  'Use wider grip and lean forward for chest emphasis',
  'horizontal_push', ARRAY['dip bars']),

-- ============================================
-- BACK EXERCISES
-- ============================================
('Barbell Row', 'back', ARRAY['biceps', 'rear delts'], 'compound', ARRAY[6, 10], 2, 2.5,
  ARRAY['Hinge at hips 45 degrees', 'Pull to lower chest/upper abs', 'Squeeze shoulder blades'],
  ARRAY['Using too much momentum', 'Rounding lower back', 'Standing too upright'],
  'Overhand grip slightly wider than shoulders',
  'horizontal_pull', ARRAY['barbell']),

('Dumbbell Row', 'back', ARRAY['biceps', 'rear delts'], 'compound', ARRAY[8, 12], 2, 2.0,
  ARRAY['Keep hips square', 'Pull elbow past torso', 'Full stretch at bottom'],
  ARRAY['Rotating torso excessively', 'Cutting range short'],
  'Brace on bench with opposite hand and knee',
  'horizontal_pull', ARRAY['dumbbell', 'bench']),

('Lat Pulldown', 'back', ARRAY['biceps'], 'compound', ARRAY[8, 12], 2, 5.0,
  ARRAY['Lean back slightly', 'Pull to upper chest', 'Lead with elbows'],
  ARRAY['Pulling behind neck', 'Using body momentum', 'Grip too wide'],
  'Grip slightly wider than shoulders, lean back 15-20 degrees',
  'vertical_pull', ARRAY['cable machine', 'lat pulldown bar']),

('Pull-Ups', 'back', ARRAY['biceps'], 'compound', ARRAY[6, 12], 2, 2.5,
  ARRAY['Full hang at bottom', 'Chin over bar', 'Control the descent'],
  ARRAY['Kipping/swinging', 'Half reps', 'Shrugging shoulders'],
  'Overhand grip, hands shoulder width or slightly wider',
  'vertical_pull', ARRAY['pull-up bar']),

('Cable Row', 'back', ARRAY['biceps', 'rear delts'], 'compound', ARRAY[10, 15], 2, 5.0,
  ARRAY['Keep chest up', 'Pull to lower chest', 'Pause at contraction'],
  ARRAY['Excessive body swing', 'Rounding forward'],
  'Sit with slight knee bend, maintain upright torso',
  'horizontal_pull', ARRAY['cable machine', 'row handle']),

('Chest Supported Row', 'back', ARRAY['biceps', 'rear delts'], 'compound', ARRAY[8, 12], 2, 2.0,
  ARRAY['Chest firmly on pad', 'Full stretch at bottom', 'Squeeze at top'],
  ARRAY['Lifting chest off pad', 'Using momentum'],
  'Set bench at 30-45 degrees, lie face down',
  'horizontal_pull', ARRAY['dumbbells', 'incline bench']),

('Deadlift', 'back', ARRAY['glutes', 'hamstrings', 'quads'], 'compound', ARRAY[5, 8], 3, 2.5,
  ARRAY['Bar over mid-foot', 'Push floor away', 'Lockout with glutes', 'Neutral spine throughout'],
  ARRAY['Rounding lower back', 'Bar drifting forward', 'Hyperextending at top'],
  'Stance hip width, grip just outside legs',
  'hip_hinge', ARRAY['barbell']),

-- ============================================
-- SHOULDER EXERCISES
-- ============================================
('Overhead Press', 'shoulders', ARRAY['triceps'], 'compound', ARRAY[6, 10], 2, 2.5,
  ARRAY['Brace core tight', 'Press in slight arc', 'Finish with bar over head'],
  ARRAY['Excessive back arch', 'Pressing forward', 'Not finishing lockout'],
  'Start with bar at collar bones, elbows slightly in front',
  'vertical_push', ARRAY['barbell']),

('Dumbbell Shoulder Press', 'shoulders', ARRAY['triceps'], 'compound', ARRAY[8, 12], 2, 2.0,
  ARRAY['Keep elbows under wrists', 'Press overhead not forward', 'Control the weight'],
  ARRAY['Elbows drifting back', 'Using leg drive', 'Cutting depth short'],
  'Seated for stricter form, standing for more core engagement',
  'vertical_push', ARRAY['dumbbells']),

('Lateral Raise', 'shoulders', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 15], 2, 1.0,
  ARRAY['Slight bend in elbows', 'Lead with elbows not hands', 'Stop at shoulder height'],
  ARRAY['Using momentum', 'Going too heavy', 'Shrugging traps'],
  'Start with arms at sides, palms facing body',
  'shoulder_isolation', ARRAY['dumbbells']),

('Face Pull', 'shoulders', ARRAY['rear delts', 'back'], 'isolation', ARRAY[15, 20], 2, 2.5,
  ARRAY['Pull to face level', 'Externally rotate at end', 'Squeeze rear delts'],
  ARRAY['Pulling too low', 'Using too much weight', 'Not rotating'],
  'Set cable at face height, use rope attachment',
  'shoulder_isolation', ARRAY['cable machine', 'rope attachment']),

('Rear Delt Fly', 'shoulders', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 15], 2, 1.0,
  ARRAY['Slight bend in elbows', 'Lead with elbows', 'Squeeze at top'],
  ARRAY['Using momentum', 'Not feeling rear delts', 'Going too heavy'],
  'Bent over 45-90 degrees or use pec deck reverse',
  'shoulder_isolation', ARRAY['dumbbells']),

-- ============================================
-- BICEP EXERCISES
-- ============================================
('Barbell Curl', 'biceps', ARRAY[]::TEXT[], 'isolation', ARRAY[8, 12], 2, 2.5,
  ARRAY['Keep elbows pinned to sides', 'Full extension at bottom', 'Squeeze at top'],
  ARRAY['Swinging body', 'Moving elbows forward', 'Cutting range short'],
  'Shoulder width grip, stand with back against wall for stricter form',
  'elbow_flexion', ARRAY['barbell', 'ez curl bar']),

('Dumbbell Curl', 'biceps', ARRAY[]::TEXT[], 'isolation', ARRAY[10, 15], 2, 1.0,
  ARRAY['Supinate wrist during curl', 'Control the negative', 'Full stretch at bottom'],
  ARRAY['Using momentum', 'Curling too fast', 'Not supinating'],
  'Can alternate or curl simultaneously',
  'elbow_flexion', ARRAY['dumbbells']),

('Incline Dumbbell Curl', 'biceps', ARRAY[]::TEXT[], 'isolation', ARRAY[10, 15], 2, 1.0,
  ARRAY['Let arms hang straight down', 'Keep upper arms still', 'Full stretch'],
  ARRAY['Bringing elbows forward', 'Not going to full extension'],
  'Set bench to 45-60 degrees, arms hang behind body',
  'elbow_flexion', ARRAY['dumbbells', 'incline bench']),

('Hammer Curl', 'biceps', ARRAY['forearms'], 'isolation', ARRAY[10, 15], 2, 1.0,
  ARRAY['Keep palms facing each other', 'Elbows pinned', 'Control throughout'],
  ARRAY['Swinging', 'Flaring elbows out'],
  'Neutral grip throughout the movement',
  'elbow_flexion', ARRAY['dumbbells']),

('Cable Curl', 'biceps', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 15], 2, 2.5,
  ARRAY['Constant tension throughout', 'Squeeze at top', 'Control negative'],
  ARRAY['Leaning back', 'Using momentum'],
  'Use straight bar or EZ bar attachment',
  'elbow_flexion', ARRAY['cable machine']),

('Preacher Curl', 'biceps', ARRAY[]::TEXT[], 'isolation', ARRAY[10, 12], 2, 2.5,
  ARRAY['Upper arms flat on pad', 'Full stretch at bottom', 'Don''t hyperextend'],
  ARRAY['Cutting range short', 'Moving shoulders'],
  'Adjust pad height so armpits rest on top',
  'elbow_flexion', ARRAY['preacher bench', 'barbell']),

-- ============================================
-- TRICEP EXERCISES
-- ============================================
('Tricep Pushdown', 'triceps', ARRAY[]::TEXT[], 'isolation', ARRAY[10, 15], 2, 2.5,
  ARRAY['Keep elbows pinned to sides', 'Full extension', 'Control the return'],
  ARRAY['Elbows moving', 'Using body momentum', 'Partial reps'],
  'Stand upright, slight forward lean okay',
  'elbow_extension', ARRAY['cable machine']),

('Skull Crusher', 'triceps', ARRAY[]::TEXT[], 'isolation', ARRAY[8, 12], 2, 2.5,
  ARRAY['Lower to forehead or behind head', 'Keep elbows narrow', 'Full extension'],
  ARRAY['Flaring elbows', 'Moving upper arms', 'Going too heavy'],
  'Can use EZ bar or dumbbells, lower behind head for more stretch',
  'elbow_extension', ARRAY['ez curl bar', 'bench']),

('Overhead Tricep Extension', 'triceps', ARRAY[]::TEXT[], 'isolation', ARRAY[10, 15], 2, 2.0,
  ARRAY['Keep elbows close to head', 'Full stretch at bottom', 'Squeeze at top'],
  ARRAY['Flaring elbows', 'Using momentum', 'Not getting full stretch'],
  'Can use dumbbell, cable, or rope attachment',
  'elbow_extension', ARRAY['dumbbell']),

('Close Grip Bench Press', 'triceps', ARRAY['chest', 'shoulders'], 'compound', ARRAY[8, 12], 2, 2.5,
  ARRAY['Hands shoulder width or slightly narrower', 'Tuck elbows to sides', 'Touch lower chest'],
  ARRAY['Grip too narrow', 'Flaring elbows', 'Bouncing off chest'],
  'Grip inside smooth rings on barbell',
  'elbow_extension', ARRAY['barbell', 'bench']),

('Dips (Tricep Focus)', 'triceps', ARRAY['chest', 'shoulders'], 'compound', ARRAY[8, 12], 2, 2.5,
  ARRAY['Stay upright', 'Elbows close to body', 'Go to 90 degrees'],
  ARRAY['Leaning too far forward', 'Going too deep'],
  'Narrow grip, stay vertical throughout',
  'elbow_extension', ARRAY['dip bars']),

-- ============================================
-- QUAD EXERCISES
-- ============================================
('Barbell Back Squat', 'quads', ARRAY['glutes', 'hamstrings'], 'compound', ARRAY[6, 10], 2, 2.5,
  ARRAY['Break at hips and knees together', 'Knees track over toes', 'Maintain neutral spine', 'Drive through whole foot'],
  ARRAY['Knees caving in', 'Excessive forward lean', 'Rising on toes', 'Rounding lower back'],
  'Bar on upper traps, stance shoulder width or slightly wider',
  'squat', ARRAY['barbell', 'squat rack']),

('Leg Press', 'quads', ARRAY['glutes', 'hamstrings'], 'compound', ARRAY[8, 15], 2, 10.0,
  ARRAY['Full depth without butt rising', 'Push through whole foot', 'Control the eccentric'],
  ARRAY['Letting knees cave', 'Butt coming off pad', 'Partial reps'],
  'Feet shoulder width, middle of platform for quad focus',
  'squat', ARRAY['leg press machine']),

('Leg Extension', 'quads', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 15], 2, 2.5,
  ARRAY['Pause at top contraction', 'Control the negative', 'Keep back against pad'],
  ARRAY['Using momentum', 'Lifting hips', 'Going too fast'],
  'Adjust pad to sit just above ankles',
  'knee_flexion', ARRAY['leg extension machine']),

('Hack Squat', 'quads', ARRAY['glutes'], 'compound', ARRAY[8, 12], 2, 5.0,
  ARRAY['Push through whole foot', 'Don''t lock out aggressively', 'Full depth'],
  ARRAY['Knees caving', 'Heels rising', 'Cutting depth'],
  'Shoulder pads on top, back flat against pad',
  'squat', ARRAY['hack squat machine']),

('Bulgarian Split Squat', 'quads', ARRAY['glutes', 'hamstrings'], 'compound', ARRAY[8, 12], 2, 2.0,
  ARRAY['Front shin vertical', 'Drop back knee down', 'Keep torso upright'],
  ARRAY['Leaning too far forward', 'Front knee caving', 'Back foot too high'],
  'Back foot on bench, front foot 2-3 feet ahead',
  'lunge', ARRAY['dumbbells', 'bench']),

('Walking Lunges', 'quads', ARRAY['glutes', 'hamstrings'], 'compound', ARRAY[10, 15], 2, 2.0,
  ARRAY['Take full steps', 'Keep torso upright', 'Push through front heel'],
  ARRAY['Short steps', 'Knee going past toe excessively', 'Leaning forward'],
  'Long strides for glute emphasis, shorter for quads',
  'lunge', ARRAY['dumbbells']),

-- ============================================
-- HAMSTRING EXERCISES
-- ============================================
('Romanian Deadlift', 'hamstrings', ARRAY['glutes', 'back'], 'compound', ARRAY[8, 12], 2, 2.5,
  ARRAY['Hinge at hips', 'Keep bar close to body', 'Soft knee bend', 'Feel hamstring stretch'],
  ARRAY['Rounding lower back', 'Bending knees too much', 'Bar drifting forward'],
  'Start standing, hinge back until hamstring stretch',
  'hip_hinge', ARRAY['barbell']),

('Lying Leg Curl', 'hamstrings', ARRAY[]::TEXT[], 'isolation', ARRAY[10, 15], 2, 2.5,
  ARRAY['Don''t lift hips', 'Full range of motion', 'Control the negative'],
  ARRAY['Using momentum', 'Hips rising', 'Cutting range short'],
  'Pad above heels, hips stay down throughout',
  'knee_flexion', ARRAY['leg curl machine']),

('Seated Leg Curl', 'hamstrings', ARRAY[]::TEXT[], 'isolation', ARRAY[10, 15], 2, 2.5,
  ARRAY['Flex fully', 'Control eccentric', 'Keep back against pad'],
  ARRAY['Jerking the weight', 'Lifting off seat', 'Partial reps'],
  'Adjust so knee aligns with machine pivot point',
  'knee_flexion', ARRAY['seated leg curl machine']),

('Good Morning', 'hamstrings', ARRAY['glutes', 'back'], 'compound', ARRAY[8, 12], 2, 2.5,
  ARRAY['Soft knee bend', 'Hinge until parallel', 'Drive hips forward to stand'],
  ARRAY['Rounding back', 'Going too heavy', 'Excessive knee bend'],
  'Bar on upper back like squat, lighter weight than squat',
  'hip_hinge', ARRAY['barbell']),

-- ============================================
-- GLUTE EXERCISES
-- ============================================
('Hip Thrust', 'glutes', ARRAY['hamstrings'], 'compound', ARRAY[8, 12], 2, 2.5,
  ARRAY['Drive through heels', 'Squeeze glutes hard at top', 'Don''t hyperextend lower back'],
  ARRAY['Using lower back', 'Not squeezing at top', 'Bar rolling'],
  'Upper back on bench, bar over hips with pad',
  'hip_hinge', ARRAY['barbell', 'bench', 'barbell pad']),

('Cable Pull Through', 'glutes', ARRAY['hamstrings'], 'compound', ARRAY[12, 15], 2, 5.0,
  ARRAY['Hinge at hips', 'Feel stretch in hamstrings', 'Squeeze glutes at top'],
  ARRAY['Using arms to pull', 'Rounding back', 'Using momentum'],
  'Face away from cable, rope between legs',
  'hip_hinge', ARRAY['cable machine', 'rope attachment']),

('Glute Bridge', 'glutes', ARRAY['hamstrings'], 'isolation', ARRAY[12, 15], 2, 2.0,
  ARRAY['Drive through heels', 'Squeeze glutes at top', 'Keep ribs down'],
  ARRAY['Overarching back', 'Using hamstrings instead of glutes'],
  'Lie on back, feet flat on floor near glutes',
  'hip_hinge', ARRAY['bodyweight', 'dumbbell']),

-- ============================================
-- CALF EXERCISES
-- ============================================
('Standing Calf Raise', 'calves', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 5.0,
  ARRAY['Full stretch at bottom', 'Pause at top', 'Keep legs straight'],
  ARRAY['Bouncing', 'Bending knees', 'Cutting range short'],
  'Toes on platform, heels hanging off',
  'calf_raise', ARRAY['calf raise machine']),

('Seated Calf Raise', 'calves', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 5.0,
  ARRAY['Full stretch at bottom', 'Pause at peak contraction', 'Control tempo'],
  ARRAY['Bouncing', 'Partial reps', 'Going too fast'],
  'Pad on lower thighs, balls of feet on platform',
  'calf_raise', ARRAY['seated calf raise machine']),

('Leg Press Calf Raise', 'calves', ARRAY[]::TEXT[], 'isolation', ARRAY[15, 25], 2, 10.0,
  ARRAY['Only balls of feet on platform', 'Full range of motion', 'Don''t lock knees'],
  ARRAY['Using too much weight', 'Partial reps'],
  'Feet at bottom edge of platform, push through toes',
  'calf_raise', ARRAY['leg press machine']),

-- ============================================
-- AB EXERCISES
-- ============================================
('Cable Crunch', 'abs', ARRAY[]::TEXT[], 'isolation', ARRAY[12, 20], 2, 5.0,
  ARRAY['Crunch rib cage toward pelvis', 'Keep hips still', 'Full stretch at top'],
  ARRAY['Using hip flexors', 'Just bending at hips', 'Going too heavy'],
  'Kneel facing cable, rope behind head',
  'core', ARRAY['cable machine', 'rope attachment']),

('Hanging Leg Raise', 'abs', ARRAY['hip flexors'], 'compound', ARRAY[10, 15], 2, 0.0,
  ARRAY['Curl pelvis up', 'Control the swing', 'Full range of motion'],
  ARRAY['Just lifting legs (hip flexors)', 'Swinging', 'Partial reps'],
  'Dead hang from bar, can bend knees to make easier',
  'core', ARRAY['pull-up bar']),

('Ab Wheel Rollout', 'abs', ARRAY[]::TEXT[], 'compound', ARRAY[8, 15], 2, 0.0,
  ARRAY['Brace core tight', 'Don''t let hips sag', 'Control the rollout'],
  ARRAY['Hips sagging', 'Not controlling eccentric', 'Going too far too soon'],
  'Start on knees, progress to standing',
  'core', ARRAY['ab wheel']),

('Plank', 'abs', ARRAY['shoulders'], 'isolation', ARRAY[30, 60], 2, 0.0,
  ARRAY['Keep body straight', 'Squeeze glutes', 'Don''t let hips sag or pike'],
  ARRAY['Hips too high', 'Hips sagging', 'Not breathing'],
  'Forearms on ground, elbows under shoulders',
  'core', ARRAY['bodyweight']);

