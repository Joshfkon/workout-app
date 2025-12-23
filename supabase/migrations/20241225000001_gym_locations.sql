-- ============================================
-- GYM LOCATIONS SUPPORT
-- Allows users to save equipment preferences for multiple gym locations
-- ============================================

-- Create gym_locations table
CREATE TABLE IF NOT EXISTS gym_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create a partial unique index to ensure only one default location per user
-- This is better than a deferrable constraint for ON CONFLICT support
CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_locations_unique_default 
  ON gym_locations(user_id) 
  WHERE is_default = true;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_gym_locations_user_id ON gym_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_gym_locations_default ON gym_locations(user_id, is_default) WHERE is_default = true;

-- Enable RLS
ALTER TABLE gym_locations ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "Users can view own gym locations" ON gym_locations;
CREATE POLICY "Users can view own gym locations"
  ON gym_locations FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own gym locations" ON gym_locations;
CREATE POLICY "Users can insert own gym locations"
  ON gym_locations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own gym locations" ON gym_locations;
CREATE POLICY "Users can update own gym locations"
  ON gym_locations FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own gym locations" ON gym_locations;
CREATE POLICY "Users can delete own gym locations"
  ON gym_locations FOR DELETE
  USING (auth.uid() = user_id);

-- Add location_id to user_equipment table (nullable for backward compatibility)
-- First check if user_equipment table exists, if not create it
DO $$
BEGIN
  -- Check if user_equipment table exists
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_equipment') THEN
    -- Create user_equipment table if it doesn't exist
    CREATE TABLE user_equipment (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      equipment_id TEXT NOT NULL,
      is_available BOOLEAN NOT NULL DEFAULT true,
      location_id UUID REFERENCES gym_locations(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, equipment_id, location_id)
    );
    
    -- Create indexes
    CREATE INDEX idx_user_equipment_user_id ON user_equipment(user_id);
    CREATE INDEX idx_user_equipment_location_id ON user_equipment(location_id);
    CREATE INDEX idx_user_equipment_equipment_id ON user_equipment(equipment_id);
    
    -- Enable RLS
    ALTER TABLE user_equipment ENABLE ROW LEVEL SECURITY;
    
    -- RLS policies
    CREATE POLICY "Users can view own equipment"
      ON user_equipment FOR SELECT
      USING (auth.uid() = user_id);
    
    CREATE POLICY "Users can insert own equipment"
      ON user_equipment FOR INSERT
      WITH CHECK (auth.uid() = user_id);
    
    CREATE POLICY "Users can update own equipment"
      ON user_equipment FOR UPDATE
      USING (auth.uid() = user_id);
    
    CREATE POLICY "Users can delete own equipment"
      ON user_equipment FOR DELETE
      USING (auth.uid() = user_id);
  ELSE
    -- Table exists, just add location_id column if it doesn't exist
    IF NOT EXISTS (SELECT FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   AND table_name = 'user_equipment' 
                   AND column_name = 'location_id') THEN
      ALTER TABLE user_equipment ADD COLUMN location_id UUID REFERENCES gym_locations(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_user_equipment_location_id ON user_equipment(location_id);
      
      -- Update unique constraint to include location_id
      -- First drop the old constraint if it exists
      ALTER TABLE user_equipment DROP CONSTRAINT IF EXISTS user_equipment_user_id_equipment_id_key;
      ALTER TABLE user_equipment DROP CONSTRAINT IF EXISTS user_equipment_pkey;
      
      -- Add new unique constraint
      ALTER TABLE user_equipment ADD CONSTRAINT user_equipment_user_id_equipment_id_location_id_key 
        UNIQUE(user_id, equipment_id, location_id);
    END IF;
  END IF;
END $$;

-- Function to create default "Home Gym" location for existing users
CREATE OR REPLACE FUNCTION create_default_gym_location()
RETURNS void AS $$
DECLARE
  user_record RECORD;
BEGIN
  -- For each user without a default location, create one
  FOR user_record IN 
    SELECT DISTINCT u.id 
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM gym_locations gl 
      WHERE gl.user_id = u.id AND gl.is_default = true
    )
  LOOP
    -- First, ensure no other default exists (safety check)
    UPDATE gym_locations 
    SET is_default = false 
    WHERE user_id = user_record.id AND is_default = true;
    
    -- Then insert the new default location
    -- The WHERE NOT EXISTS check above ensures we won't hit the unique index constraint
    BEGIN
      INSERT INTO gym_locations (user_id, name, is_default)
      VALUES (user_record.id, 'Home Gym', true);
    EXCEPTION WHEN unique_violation THEN
      -- If somehow a default already exists, just skip this user
      NULL;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Run the function to create default locations
SELECT create_default_gym_location();

-- Drop the function after use
DROP FUNCTION IF EXISTS create_default_gym_location();

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_gym_locations_updated_at ON gym_locations;
CREATE TRIGGER update_gym_locations_updated_at
  BEFORE UPDATE ON gym_locations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_equipment_updated_at ON user_equipment;
CREATE TRIGGER update_user_equipment_updated_at
  BEFORE UPDATE ON user_equipment
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

