-- Assisted machines are bodyweight exercises (assistance dimension), not
-- externally loaded ones.
--
-- Defect: 'Assisted Pull-Up Machine' / 'Assisted Dip Machine' / 'Assisted
-- Pull-Up' were classified as plain machine exercises, so the stack weight was
-- treated as the LOAD. On these machines the stack is ASSISTANCE — a higher
-- number is EASIER — which inverted every load-direction feature: the warmup
-- ramp prescribed the hardest (least-assisted) sets first, cross-exercise
-- weight estimation prescribed the stack as if it were a pulldown load, and
-- "progression" pointed toward raising the stack (i.e. regressing).
--
-- Fix: reclassify all three as bodyweight exercises with machine assistance
-- (bodyweight_type 'assisted_possible'), the same model Nordic Curl and the
-- assisted modes of Pull-Up/Dip already use. Effective load = bodyweight −
-- assistance; the warmup engine's 'assisted' mode then correctly prescribes
-- MORE assistance on earlier ramp sets.

-- ============================================
-- 1. RECLASSIFY THE EXERCISES
-- ============================================

UPDATE exercises
SET is_bodyweight = true,
    bodyweight_type = 'assisted_possible',
    assistance_type = 'machine'
WHERE name IN ('Assisted Pull-Up', 'Assisted Pull-Up Machine', 'Assisted Dip Machine');

-- ============================================
-- 2. BACKFILL EXISTING SET LOGS
-- ============================================
-- Sets logged while these were "external" exercises recorded the STACK weight
-- in weight_kg and no bodyweight_data. The app's convention for bodyweight
-- exercises is that weight_kg stores the TOTAL effective load (bodyweight −
-- assistance) with the composition in bodyweight_data (see SetLoggerRow /
-- exerciseDetailAnalytics). Convert each legacy row using the lifter's
-- bodyweight nearest to (at or before) the set's date, falling back to the
-- profile weight, then to their earliest recorded bodyweight. Rows for users
-- with no bodyweight on record anywhere are left untouched — we cannot invent
-- a decomposition.
--
-- Idempotent: converted rows carry bodyweight_data and are excluded on re-run.

WITH target_exercises AS (
  SELECT id FROM exercises
  WHERE name IN ('Assisted Pull-Up', 'Assisted Pull-Up Machine', 'Assisted Dip Machine')
),
candidate_sets AS (
  SELECT sl.id AS set_id,
         sl.weight_kg AS stack_kg,
         sl.logged_at,
         ws.user_id
  FROM set_logs sl
  JOIN exercise_blocks eb ON eb.id = sl.exercise_block_id
  JOIN workout_sessions ws ON ws.id = eb.workout_session_id
  WHERE eb.exercise_id IN (SELECT id FROM target_exercises)
    AND sl.bodyweight_data IS NULL
),
resolved AS (
  SELECT cs.set_id,
         cs.stack_kg,
         COALESCE(bw_before.weight_kg, u.weight_kg, bw_any.weight_kg) AS bw_kg
  FROM candidate_sets cs
  JOIN users u ON u.id = cs.user_id
  LEFT JOIN LATERAL (
    SELECT weight_kg FROM bodyweight_entries
    WHERE user_id = cs.user_id AND date <= cs.logged_at::date
    ORDER BY date DESC LIMIT 1
  ) bw_before ON true
  LEFT JOIN LATERAL (
    SELECT weight_kg FROM bodyweight_entries
    WHERE user_id = cs.user_id
    ORDER BY date ASC LIMIT 1
  ) bw_any ON true
)
UPDATE set_logs sl
SET weight_kg = GREATEST(0, r.bw_kg - r.stack_kg),
    bodyweight_data = jsonb_build_object(
      'userBodyweightKg', r.bw_kg,
      'modification', CASE WHEN r.stack_kg > 0 THEN 'assisted' ELSE 'none' END,
      'assistanceWeightKg', CASE WHEN r.stack_kg > 0 THEN r.stack_kg ELSE NULL END,
      'assistanceType', CASE WHEN r.stack_kg > 0 THEN 'machine' ELSE NULL END,
      'effectiveLoadKg', GREATEST(0, r.bw_kg - r.stack_kg),
      -- Assistance at or above bodyweight means the recorded stack (or the
      -- resolved bodyweight) is suspect — surface it for review instead of
      -- silently storing a 0 kg effective load.
      '_needsReview', (r.stack_kg >= r.bw_kg)
    )
FROM resolved r
WHERE sl.id = r.set_id
  AND r.bw_kg IS NOT NULL;

-- ============================================
-- 3. DROP STALE PERFORMANCE SNAPSHOTS
-- ============================================
-- Snapshots for these exercises hold top_set_weight_kg / estimated_e1rm
-- computed from the stack weight — a load in the wrong dimension entirely
-- (e.g. a "30 kg e1RM" for a lifter whose true effective load was 60 kg).
-- The e1RM formula lives in services/shared/e1rm.ts and is not reimplemented
-- here; snapshots are derived data regenerated on every completed session, so
-- the wrong-dimension history is dropped rather than corrupting plateau
-- detection and progression-pace insights.

DELETE FROM exercise_performance_snapshots
WHERE exercise_id IN (
  SELECT id FROM exercises
  WHERE name IN ('Assisted Pull-Up', 'Assisted Pull-Up Machine', 'Assisted Dip Machine')
);

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN exercises.bodyweight_type IS 'Type of bodyweight exercise: pure (no modifications), weighted_possible, assisted_possible, or both. Assisted stack machines (assisted pull-up/dip) are assisted_possible: their stack is assistance, so effective load = bodyweight - stack.';
