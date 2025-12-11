-- Add new exercises to the database
-- These exercises were added to the fallback array and need to be in the DB

INSERT INTO exercises (name, primary_muscle, secondary_muscles, mechanic, movement_pattern, equipment_required, default_rep_range, default_rir, min_weight_increment_kg, difficulty, fatigue_rating, pattern, equipment)
VALUES
-- CHEST
('Pec Deck', 'chest', '{}', 'isolation', 'isolation', '{machine}', '{12,15}', 2, 5.0, 'beginner', 1, 'isolation', 'machine'),
('Smith Machine Bench Press', 'chest', '{triceps,shoulders}', 'compound', 'horizontal_push', '{machine}', '{8,12}', 2, 2.5, 'beginner', 2, 'horizontal_push', 'machine'),
('Smith Machine Incline Press', 'chest', '{triceps,shoulders}', 'compound', 'horizontal_push', '{machine}', '{8,12}', 2, 2.5, 'beginner', 2, 'horizontal_push', 'machine'),
('Decline Barbell Press', 'chest', '{triceps}', 'compound', 'horizontal_push', '{barbell}', '{6,10}', 2, 2.5, 'intermediate', 2, 'horizontal_push', 'barbell'),

-- BACK
('Seated Machine Row', 'back', '{biceps}', 'compound', 'horizontal_pull', '{machine}', '{10,15}', 2, 5.0, 'beginner', 1, 'horizontal_pull', 'machine'),
('Chest Supported Row', 'back', '{biceps}', 'compound', 'horizontal_pull', '{machine}', '{10,15}', 2, 5.0, 'beginner', 1, 'horizontal_pull', 'machine'),
('Assisted Pull-Up Machine', 'back', '{biceps}', 'compound', 'vertical_pull', '{machine}', '{8,12}', 2, 5.0, 'beginner', 1, 'vertical_pull', 'machine'),
('Straight Arm Pulldown', 'back', '{}', 'isolation', 'vertical_pull', '{cable}', '{12,15}', 2, 2.5, 'beginner', 1, 'vertical_pull', 'cable'),
('Close Grip Lat Pulldown', 'back', '{biceps}', 'compound', 'vertical_pull', '{cable}', '{10,15}', 2, 2.5, 'beginner', 1, 'vertical_pull', 'cable'),
('Back Extension', 'back', '{hamstrings,glutes}', 'compound', 'hip_hinge', '{bodyweight}', '{12,20}', 2, 0, 'beginner', 1, 'hip_hinge', 'bodyweight'),

-- SHOULDERS
('Rear Delt Machine', 'shoulders', '{back}', 'isolation', 'isolation', '{machine}', '{12,20}', 2, 5.0, 'beginner', 1, 'isolation', 'machine'),
('Machine Lateral Raise', 'shoulders', '{}', 'isolation', 'isolation', '{machine}', '{12,20}', 2, 2.5, 'beginner', 1, 'isolation', 'machine'),
('Smith Machine Shoulder Press', 'shoulders', '{triceps}', 'compound', 'vertical_push', '{machine}', '{8,12}', 2, 2.5, 'beginner', 2, 'vertical_push', 'machine'),
('Upright Row', 'shoulders', '{biceps}', 'compound', 'vertical_pull', '{barbell}', '{10,15}', 2, 2.5, 'intermediate', 2, 'vertical_pull', 'barbell'),
('Cable Upright Row', 'shoulders', '{biceps}', 'compound', 'vertical_pull', '{cable}', '{12,15}', 2, 2.5, 'beginner', 1, 'vertical_pull', 'cable'),
('Front Raise', 'shoulders', '{}', 'isolation', 'isolation', '{dumbbell}', '{12,15}', 2, 1.0, 'beginner', 1, 'isolation', 'dumbbell'),

-- BICEPS
('Machine Bicep Curl', 'biceps', '{}', 'isolation', 'isolation', '{machine}', '{10,15}', 2, 2.5, 'beginner', 1, 'isolation', 'machine'),
('Incline Dumbbell Curl', 'biceps', '{}', 'isolation', 'isolation', '{dumbbell}', '{10,15}', 2, 1.0, 'beginner', 1, 'isolation', 'dumbbell'),
('Concentration Curl', 'biceps', '{}', 'isolation', 'isolation', '{dumbbell}', '{10,15}', 2, 1.0, 'beginner', 1, 'isolation', 'dumbbell'),
('EZ Bar Curl', 'biceps', '{}', 'isolation', 'isolation', '{barbell}', '{8,12}', 2, 2.5, 'beginner', 1, 'isolation', 'barbell'),

