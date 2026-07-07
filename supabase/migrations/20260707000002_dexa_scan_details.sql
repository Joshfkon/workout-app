-- Body data hub: DEXA scans are sparse, authoritative observations ("events").
-- Adds the descriptive fields the unified log sheet captures:
--   facility  free text — where the scan was done
--   machine   free text — scanner model (optional)
--   bone_density_g_cm2  bone mineral DENSITY (BMD); bone_mass_kg already
--                       stores bone mineral content (BMC)
--
-- VAT (visceral adipose tissue), when reported, is stored inside the existing
-- regional_data JSONB as: "vat": { "fat_g": <number> } — alongside the
-- android/gynoid entries documented in 20241209000006_regional_dexa.sql.

ALTER TABLE dexa_scans
  ADD COLUMN IF NOT EXISTS facility TEXT,
  ADD COLUMN IF NOT EXISTS machine TEXT,
  ADD COLUMN IF NOT EXISTS bone_density_g_cm2 DECIMAL(4,3);

COMMENT ON COLUMN dexa_scans.facility IS 'Where the scan was performed (free text)';
COMMENT ON COLUMN dexa_scans.machine IS 'Scanner make/model (free text, optional)';
COMMENT ON COLUMN dexa_scans.bone_density_g_cm2 IS 'Bone mineral density (BMD), g/cm2, optional';
