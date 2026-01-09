-- ============================================
-- POPULATE MISSING EQUIPMENT_REQUIRED VALUES
-- ============================================
-- Many exercises are missing equipment_required which breaks
-- the location-based equipment filtering. This migration
-- populates equipment_required based on exercise name patterns.

-- ============================================
-- MACHINE BRAND EXERCISES
-- ============================================

-- MTS (Machine Technology Series) exercises
UPDATE exercises SET equipment_required = ARRAY['mts machine']
WHERE LOWER(name) LIKE '%mts %'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- ISO-Lateral exercises (Hammer Strength)
UPDATE exercises SET equipment_required = ARRAY['iso-lateral machine']
WHERE (LOWER(name) LIKE '%iso-lateral%' OR LOWER(name) LIKE '%iso lateral%')
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Hammer Strength exercises
UPDATE exercises SET equipment_required = ARRAY['hammer strength machine']
WHERE LOWER(name) LIKE '%hammer strength%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Nautilus exercises
UPDATE exercises SET equipment_required = ARRAY['nautilus machine']
WHERE LOWER(name) LIKE '%nautilus%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Cybex exercises
UPDATE exercises SET equipment_required = ARRAY['cybex machine']
WHERE LOWER(name) LIKE '%cybex%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Katana exercises (cable/machine)
UPDATE exercises SET equipment_required = ARRAY['katana machine', 'cable machine']
WHERE LOWER(name) LIKE '%katana%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Technogym exercises
UPDATE exercises SET equipment_required = ARRAY['technogym machine']
WHERE LOWER(name) LIKE '%technogym%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Matrix exercises
UPDATE exercises SET equipment_required = ARRAY['matrix machine']
WHERE LOWER(name) LIKE '%matrix%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Precor exercises
UPDATE exercises SET equipment_required = ARRAY['precor machine']
WHERE LOWER(name) LIKE '%precor%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Life Fitness exercises
UPDATE exercises SET equipment_required = ARRAY['life fitness machine']
WHERE LOWER(name) LIKE '%life fitness%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- ============================================
-- SPECIFIC MACHINE TYPES
-- ============================================

-- Pendulum machines
UPDATE exercises SET equipment_required = ARRAY['pendulum machine']
WHERE LOWER(name) LIKE '%pendulum%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Belt squat machine
UPDATE exercises SET equipment_required = ARRAY['belt squat machine']
WHERE LOWER(name) LIKE '%belt squat%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Glute drive machine
UPDATE exercises SET equipment_required = ARRAY['glute drive machine']
WHERE LOWER(name) LIKE '%glute drive%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Hip thrust machine
UPDATE exercises SET equipment_required = ARRAY['hip thrust machine']
WHERE LOWER(name) LIKE '%hip thrust machine%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Reverse hyper machine
UPDATE exercises SET equipment_required = ARRAY['reverse hyper machine']
WHERE LOWER(name) LIKE '%reverse hyper%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Ab crunch machine
UPDATE exercises SET equipment_required = ARRAY['ab crunch machine']
WHERE LOWER(name) LIKE '%ab crunch machine%' OR LOWER(name) LIKE '%crunch machine%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Torso rotation machine
UPDATE exercises SET equipment_required = ARRAY['torso rotation machine']
WHERE LOWER(name) LIKE '%torso rotation%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Pec deck / Fly machine
UPDATE exercises SET equipment_required = ARRAY['pec deck machine']
WHERE (LOWER(name) LIKE '%pec deck%' OR LOWER(name) LIKE '%pec fly machine%')
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Hip abductor/adductor machine
UPDATE exercises SET equipment_required = ARRAY['hip abductor machine']
WHERE (LOWER(name) LIKE '%hip abduct%' OR LOWER(name) LIKE '%inner thigh%' OR LOWER(name) LIKE '%outer thigh%' OR LOWER(name) LIKE '%adduct%')
  AND LOWER(name) NOT LIKE '%cable%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- ============================================
