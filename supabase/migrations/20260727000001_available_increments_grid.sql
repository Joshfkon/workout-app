-- Phase D: loading grid — available increment SET per exercise.
--
-- The single min_weight_increment_kg column models one step, but real
-- equipment often has several: a 10 lb stack machine with 2.5 lb hand-loaded
-- add-ons can produce every multiple of 2.5 (182.5, 185, 187.5 …). With only
-- the stack step recorded, the engine rounded real prescriptions off the grid
-- the lifter actually loads (audited live: 187.5 prescribed, rendered 182.5 —
-- an intended increase shown as last session's load, twice in one session).
--
-- ADDITIVE change only:
--   * available_increments_kg numeric[] NULL — the set of loadable increments
--     (kg). The achievable-load grid is multiples of the smallest entry
--     (services/suggestionEngine/loadGrid.ts).
--   * NULL (all existing rows) → the engine falls back to
--     min_weight_increment_kg, so behavior is unchanged until a row records
--     its real increment set. min_weight_increment_kg is retained as the
--     legacy fallback and for consumers not yet migrated — NOT dropped.
--
-- No data is modified or deleted by this migration.

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS available_increments_kg numeric[] NULL;

COMMENT ON COLUMN exercises.available_increments_kg IS
  'Available loading increments (kg), e.g. {4.54, 1.13} for a 10 lb stack with 2.5 lb add-ons. Achievable-load grid = multiples of the smallest entry. NULL = fall back to min_weight_increment_kg.';

-- Guard rail: entries must be positive when the array is present.
ALTER TABLE exercises
  ADD CONSTRAINT available_increments_kg_positive
  CHECK (
    available_increments_kg IS NULL
    OR 0 < ALL (available_increments_kg)
  );
