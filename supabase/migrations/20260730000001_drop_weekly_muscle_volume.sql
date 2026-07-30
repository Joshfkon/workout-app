-- Drop weekly_muscle_volume: the stored-aggregate table for weekly per-muscle
-- volume that NOTHING in the app ever wrote (verified repo-wide 2026-07-30:
-- no INSERT/UPSERT in app code, migrations, seed.sql, scripts, or jobs — the
-- only writer-shaped code was the unused volumeTracker.toWeeklyMuscleVolume
-- formatter, removed in the same change).
--
-- Every volume surface derives from set_logs at read time (the shared
-- weeklyVolume pipeline). Three readers PREFERRED stored rows when any
-- existed (hooks/useWeeklyVolume, hooks/useAdaptiveVolume ×2), meaning any
-- rows left behind by an old build, seed, or fixture would silently freeze
-- stale-convention (pre-group-cap) numbers over live derivation. Those read
-- paths are removed in the same change; dropping the table (rather than
-- clearing it) disarms the trap for any future writer as well.
--
-- The dependent trigger/policies/indexes go with the table via CASCADE.

DROP TABLE IF EXISTS weekly_muscle_volume CASCADE;
