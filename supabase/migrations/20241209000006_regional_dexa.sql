-- Add regional body composition data to dexa_scans
-- This allows for:
-- 1. Identifying weak/lagging body parts
-- 2. Detecting left/right asymmetries
-- 3. Better weight recommendations based on regional muscle mass

ALTER TABLE dexa_scans 
ADD COLUMN IF NOT EXISTS regional_data JSONB DEFAULT NULL;

-- Structure of regional_data:
-- {
--   "left_arm": { "fat_g": 1200, "lean_g": 3500 },
--   "right_arm": { "fat_g": 1150, "lean_g": 3650 },
--   "left_leg": { "fat_g": 4200, "lean_g": 9800 },
--   "right_leg": { "fat_g": 4100, "lean_g": 10200 },
--   "trunk": { "fat_g": 8500, "lean_g": 28000 },
--   "android": { "fat_g": 2800 },
--   "gynoid": { "fat_g": 3200 }
-- }

COMMENT ON COLUMN dexa_scans.regional_data IS 'Regional body composition data from DEXA scan (arms, legs, trunk, android/gynoid)';

