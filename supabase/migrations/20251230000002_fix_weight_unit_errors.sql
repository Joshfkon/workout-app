-- ============================================
-- FIX WEIGHT UNIT ERRORS IN WEIGHT_LOG
-- Identifies and corrects mislabeled weight units
-- ============================================

-- This script fixes common unit errors:
-- 1. Weights 30-80 lbs labeled as 'lb' that are actually in kg (convert to lbs)
-- 2. Weights > 500 lbs labeled as 'lb' that are actually in kg (convert to lbs)
-- 3. Weights 30-150 kg labeled as 'kg' that are actually in lbs (change unit to 'lb')

-- First, let's see what we're working with (for review before running)
-- Uncomment to preview affected records:
/*
SELECT 
  id,
  logged_at,
  weight,
  unit,
  CASE 
    WHEN unit = 'lb' AND weight BETWEEN 30 AND 80 THEN 
      'Likely kg mislabeled as lb - will convert to ' || ROUND(weight * 2.20462, 1) || ' lbs'
    WHEN unit = 'lb' AND weight > 500 THEN 
      'Likely kg mislabeled as lb - will convert to ' || ROUND(weight * 2.20462, 1) || ' lbs'
    WHEN unit = 'kg' AND weight BETWEEN 30 AND 150 THEN 
      'Likely lbs mislabeled as kg - will change unit to lb, keep weight ' || weight
    ELSE 'No change needed'
  END as action
FROM weight_log
WHERE 
  (unit = 'lb' AND weight BETWEEN 30 AND 80)
  OR (unit = 'lb' AND weight > 500)
  OR (unit = 'kg' AND weight BETWEEN 30 AND 150)
ORDER BY logged_at DESC;
*/

-- Fix weights 30-80 lbs labeled as 'lb' (actually in kg) - convert to lbs
UPDATE weight_log
SET 
  weight = ROUND(weight * 2.20462, 1),
  unit = 'lb'
WHERE 
  unit = 'lb' 
  AND weight BETWEEN 30 AND 80
  AND weight > 0;

-- Fix weights > 500 lbs labeled as 'lb' (actually in kg) - convert to lbs
UPDATE weight_log
SET 
  weight = ROUND(weight * 2.20462, 1),
  unit = 'lb'
WHERE 
  unit = 'lb' 
  AND weight > 500
  AND weight > 0;

-- Fix weights 30-150 kg labeled as 'kg' (actually in lbs) - change unit to lb, keep weight
UPDATE weight_log
SET 
  unit = 'lb'
WHERE 
  unit = 'kg' 
  AND weight BETWEEN 30 AND 150
  AND weight > 0;

-- Log the changes
DO $$
DECLARE
  v_fixed_low_lbs INTEGER;
  v_fixed_high_lbs INTEGER;
  v_fixed_kg_to_lbs INTEGER;
BEGIN
  -- Count how many were fixed (this is approximate since we already updated)
  -- In practice, you'd want to run the SELECT query above first to see what will change
  
  RAISE NOTICE 'Weight unit corrections completed.';
  RAISE NOTICE 'Please review the weight_log table to verify corrections.';
END $$;

