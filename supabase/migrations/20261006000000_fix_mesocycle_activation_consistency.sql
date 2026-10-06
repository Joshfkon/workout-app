-- Fix mesocycle activation inconsistency
--
-- Problem: Users could have multiple "current" mesocycles with inconsistent
-- is_active/state flags:
--   - An older mesocycle with state='active' but is_active=false
--   - A newer mesocycle with is_active=true but state='planned'/'paused'
--
-- This happened because createMesocycle only deactivated rows with state='active',
-- missing rows with is_active=true but a different state.
--
-- Solution: For each user with multiple current mesocycles (is_active=true OR
-- state='active'), keep only the newest (by created_at) and deactivate the rest.
--
-- This migration is IDEMPOTENT: running it multiple times produces the same result.

-- Step 1: Identify users with multiple current mesocycles
WITH current_mesos AS (
  SELECT 
    id,
    user_id,
    created_at,
    is_active,
    state,
    ROW_NUMBER() OVER (
      PARTITION BY user_id 
      ORDER BY created_at DESC
    ) AS recency_rank
  FROM mesocycles
  WHERE is_active = true OR state = 'active'
),
-- Step 2: Mark which ones to keep (rank 1 = newest) and which to deactivate
to_deactivate AS (
  SELECT id
  FROM current_mesos
  WHERE recency_rank > 1
)
-- Step 3: Deactivate all but the newest
UPDATE mesocycles
SET 
  state = 'completed',
  is_active = false
WHERE id IN (SELECT id FROM to_deactivate);

-- Step 4: Ensure the kept mesocycle has both flags set correctly
-- (If it had is_active=true but state!='active', fix it)
UPDATE mesocycles
SET state = 'active'
WHERE is_active = true
  AND state != 'active'
  AND id IN (
    -- Only the newest per user
    SELECT DISTINCT ON (user_id) id
    FROM mesocycles
    WHERE is_active = true OR state = 'active'
    ORDER BY user_id, created_at DESC
  );
