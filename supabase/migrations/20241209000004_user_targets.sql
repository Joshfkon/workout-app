-- Add user-defined body composition targets
ALTER TABLE users ADD COLUMN IF NOT EXISTS target_body_fat_percent DECIMAL(4,1);
ALTER TABLE users ADD COLUMN IF NOT EXISTS target_weight_kg DECIMAL(5,1);

