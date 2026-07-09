-- ============================================
-- SET ROLES (working | ramp) FOR THE SUGGESTION ENGINE
-- ============================================
--
-- A set slot plays one of two roles:
--   working — a stimulative set the progression logic acts on.
--   ramp    — a feeder / back-off set, loaded light relative to the working
--             sets. It must NOT be graded against the working rep/RIR target
--             (the anchor bug: a 90-lb feeder read as "too light" vs a 160 top
--             set) and is excluded from junk-volume detection.
--
-- Role is inferred from load (a working set below RAMP_ROLE_MAX_FRACTION of the
-- session top set is a ramp set); a user tag overrides the inference. Each record
-- also stores the suggestion-engine version that produced it, for auditability.
--
-- Keep the threshold in sync with RAMP_ROLE_MAX_FRACTION in
-- services/suggestionEngine/constants.ts (0.75).

CREATE TYPE set_role AS ENUM ('working', 'ramp');

ALTER TABLE set_logs
  ADD COLUMN IF NOT EXISTS set_role set_role,
  ADD COLUMN IF NOT EXISTS suggestion_engine_version SMALLINT;

COMMENT ON COLUMN set_logs.set_role IS
  'Suggestion-engine set role: working (progression acts on it) or ramp (feeder/back-off; excluded from working-set progression and junk-volume detection). NULL for warmups and un-classified legacy rows. A user tag overrides load-based inference.';
COMMENT ON COLUMN set_logs.suggestion_engine_version IS
  'Version of the suggestion engine that produced/classified this record (services/suggestionEngine/constants.ts SUGGESTION_ENGINE_VERSION).';

-- ============================================
-- BACKFILL HISTORICAL ROLES
-- ============================================
-- Infer roles for existing NON-warmup working sets so progression logic has a
-- consistent history. The reference is each exercise_block's own top (heaviest)
-- non-warmup set. Warmups (is_warmup or set_type='warmup') are left NULL — they
-- are neither working nor ramp working sets.
--
-- Version-stamp the backfilled rows as v1 (pre-roles logic produced the loads);
-- the classification itself is applied by this migration, but marking them v1
-- distinguishes migrated history from records the v2 engine prescribed live.

WITH block_tops AS (
  SELECT
    exercise_block_id,
    MAX(weight_kg) AS top_weight_kg
  FROM set_logs
  WHERE is_warmup = FALSE
    AND COALESCE(set_type::text, 'normal') <> 'warmup'
  GROUP BY exercise_block_id
)
UPDATE set_logs sl
SET
  set_role = CASE
    WHEN bt.top_weight_kg IS NULL OR bt.top_weight_kg <= 0 THEN 'working'::set_role
    WHEN sl.weight_kg < bt.top_weight_kg * 0.75 THEN 'ramp'::set_role
    ELSE 'working'::set_role
  END,
  suggestion_engine_version = COALESCE(sl.suggestion_engine_version, 1)
FROM block_tops bt
WHERE sl.exercise_block_id = bt.exercise_block_id
  AND sl.is_warmup = FALSE
  AND COALESCE(sl.set_type::text, 'normal') <> 'warmup'
  AND sl.set_role IS NULL;

-- Index for role-aware queries (e.g. filtering ramp sets out of volume/junk math).
CREATE INDEX IF NOT EXISTS idx_set_logs_role ON set_logs(set_role);