-- CABLE EXERCISES (without explicit cable in name)
-- ============================================

-- Cable exercises with common patterns
UPDATE exercises SET equipment_required = ARRAY['cable machine']
WHERE (
  LOWER(name) LIKE '%cable%' OR
  LOWER(name) LIKE '%pulley%' OR
  LOWER(name) LIKE '%rope pushdown%' OR
  LOWER(name) LIKE '%rope pull%'
)
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- ============================================
-- SMITH MACHINE EXERCISES
-- ============================================

UPDATE exercises SET equipment_required = ARRAY['smith machine']
WHERE LOWER(name) LIKE '%smith%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- ============================================
-- GENERIC MACHINE EXERCISES
-- ============================================

-- Any exercise with "machine" in name that wasn't caught above
UPDATE exercises SET equipment_required = ARRAY['machine']
WHERE LOWER(name) LIKE '%machine%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- ============================================
-- COMMON EQUIPMENT PATTERNS
-- ============================================

-- Barbell exercises
UPDATE exercises SET equipment_required = ARRAY['barbell']
WHERE LOWER(name) LIKE '%barbell%'
  AND LOWER(name) NOT LIKE '%dumbbell%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Dumbbell exercises
UPDATE exercises SET equipment_required = ARRAY['dumbbells']
WHERE (LOWER(name) LIKE '%dumbbell%' OR LOWER(name) LIKE '% db %')
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Kettlebell exercises
UPDATE exercises SET equipment_required = ARRAY['kettlebell']
WHERE (LOWER(name) LIKE '%kettlebell%' OR LOWER(name) LIKE '% kb %')
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- EZ Bar exercises
UPDATE exercises SET equipment_required = ARRAY['ez curl bar']
WHERE (LOWER(name) LIKE '%ez bar%' OR LOWER(name) LIKE '%ez curl%')
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Trap bar / Hex bar exercises
UPDATE exercises SET equipment_required = ARRAY['trap bar']
WHERE (LOWER(name) LIKE '%trap bar%' OR LOWER(name) LIKE '%hex bar%')
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Landmine exercises
UPDATE exercises SET equipment_required = ARRAY['landmine', 'barbell']
WHERE LOWER(name) LIKE '%landmine%'
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- Resistance band exercises
UPDATE exercises SET equipment_required = ARRAY['resistance bands']
WHERE (LOWER(name) LIKE '%band%' OR LOWER(name) LIKE '%resistance band%')
  AND LOWER(name) NOT LIKE '%lateral band%' -- Some lateral raises say "band" but mean something else
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- TRX/Suspension exercises
UPDATE exercises SET equipment_required = ARRAY['trx']
WHERE (LOWER(name) LIKE '%trx%' OR LOWER(name) LIKE '%suspension%')
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- ============================================
-- BODYWEIGHT EXERCISES
-- ============================================

-- Mark common bodyweight exercises
UPDATE exercises SET
  equipment_required = '{}',
  is_bodyweight = true
WHERE LOWER(name) IN (
  'push-up', 'push up', 'pushup',
  'pull-up', 'pull up', 'pullup',
  'chin-up', 'chin up', 'chinup',
  'dip', 'dips',
  'bodyweight squat', 'air squat',
  'lunge', 'lunges',
  'plank', 'side plank',
  'mountain climber', 'mountain climbers',
  'burpee', 'burpees',
  'jumping jack', 'jumping jacks',
  'crunch', 'crunches',
  'sit-up', 'sit up', 'situp',
  'leg raise', 'hanging leg raise',
  'flutter kick', 'flutter kicks',
  'bicycle crunch', 'bicycle crunches',
  'superman', 'back extension'
)
  AND (equipment_required IS NULL OR equipment_required = '{}');

-- ============================================
-- LOG UPDATED EXERCISES
-- ============================================

-- This comment helps track which exercises were updated
-- Run: SELECT name, equipment_required FROM exercises WHERE equipment_required IS NOT NULL AND equipment_required != '{}' ORDER BY name;
