-- Delete the problematic weight entry from December 20, 2025
-- This entry has a weight of ~389 lbs which is clearly an error

DELETE FROM weight_log
WHERE logged_at = '2025-12-20'
  AND weight > 300;  -- Only delete if weight is suspiciously high

-- Verify deletion (optional - comment out if not needed)
-- SELECT logged_at, weight, unit FROM weight_log WHERE logged_at = '2025-12-20';

