-- ============================================
-- NORMALIZED EQUIPMENT CLASS (exercise-picker equipment filter axis)
-- ============================================
-- Adds exercises.equipment_class: the single normalized implement an exercise
-- IS, distinct from equipment_required (free-text REQUIREMENTS list) and the
-- stale scalar `equipment` column (defaults to 'barbell'). This is the axis the
-- add-exercise picker's equipment filter runs on.
--
-- Plate-loaded and pin/selectorized machines are SEPARATE classes on purpose:
-- load between them is not interchangeable, and collapsing them is a regression
-- the app already guards against (progressionScope.LOCAL_EQUIPMENT_IDS,
-- exerciseSwapper class comparison). The picker UI rolls both up under one
-- "Machine" chip; the data keeps them apart.
--
-- The backfill mirrors services/equipmentClass.ts#deriveEquipmentClass in
-- fixed precedence (that TS function is the canonical logic and the read-time
-- fallback for any row this leaves — customs, future inserts). Each step fills
-- only rows still NULL, so higher-precedence signals win and the pass is
-- idempotent. Hand corrections to equipment_class are preserved (steps are
-- WHERE equipment_class IS NULL).

-- --------------------------------------------
-- Column + constraint
-- --------------------------------------------

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS equipment_class TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exercises_equipment_class_check'
  ) THEN
    ALTER TABLE exercises ADD CONSTRAINT exercises_equipment_class_check
      CHECK (equipment_class IS NULL OR equipment_class IN (
        'barbell', 'dumbbell', 'kettlebell', 'cable',
        'machine_plate_loaded', 'machine_pin_loaded', 'smith',
        'bodyweight', 'band', 'other'
      ));
  END IF;
END $$;

COMMENT ON COLUMN exercises.equipment_class IS
  'Normalized equipment class for the picker equipment filter. Derived by '
  'services/equipmentClass.ts; plate-loaded vs pin-loaded machines kept '
  'distinct on purpose. Hand-correctable; the backfill never overwrites a '
  'non-null value.';

CREATE INDEX IF NOT EXISTS idx_exercises_equipment_class ON exercises(equipment_class);

-- --------------------------------------------
-- Backfill (precedence order; each step fills only remaining NULLs)
-- blob = padded lower(name + ' ' + equipment_required tags) for pseudo-word
-- matching. Short/ambiguous abbreviations ('db','kb') use spaced patterns.
-- --------------------------------------------

-- Reusable expression via a helper: recompute the blob per statement. Postgres
-- has no statement-local macro, so it is inlined in each WHERE.

-- 1. Bodyweight flag wins (a BW movement is BW even when loaded with a plate/DB).
UPDATE exercises SET equipment_class = 'bodyweight'
WHERE equipment_class IS NULL AND is_bodyweight IS TRUE;

-- 2. Smith machine (specific; before cable/machine).
UPDATE exercises SET equipment_class = 'smith'
WHERE equipment_class IS NULL
  AND (' ' || lower(coalesce(name,'') || ' ' || array_to_string(coalesce(equipment_required,'{}'),' ')) || ' ')
      ILIKE '%smith%';

-- 3. Cable / pulley (beats the generic 'machine' word in 'cable machine').
UPDATE exercises SET equipment_class = 'cable'
WHERE equipment_class IS NULL
  AND (' ' || lower(coalesce(name,'') || ' ' || array_to_string(coalesce(equipment_required,'{}'),' ')) || ' ')
      ILIKE ANY (ARRAY['%cable%','%pulley%','% pulldown%','%pull-down%','%rope pushdown%','%rope pull%']);

-- 4. Plate-loaded machines (explicit signals: iso-lateral / hammer strength /
--    lever / pendulum / hack squat / belt squat).
UPDATE exercises SET equipment_class = 'machine_plate_loaded'
WHERE equipment_class IS NULL
  AND (' ' || lower(coalesce(name,'') || ' ' || array_to_string(coalesce(equipment_required,'{}'),' ')) || ' ')
      ILIKE ANY (ARRAY['%plate loaded%','%plate-loaded%','%iso-lateral%','%iso lateral%',
                       '%hammer strength%','%lever%','%pendulum%','%hack squat%',
                       '%belt squat%','%v-squat%','%v squat%']);

-- 5. Barbell family (barbell, EZ/curl bar, trap/hex bar, landmine) — before the
--    generic-machine default so free-weight rows never read as a machine.
UPDATE exercises SET equipment_class = 'barbell'
WHERE equipment_class IS NULL
  AND (' ' || lower(coalesce(name,'') || ' ' || array_to_string(coalesce(equipment_required,'{}'),' ')) || ' ')
      ILIKE ANY (ARRAY['%barbell%','%ez bar%','%ez curl%','%curl bar%','%trap bar%','%hex bar%','%landmine%']);

-- 6. Dumbbell.
UPDATE exercises SET equipment_class = 'dumbbell'
WHERE equipment_class IS NULL
  AND (' ' || lower(coalesce(name,'') || ' ' || array_to_string(coalesce(equipment_required,'{}'),' ')) || ' ')
      ILIKE ANY (ARRAY['%dumbbell%','% db %']);