-- TRICEPS
('Machine Tricep Extension', 'triceps', '{}', 'isolation', 'isolation', '{machine}', '{10,15}', 2, 2.5, 'beginner', 1, 'isolation', 'machine'),
('Rope Tricep Pushdown', 'triceps', '{}', 'isolation', 'isolation', '{cable}', '{12,15}', 2, 2.5, 'beginner', 1, 'isolation', 'cable'),
('Assisted Dip Machine', 'triceps', '{chest,shoulders}', 'compound', 'vertical_push', '{machine}', '{10,15}', 2, 5.0, 'beginner', 1, 'vertical_push', 'machine'),
('Dumbbell Kickback', 'triceps', '{}', 'isolation', 'isolation', '{dumbbell}', '{12,15}', 2, 1.0, 'beginner', 1, 'isolation', 'dumbbell'),

-- QUADS
('Smith Machine Squat', 'quads', '{glutes}', 'compound', 'squat', '{machine}', '{8,12}', 2, 2.5, 'beginner', 2, 'squat', 'machine'),
('Pendulum Squat', 'quads', '{glutes}', 'compound', 'squat', '{machine}', '{10,15}', 2, 5.0, 'beginner', 2, 'squat', 'machine'),
('Sissy Squat', 'quads', '{}', 'isolation', 'squat', '{bodyweight}', '{12,20}', 2, 0, 'intermediate', 1, 'squat', 'bodyweight'),
('Reverse Lunge', 'quads', '{glutes}', 'compound', 'lunge', '{dumbbell}', '{10,15}', 2, 2.0, 'beginner', 2, 'lunge', 'dumbbell'),
('Step Up', 'quads', '{glutes}', 'compound', 'lunge', '{dumbbell}', '{10,15}', 2, 2.0, 'beginner', 2, 'lunge', 'dumbbell'),

-- HAMSTRINGS
('Stiff Leg Deadlift', 'hamstrings', '{back,glutes}', 'compound', 'hip_hinge', '{barbell}', '{8,12}', 2, 2.5, 'intermediate', 2, 'hip_hinge', 'barbell'),
('Single Leg RDL', 'hamstrings', '{glutes}', 'compound', 'hip_hinge', '{dumbbell}', '{10,15}', 2, 2.0, 'intermediate', 2, 'hip_hinge', 'dumbbell'),
('Nordic Curl', 'hamstrings', '{}', 'isolation', 'isolation', '{bodyweight}', '{5,10}', 2, 0, 'advanced', 2, 'isolation', 'bodyweight'),

-- GLUTES
('Glute Drive Machine', 'glutes', '{hamstrings}', 'compound', 'hip_hinge', '{machine}', '{10,15}', 2, 5.0, 'beginner', 1, 'hip_hinge', 'machine'),
('Hip Abduction Machine', 'glutes', '{}', 'isolation', 'isolation', '{machine}', '{15,20}', 2, 5.0, 'beginner', 1, 'isolation', 'machine'),
('Hip Adduction Machine', 'glutes', '{}', 'isolation', 'isolation', '{machine}', '{15,20}', 2, 5.0, 'beginner', 1, 'isolation', 'machine'),
('Glute Bridge', 'glutes', '{hamstrings}', 'compound', 'hip_hinge', '{bodyweight}', '{15,20}', 2, 0, 'beginner', 1, 'hip_hinge', 'bodyweight'),
('Single Leg Hip Thrust', 'glutes', '{hamstrings}', 'compound', 'hip_hinge', '{bodyweight}', '{10,15}', 2, 0, 'intermediate', 2, 'hip_hinge', 'bodyweight'),
('Sumo Deadlift', 'glutes', '{hamstrings,back,quads}', 'compound', 'hip_hinge', '{barbell}', '{4,8}', 2, 2.5, 'intermediate', 3, 'hip_hinge', 'barbell'),

