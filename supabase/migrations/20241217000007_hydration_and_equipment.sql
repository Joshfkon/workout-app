-- Hydration tracking
CREATE TABLE IF NOT EXISTS hydration_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_at DATE NOT NULL DEFAULT CURRENT_DATE,
  amount_ml INTEGER NOT NULL, -- Always store in ml
  source VARCHAR(50) DEFAULT 'water', -- 'water', 'coffee', 'tea', 'other'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick daily lookups
CREATE INDEX idx_hydration_log_user_date ON hydration_log(user_id, logged_at);

-- RLS for hydration log
ALTER TABLE hydration_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own hydration logs"
  ON hydration_log FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Hydration targets (optional)
ALTER TABLE nutrition_targets 
ADD COLUMN IF NOT EXISTS water_ml INTEGER DEFAULT 2500; -- Default 2.5L

-- =====================================================
-- GYM EQUIPMENT PREFERENCES
-- =====================================================

-- Equipment types that can be excluded
CREATE TABLE IF NOT EXISTS equipment_types (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50), -- 'machines', 'free_weights', 'cables', 'cardio', 'other'
  description TEXT
);

-- User's gym equipment availability
CREATE TABLE IF NOT EXISTS user_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  equipment_id VARCHAR(50) NOT NULL REFERENCES equipment_types(id),
  is_available BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, equipment_id)
);

-- RLS for user equipment
ALTER TABLE user_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own equipment preferences"
  ON user_equipment FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Anyone can read equipment types
ALTER TABLE equipment_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read equipment types"
  ON equipment_types FOR SELECT
  TO authenticated
  USING (true);

-- =====================================================
-- POPULATE EQUIPMENT TYPES
-- =====================================================

INSERT INTO equipment_types (id, name, category, description) VALUES
-- Machines
('leg_press', 'Leg Press Machine', 'machines', 'Seated leg press for quads, glutes, hamstrings'),
('leg_extension', 'Leg Extension Machine', 'machines', 'Isolates quadriceps'),
('leg_curl', 'Leg Curl Machine', 'machines', 'Seated or lying leg curl for hamstrings'),
('hack_squat', 'Hack Squat Machine', 'machines', 'Angled squat machine'),
('smith_machine', 'Smith Machine', 'machines', 'Guided barbell on rails'),
('chest_press', 'Chest Press Machine', 'machines', 'Seated machine chest press'),
('pec_deck', 'Pec Deck / Fly Machine', 'machines', 'Chest fly machine'),
('shoulder_press_machine', 'Shoulder Press Machine', 'machines', 'Seated overhead press machine'),
('lat_pulldown', 'Lat Pulldown Machine', 'machines', 'Cable lat pulldown station'),
('seated_row', 'Seated Row Machine', 'machines', 'Cable or plate-loaded row'),
('cable_machine', 'Cable Machine / Pulley', 'machines', 'Adjustable cable pulley system'),
('assisted_dip', 'Assisted Dip/Pull-up Machine', 'machines', 'Counterweight assistance machine'),
('preacher_curl', 'Preacher Curl Bench', 'machines', 'Angled bench for bicep curls'),
('calf_raise', 'Calf Raise Machine', 'machines', 'Standing or seated calf raise'),
('hip_abductor', 'Hip Abductor/Adductor Machine', 'machines', 'Inner/outer thigh machine'),
('glute_kickback', 'Glute Kickback Machine', 'machines', 'Cable or lever glute machine'),
('reverse_hyper', 'Reverse Hyperextension', 'machines', 'Lower back and glute machine'),

-- Free Weights
('barbell', 'Barbell', 'free_weights', 'Olympic or standard barbell'),
('dumbbells', 'Dumbbells', 'free_weights', 'Adjustable or fixed dumbbells'),
('kettlebells', 'Kettlebells', 'free_weights', 'Cast iron kettlebells'),
('ez_bar', 'EZ Curl Bar', 'free_weights', 'Angled barbell for curls'),
('trap_bar', 'Trap Bar / Hex Bar', 'free_weights', 'Hexagonal deadlift bar'),

-- Benches & Racks
('flat_bench', 'Flat Bench', 'benches', 'Flat weight bench'),
('incline_bench', 'Incline Bench', 'benches', 'Adjustable incline bench'),
('decline_bench', 'Decline Bench', 'benches', 'Decline bench for chest'),
('squat_rack', 'Squat Rack / Power Rack', 'racks', 'Squat cage with safety bars'),
('dip_station', 'Dip Station / Parallel Bars', 'stations', 'For dips and leg raises'),
('pull_up_bar', 'Pull-up Bar', 'stations', 'Overhead pull-up bar'),

-- Other
('resistance_bands', 'Resistance Bands', 'other', 'Elastic resistance bands'),
('trx', 'TRX / Suspension Trainer', 'other', 'Suspension training straps'),
('ab_wheel', 'Ab Wheel', 'other', 'Rollout wheel for core'),
('medicine_ball', 'Medicine Ball', 'other', 'Weighted ball for throws'),
('battle_ropes', 'Battle Ropes', 'other', 'Heavy ropes for cardio/conditioning'),
('landmine', 'Landmine Attachment', 'other', 'Barbell pivot attachment')

ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE hydration_log IS 'Daily water/fluid intake tracking';
COMMENT ON TABLE equipment_types IS 'Available gym equipment types';
COMMENT ON TABLE user_equipment IS 'User preferences for available gym equipment';

