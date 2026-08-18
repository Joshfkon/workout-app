-- AI body fat estimate columns for progress photos.
-- Stored as a RANGE (low/high) because a photo-based estimate is inherently
-- imprecise; the user-entered body_fat_percent column stays authoritative.
-- Display/trend only — must never feed prescription, e1RM, or volume engines.

ALTER TABLE progress_photos
  ADD COLUMN IF NOT EXISTS bf_estimate_low DECIMAL(4,1),
  ADD COLUMN IF NOT EXISTS bf_estimate_high DECIMAL(4,1),
  ADD COLUMN IF NOT EXISTS bf_estimated_at TIMESTAMPTZ;
