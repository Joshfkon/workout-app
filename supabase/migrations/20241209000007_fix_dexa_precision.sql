-- Fix DEXA scan column precision to prevent numeric overflow
-- Increase precision for weight/mass columns

-- weight_kg: DECIMAL(5,2) -> DECIMAL(6,2) to allow up to 9999.99 kg
ALTER TABLE dexa_scans ALTER COLUMN weight_kg TYPE DECIMAL(6,2);

-- lean_mass_kg: DECIMAL(5,2) -> DECIMAL(6,2)
ALTER TABLE dexa_scans ALTER COLUMN lean_mass_kg TYPE DECIMAL(6,2);

-- fat_mass_kg: DECIMAL(5,2) -> DECIMAL(6,2)  
ALTER TABLE dexa_scans ALTER COLUMN fat_mass_kg TYPE DECIMAL(6,2);

-- bone_mass_kg: DECIMAL(4,2) -> DECIMAL(5,2) to allow up to 999.99 kg
ALTER TABLE dexa_scans ALTER COLUMN bone_mass_kg TYPE DECIMAL(5,2);

-- body_fat_percent stays at DECIMAL(4,1) as 999.9% is more than enough