-- CALVES
('Leg Press Calf Raise', 'calves', '{}', 'isolation', 'isolation', '{machine}', '{15,25}', 2, 5.0, 'beginner', 1, 'isolation', 'machine'),
('Smith Machine Calf Raise', 'calves', '{}', 'isolation', 'isolation', '{machine}', '{15,25}', 2, 2.5, 'beginner', 1, 'isolation', 'machine'),
('Donkey Calf Raise', 'calves', '{}', 'isolation', 'isolation', '{machine}', '{15,25}', 2, 5.0, 'beginner', 1, 'isolation', 'machine'),

-- ABS
('Machine Ab Crunch', 'abs', '{}', 'isolation', 'isolation', '{machine}', '{15,20}', 2, 5.0, 'beginner', 1, 'isolation', 'machine'),
('Decline Crunch', 'abs', '{}', 'isolation', 'isolation', '{bodyweight}', '{15,25}', 2, 0, 'beginner', 1, 'isolation', 'bodyweight'),
('Captain''s Chair Leg Raise', 'abs', '{}', 'isolation', 'isolation', '{bodyweight}', '{12,20}', 2, 0, 'intermediate', 1, 'isolation', 'bodyweight'),
('Pallof Press', 'abs', '{}', 'isolation', 'isolation', '{cable}', '{12,15}', 2, 2.5, 'beginner', 1, 'isolation', 'cable'),
('Dead Bug', 'abs', '{}', 'isolation', 'isolation', '{bodyweight}', '{12,20}', 2, 0, 'beginner', 1, 'isolation', 'bodyweight'),
('Russian Twist', 'abs', '{}', 'isolation', 'isolation', '{bodyweight}', '{15,25}', 2, 0, 'beginner', 1, 'isolation', 'bodyweight'),
('Cable Woodchop', 'abs', '{shoulders}', 'isolation', 'isolation', '{cable}', '{12,15}', 2, 2.5, 'beginner', 1, 'isolation', 'cable'),

-- FUNCTIONAL / CARRIES
('Farmer''s Carry', 'abs', '{shoulders,back}', 'compound', 'carry', '{dumbbell}', '{30,60}', 2, 2.0, 'beginner', 2, 'carry', 'dumbbell'),
('Suitcase Carry', 'abs', '{shoulders}', 'compound', 'carry', '{dumbbell}', '{30,60}', 2, 2.0, 'beginner', 2, 'carry', 'dumbbell'),

-- NIPPARD S-TIER EXERCISES
('Seated Cable Fly', 'chest', '{}', 'isolation', 'isolation', '{cable}', '{12,15}', 2, 2.5, 'beginner', 1, 'isolation', 'cable'),
('Meadows Row', 'back', '{biceps}', 'compound', 'horizontal_pull', '{barbell}', '{10,15}', 2, 2.5, 'intermediate', 2, 'horizontal_pull', 'barbell'),
('Behind-the-Back Cable Lateral Raise', 'shoulders', '{}', 'isolation', 'isolation', '{cable}', '{12,20}', 2, 2.5, 'beginner', 1, 'isolation', 'cable'),
('Cable Y-Raise', 'shoulders', '{}', 'isolation', 'isolation', '{cable}', '{12,20}', 2, 2.5, 'beginner', 1, 'isolation', 'cable'),
('Reverse Cable Crossover', 'shoulders', '{back}', 'isolation', 'isolation', '{cable}', '{12,20}', 2, 2.5, 'beginner', 1, 'isolation', 'cable'),
('Bayesian Cable Curl', 'biceps', '{}', 'isolation', 'isolation', '{cable}', '{10,15}', 2, 2.5, 'beginner', 1, 'isolation', 'cable'),
('45° Preacher Curl', 'biceps', '{}', 'isolation', 'isolation', '{dumbbell}', '{10,15}', 2, 1.0, 'beginner', 1, 'isolation', 'dumbbell'),
('Katana Tricep Extension', 'triceps', '{}', 'isolation', 'isolation', '{cable}', '{10,15}', 2, 2.5, 'intermediate', 1, 'isolation', 'cable')

ON CONFLICT (name) DO NOTHING;

