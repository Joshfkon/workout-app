-- Standalone (no-mesocycle) deload recommendation state.
--
-- Mirrors mesocycles.deload_recommended_at / deload_reasons for users training
-- WITHOUT an active mesocycle: their weekly fatigue signals accumulate in
-- weekly_fatigue_logs with mesocycle_id NULL (week_number is the epoch-week
-- index defined in lib/training/standaloneDeload.ts), and the post-session
-- deload check stamps its recommendation here on the user row instead of a
-- mesocycle row.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS standalone_deload_recommended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS standalone_deload_reasons JSONB,
  ADD COLUMN IF NOT EXISTS standalone_deload_week INTEGER;

COMMENT ON COLUMN users.standalone_deload_recommended_at IS
  'Set when the standalone (no-mesocycle) deload check fires after a session; NULL when none/dismissed/accepted';
COMMENT ON COLUMN users.standalone_deload_reasons IS
  'Array of human-readable trigger reasons captured when the standalone recommendation fired';
COMMENT ON COLUMN users.standalone_deload_week IS
  'Epoch-week index (weeks since Mon 2020-01-06, local time — see lib/training/standaloneDeload.ts) through which the user planned a light week; suppresses re-checks and resets the consecutive-training-week counter';
