-- Add cardio_prescription column to nutrition_targets table
-- This stores the Zone 2 cardio prescription when macro floors block desired cut rate

ALTER TABLE nutrition_targets 
ADD COLUMN IF NOT EXISTS cardio_prescription JSONB;

COMMENT ON COLUMN nutrition_targets.cardio_prescription IS 'Zone 2 cardio prescription data when macro floors block desired cut rate. Includes minutes/day, modality, and explanation.';

