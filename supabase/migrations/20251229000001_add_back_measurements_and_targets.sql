-- Add back/lats measurements to body_measurements table
ALTER TABLE body_measurements
ADD COLUMN IF NOT EXISTS upper_back DECIMAL(5,1),
ADD COLUMN IF NOT EXISTS lower_back DECIMAL(5,1);

-- Comment explaining measurements
COMMENT ON COLUMN body_measurements.upper_back IS 'Upper back/lats circumference at widest point under armpits, in cm';
COMMENT ON COLUMN body_measurements.lower_back IS 'Lower back circumference at narrowest point above hips, in cm';

-- ============================================================
-- BODY COMPOSITION TARGETS
-- Allows users to set goal measurements, weight, body fat, FFMI
-- Can be linked to mesocycles for goal-oriented training
-- ============================================================

CREATE TABLE IF NOT EXISTS body_composition_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Basic targets
  target_weight_kg DECIMAL(5,2),
  target_body_fat_percent DECIMAL(4,1),
  target_ffmi DECIMAL(4,2),

  -- Measurement targets (in cm)
  target_neck DECIMAL(5,1),
  target_shoulders DECIMAL(5,1),
  target_chest DECIMAL(5,1),
  target_upper_back DECIMAL(5,1),
  target_lower_back DECIMAL(5,1),
  target_left_bicep DECIMAL(5,1),
  target_right_bicep DECIMAL(5,1),
  target_left_forearm DECIMAL(5,1),
  target_right_forearm DECIMAL(5,1),
  target_waist DECIMAL(5,1),
  target_hips DECIMAL(5,1),
  target_left_thigh DECIMAL(5,1),
  target_right_thigh DECIMAL(5,1),
  target_left_calf DECIMAL(5,1),
  target_right_calf DECIMAL(5,1),

  -- Optional link to mesocycle (achieve these goals by end of mesocycle)
  mesocycle_id UUID REFERENCES mesocycles(id) ON DELETE SET NULL,

  -- Target timeline
  target_date DATE,

  -- Metadata
  name TEXT, -- Optional name like "Summer Cut" or "Bulk Phase 1"
  notes TEXT,
  is_active BOOLEAN DEFAULT true, -- Only one active target at a time

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only one active target per user
CREATE UNIQUE INDEX idx_body_composition_targets_active
ON body_composition_targets(user_id)
WHERE is_active = true;

-- Index for mesocycle lookups
CREATE INDEX idx_body_composition_targets_mesocycle
ON body_composition_targets(mesocycle_id)
WHERE mesocycle_id IS NOT NULL;

-- Enable RLS
ALTER TABLE body_composition_targets ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own targets"
  ON body_composition_targets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own targets"
  ON body_composition_targets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own targets"
  ON body_composition_targets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own targets"
  ON body_composition_targets FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_body_composition_targets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_body_composition_targets_updated_at
  BEFORE UPDATE ON body_composition_targets
  FOR EACH ROW
  EXECUTE FUNCTION update_body_composition_targets_updated_at();

-- Function to deactivate other targets when setting a new active one
CREATE OR REPLACE FUNCTION deactivate_other_targets()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE body_composition_targets
    SET is_active = false
    WHERE user_id = NEW.user_id
      AND id != NEW.id
      AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_deactivate_other_targets
  BEFORE INSERT OR UPDATE ON body_composition_targets
  FOR EACH ROW
  WHEN (NEW.is_active = true)
  EXECUTE FUNCTION deactivate_other_targets();
