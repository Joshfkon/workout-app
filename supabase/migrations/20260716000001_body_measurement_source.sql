-- Provenance for body_measurements rows.
--
-- body_measurements stays ONE row per (user_id, logged_at) — there is no
-- parallel store and no schema fork. This column only records which surface
-- last wrote the row, so a fast "morning waist" path in the daily check-in and
-- the full Body-tab tape grid can share the exact same day-row while remaining
-- distinguishable for analytics/debugging.
--
-- Allowed values:
--   'body_grid'      the Body hub / measurements grid (the default, and what
--                    every pre-existing row is backfilled to).
--   'daily_checkin'  the fast morning-waist path in the daily check-in.
--   'import'         bulk import / migration paths.
--
-- Because both writers upsert on (user_id, logged_at), a check-in waist entry
-- and a later grid edit on the same day collapse into ONE row (the last write
-- wins on the columns it sets, and stamps its own source).

ALTER TABLE body_measurements
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'body_grid';

-- Constrain to known sources (guarded so re-running the migration is safe).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'body_measurements_source_check'
  ) THEN
    ALTER TABLE body_measurements
      ADD CONSTRAINT body_measurements_source_check
      CHECK (source IN ('body_grid', 'daily_checkin', 'import'));
  END IF;
END $$;

COMMENT ON COLUMN body_measurements.source IS
  'Which surface last wrote this row: body_grid | daily_checkin | import. Provenance only — the row is still one-per-(user_id, logged_at).';
