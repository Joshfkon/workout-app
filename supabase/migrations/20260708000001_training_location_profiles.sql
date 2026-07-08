-- ============================================
-- TRAINING LOCATION PROFILES
-- ============================================
-- Extends gym_locations into full "training location" profiles used by the
-- AI workout adjuster's pre-workout sheet:
--   * icon           — emoji shown on the location chip row (🏠 / 🏋️ / 🧳)
--   * preset_kind    — which preset seeded the location ('gym' | 'home' |
--                      'travel' | 'custom'), used to avoid re-seeding presets
--   * last_used_at   — powers the "default to last-used location" behavior
--   * dumbbell_max_kg — heaviest dumbbell available at the location; caps
--                       dumbbell weight suggestions when training there
-- Also creates + seeds equipment_types so the per-location equipment
-- checklist (user_equipment) has a canonical inventory list in every
-- environment. The seed is idempotent (ON CONFLICT DO NOTHING) so hosted
-- databases that already carry equipment_types rows are left untouched.

ALTER TABLE gym_locations ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE gym_locations ADD COLUMN IF NOT EXISTS preset_kind TEXT
  CHECK (preset_kind IN ('gym', 'home', 'travel', 'custom'));
ALTER TABLE gym_locations ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE gym_locations ADD COLUMN IF NOT EXISTS dumbbell_max_kg NUMERIC
  CHECK (dumbbell_max_kg IS NULL OR (dumbbell_max_kg > 0 AND dumbbell_max_kg < 200));

CREATE INDEX IF NOT EXISTS idx_gym_locations_last_used
  ON gym_locations(user_id, last_used_at DESC NULLS LAST);

-- ============================================
-- EQUIPMENT TYPES (canonical checklist inventory)
-- ============================================
-- IDs match EQUIPMENT_MAPPING in services/equipmentFilter.ts; categories
-- match CATEGORY_LABELS in components/settings/GymEquipmentSettings.tsx.

CREATE TABLE IF NOT EXISTS equipment_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT
);

ALTER TABLE equipment_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view equipment types" ON equipment_types;
CREATE POLICY "Anyone can view equipment types"
  ON equipment_types FOR SELECT
  USING (true);

INSERT INTO equipment_types (id, name, category, description) VALUES
  -- Machines
  ('leg_press',              'Leg Press',              'machines', NULL),
  ('leg_extension',          'Leg Extension',          'machines', NULL),
  ('leg_curl',               'Leg Curl',               'machines', NULL),
  ('hack_squat',             'Hack Squat',             'machines', NULL),
  ('smith_machine',          'Smith Machine',          'machines', NULL),
  ('chest_press',            'Chest Press Machine',    'machines', NULL),
  ('pec_deck',               'Pec Deck / Fly Machine', 'machines', NULL),
  ('shoulder_press_machine', 'Shoulder Press Machine', 'machines', NULL),
  ('lat_pulldown',           'Lat Pulldown',           'machines', NULL),
  ('seated_row',             'Seated Row',             'machines', NULL),
  ('cable_machine',          'Cable Machine',          'machines', NULL),
  ('assisted_dip',           'Assisted Dip Machine',   'machines', NULL),
  ('preacher_curl',          'Preacher Curl Bench',    'machines', NULL),
  ('calf_raise',             'Calf Raise Machine',     'machines', NULL),
  ('hip_abductor',           'Hip Abductor/Adductor',  'machines', NULL),
  ('glute_kickback',         'Glute Kickback',         'machines', NULL),
  ('reverse_hyper',          'Reverse Hyper',          'machines', NULL),
  -- Free weights
  ('barbell',                'Barbell + Plates',       'free_weights', NULL),
  ('dumbbells',              'Dumbbells',              'free_weights', NULL),
  ('kettlebells',            'Kettlebells',            'free_weights', NULL),
  ('ez_bar',                 'EZ Curl Bar',            'free_weights', NULL),
  ('trap_bar',               'Trap Bar',               'free_weights', NULL),
  -- Benches
  ('flat_bench',             'Flat Bench',             'benches', NULL),
  ('incline_bench',          'Incline Bench',          'benches', NULL),
  ('decline_bench',          'Decline Bench',          'benches', NULL),
  -- Racks & stations
  ('squat_rack',             'Squat / Power Rack',     'racks', NULL),
  ('dip_station',            'Dip Station',            'stations', NULL),
  ('pull_up_bar',            'Pull-up Bar',            'stations', NULL),
  -- Other
  ('resistance_bands',       'Resistance Bands',       'other', NULL),
  ('trx',                    'TRX / Suspension',       'other', NULL),
  ('ab_wheel',               'Ab Wheel',               'other', NULL),
  ('medicine_ball',          'Medicine Ball',          'other', NULL),
  ('battle_ropes',           'Battle Ropes',           'other', NULL),
  ('landmine',               'Landmine',               'other', NULL)
ON CONFLICT (id) DO NOTHING;

COMMENT ON COLUMN gym_locations.icon IS
  'Emoji shown on the pre-workout location chip row';
COMMENT ON COLUMN gym_locations.preset_kind IS
  'Preset that seeded this location: gym | home | travel | custom';
COMMENT ON COLUMN gym_locations.last_used_at IS
  'Set when a workout is started at this location; powers last-used default';
COMMENT ON COLUMN gym_locations.dumbbell_max_kg IS
  'Heaviest dumbbell available here; caps dumbbell weight suggestions';
