-- Add barcode column to custom_foods for barcode scanning support
ALTER TABLE custom_foods ADD COLUMN IF NOT EXISTS barcode TEXT;

-- Index for barcode lookups
CREATE INDEX IF NOT EXISTS idx_custom_foods_barcode ON custom_foods(user_id, barcode) WHERE barcode IS NOT NULL;

-- Add unique constraint per user per barcode (a user can only have one custom food per barcode)
-- Using a partial unique index since barcode can be null
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_foods_user_barcode_unique 
  ON custom_foods(user_id, barcode) 
  WHERE barcode IS NOT NULL;