-- 7. Kettlebell.
UPDATE exercises SET equipment_class = 'kettlebell'
WHERE equipment_class IS NULL
  AND (' ' || lower(coalesce(name,'') || ' ' || array_to_string(coalesce(equipment_required,'{}'),' ')) || ' ')
      ILIKE ANY (ARRAY['%kettlebell%','% kb %']);

-- 8. Pin / selectorized machines + generic 'machine' default.
UPDATE exercises SET equipment_class = 'machine_pin_loaded'
WHERE equipment_class IS NULL
  AND (' ' || lower(coalesce(name,'') || ' ' || array_to_string(coalesce(equipment_required,'{}'),' ')) || ' ')
      ILIKE ANY (ARRAY['%selectorized%','%machine%','%pec deck%','%pec-deck%','%fly machine%',
                       '%leg press%','%leg extension%','%leg curl%','%seated row%',
                       '%preacher curl machine%','%assisted%','%hip abduct%','%hip adduct%',
                       '%glute kickback%','%reverse hyper%','%calf raise machine%','%calf machine%',
                       '%mts%','%nautilus%','%cybex%','%technogym%','%matrix%','%precor%',
                       '%life fitness%','%katana%']);

-- 9. Bands.
UPDATE exercises SET equipment_class = 'band'
WHERE equipment_class IS NULL
  AND (' ' || lower(coalesce(name,'') || ' ' || array_to_string(coalesce(equipment_required,'{}'),' ')) || ' ')
      ILIKE ANY (ARRAY['%band%','%resistance band%']);

-- 10. Other named implements (TRX, ab wheel, medicine ball, battle ropes).
UPDATE exercises SET equipment_class = 'other'
WHERE equipment_class IS NULL
  AND (' ' || lower(coalesce(name,'') || ' ' || array_to_string(coalesce(equipment_required,'{}'),' ')) || ' ')
      ILIKE ANY (ARRAY['%trx%','%suspension%','%ab wheel%','%rollout%','%medicine ball%','%med ball%','%battle rope%']);

-- 10.5 Bodyweight stations / movements (after machines so assisted variants
--      stay machine): plain dips / pull-ups / chin-ups tagged only 'dip bars'
--      or 'pull-up bar', often with is_bodyweight unset.
UPDATE exercises SET equipment_class = 'bodyweight'
WHERE equipment_class IS NULL
  AND (' ' || lower(coalesce(name,'') || ' ' || array_to_string(coalesce(equipment_required,'{}'),' ')) || ' ')
      ILIKE ANY (ARRAY['%dip bars%','%dip station%','%parallel bars%','%pull-up bar%','%pull up bar%',
                       '%pullup bar%','%chin-up bar%','%pull-up%','%pullup%','%pull up%',
                       '%chin-up%','%chinup%','%chin up%','%dips%']);

-- 11. Name explicitly declares no equipment.
UPDATE exercises SET equipment_class = 'bodyweight'
WHERE equipment_class IS NULL
  AND (' ' || lower(coalesce(name,'')) || ' ') ILIKE ANY (ARRAY['%bodyweight%','%body weight%']);

-- 12. Everything still unresolved → 'other' (closed set; nothing stays NULL).
UPDATE exercises SET equipment_class = 'other'
WHERE equipment_class IS NULL;

-- --------------------------------------------
-- REVIEW PASS — ambiguous machine plate/pin split
-- --------------------------------------------
-- These rows were classed machine_pin_loaded only because the sole machine
-- signal was a bare 'machine' tag or 'leg press' (both plate-loaded AND
-- selectorized versions exist). Audit and hand-correct equipment_class where
-- the real implement is plate-loaded. Mirrors
-- services/equipmentClass.ts#isMachineClassAmbiguous.
--
--   SELECT id, name, equipment_required, equipment_class
--   FROM exercises
--   WHERE equipment_class = 'machine_pin_loaded'
--     AND (' ' || lower(coalesce(name,'') || ' ' || array_to_string(coalesce(equipment_required,'{}'),' ')) || ' ')
--         ILIKE ANY (ARRAY['%machine%','%leg press%'])
--     AND (' ' || lower(coalesce(name,'') || ' ' || array_to_string(coalesce(equipment_required,'{}'),' ')) || ' ')
--         NOT ILIKE ANY (ARRAY['%pec deck%','%pec-deck%','%fly machine%','%leg extension%','%leg curl%',
--                              '%seated row%','%preacher curl machine%','%assisted%','%hip abduct%',
--                              '%hip adduct%','%glute kickback%','%reverse hyper%','%calf raise machine%',
--                              '%calf machine%','%mts%','%nautilus%','%cybex%','%technogym%','%matrix%',
--                              '%precor%','%life fitness%','%katana%','%selectorized%',
--                              '%plate loaded%','%plate-loaded%','%iso-lateral%','%iso lateral%',
--                              '%hammer strength%','%lever%','%pendulum%','%hack squat%','%belt squat%'])
--   ORDER BY name;
