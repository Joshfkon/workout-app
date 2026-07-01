-- Persist the reactive deload recommendation produced by
-- ProgramEngine.checkDeloadTriggers so the dashboard can surface it and the
-- user can accept/dismiss it. Cleared (set NULL) when a deload week is applied
-- or the recommendation is dismissed.
ALTER TABLE mesocycles
  ADD COLUMN IF NOT EXISTS deload_recommended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deload_reasons JSONB;

COMMENT ON COLUMN mesocycles.deload_recommended_at IS
  'Set when checkDeloadTriggers fires after a session; NULL when none/dismissed/applied';
COMMENT ON COLUMN mesocycles.deload_reasons IS
  'Array of human-readable trigger reasons captured when the recommendation fired';
