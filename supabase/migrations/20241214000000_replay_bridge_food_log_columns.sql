-- Replay bridge: lets 20241215000000_nutrition_tables apply on an EMPTY database.
--
-- 20241213000001_nutrition_tracking already created food_log, so the
-- CREATE TABLE IF NOT EXISTS in 20241215000000 is skipped and its
-- `CREATE INDEX ... ON food_log(food_id)` fails, aborting `supabase db reset`.
-- Production took the same path (it kept the 20241213 tables; see
-- 20241217000001_fix_weight_log) and got these columns out-of-band, which is
-- what the app reads and writes. Adding them here, just before the migration
-- that expects them, reproduces that.
--
-- Back-dated on purpose: it has to run before 20241215000000. Every statement
-- is IF NOT EXISTS, so applying it to production (`supabase db push
-- --include-all`) is a no-op there.
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS fiber NUMERIC(6,1);
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS sugar NUMERIC(6,1);
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS sodium NUMERIC(8,1);
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS food_id TEXT;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS notes TEXT;
