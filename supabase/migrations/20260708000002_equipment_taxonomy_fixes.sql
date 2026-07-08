-- ============================================
-- EQUIPMENT TAXONOMY FIXES (fail-closed filter support)
-- ============================================
-- The equipment filter is now FAIL-CLOSED: an exercise passes only when its
-- equipment requirements are known and satisfiable at the training location.
-- This migration makes the library's metadata honest so legitimate exercises
-- aren't excluded and impossible ones stop leaking through:
--
--   1. Nordic Curl was tagged '{bodyweight}' but is NOT performable with
--      nothing — it needs the feet anchored (rack / loaded barbell / lat
--      pulldown or leg curl pads). Tag it with the derived 'nordic anchor'
--      requirement the filter resolves against those anchor sources.
--   2. Plate-loaded movements implicitly require weight plates, which the
--      inventory model bundles with bars ("Barbell + Plates"). Tag them so
--      locations without bars exclude them.
--   3. Catch-all backfill: any exercise with an empty equipment_required
--      array inherits its scalar `equipment` column as a tag, and scalar
--      'bodyweight' rows get is_bodyweight = true. After this pass every
--      exercise has >= 1 equipment tag or is explicitly bodyweight — the
--      fail-closed filter excludes (and logs) anything that still doesn't.
--   4. Adds 'Single Leg Calf Raise' (bodyweight, optional dumbbell): the
--      library had NO calf exercise performable without machines, so
--      dumbbell-only locations could get zero calf volume.

-- ============================================
-- 1. NORDIC CURL — requires a foot anchor
-- ============================================

UPDATE exercises
SET equipment_required = ARRAY['nordic anchor']
WHERE name = 'Nordic Curl';

-- ============================================
-- 2. PLATE-LOADED MOVEMENTS — require weight plates
-- ============================================

UPDATE exercises
SET equipment_required = array_append(COALESCE(equipment_required, '{}'), 'weight plates')
WHERE (name ILIKE '%plate loaded%' OR name ILIKE '%plate-loaded%')
  AND NOT ('weight plates' = ANY(COALESCE(equipment_required, '{}')));

-- ============================================
-- 3. CATCH-ALL BACKFILL — no exercise without equipment metadata
-- ============================================

-- Scalar 'bodyweight' equipment → explicit bodyweight flag.
UPDATE exercises
SET is_bodyweight = true
WHERE (equipment_required IS NULL OR equipment_required = '{}')
  AND LOWER(COALESCE(equipment, '')) = 'bodyweight'
  AND is_bodyweight IS DISTINCT FROM true;

-- Any other scalar equipment value becomes the tag array.
UPDATE exercises
SET equipment_required = ARRAY[equipment]
WHERE (equipment_required IS NULL OR equipment_required = '{}')
  AND equipment IS NOT NULL
  AND equipment <> ''
  AND LOWER(equipment) <> 'bodyweight';

-- Remaining untagged, non-bodyweight rows (e.g. hand-created customs) are
-- excluded by the fail-closed filter and surface in its debug log. Audit:
--   SELECT name FROM exercises
--   WHERE (equipment_required IS NULL OR equipment_required = '{}')
--     AND is_bodyweight IS DISTINCT FROM true;

-- ============================================
-- 4. SINGLE LEG CALF RAISE — machine-free calf work
-- ============================================

INSERT INTO exercises (
  name, primary_muscle, secondary_muscles, mechanic,
  default_rep_range, default_rir, min_weight_increment_kg,
  form_cues, common_mistakes, setup_note,
  movement_pattern, equipment_required,
  is_bodyweight
) VALUES (
  'Single Leg Calf Raise', 'calves', ARRAY[]::TEXT[], 'isolation',
  ARRAY[10, 20], 2, 0,
  ARRAY['Ball of foot on a step or plate edge', 'Full stretch at the bottom', 'Pause at the top', 'Hold a dumbbell for extra load'],
  ARRAY['Bouncing out of the stretch', 'Partial range of motion', 'Rolling the ankle outward'],
  'Stand on one foot on a step edge, heel free to travel; hold support for balance',
  'plantar_flexion', ARRAY[]::TEXT[],
  true
)
ON CONFLICT (name) DO NOTHING;
