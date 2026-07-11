-- ============================================================
-- RESET LEARNED VOLUME TABLE FOR THE SECONDARY-CREDIT COUNTER
-- ============================================================
-- The per-user learned MEV/MRV table (user_volume_profiles.muscle_tolerance)
-- was calibrated against PRIMARY-ONLY weekly set counts. Every volume surface
-- now shares one counter that also credits 0.5x secondary muscle involvement,
-- which inflates counts per muscle by a muscle-dependent ratio (~1.2x quads to
-- ~3x traps). Left as-is, a muscle sitting at "learned MRV 20 (primary)" would
-- read 24-40 credited and read as over-MRV / red when it is actually fine.
--
-- Policy (chosen: reset to research defaults + relearn — see PR): drop the
-- stale learned thresholds so the app rebuilds research baselines (respecting
-- each user's training age + enhanced flag) on next load and relearns under the
-- new counter. A `counter_version` column gates the one-time app-side rebuild
-- (0 = pre-switch/needs reset; the app writes the current version after
-- rebuilding), so this is idempotent and never wipes freshly-relearned data.

ALTER TABLE user_volume_profiles
  ADD COLUMN IF NOT EXISTS counter_version INTEGER NOT NULL DEFAULT 0;

-- Clear the stale muscle_tolerance so the app-side rebuild (createInitial
-- VolumeProfile) repopulates research baselines with the correct per-user
-- training age / enhanced scaling. Only rows still at version 0 (never reset)
-- are touched; global_recovery_multiplier / is_enhanced / training_age are
-- preserved so the rebuild keeps the user's context.
UPDATE user_volume_profiles
SET muscle_tolerance = '{}'::jsonb,
    updated_at = NOW()
WHERE counter_version = 0;
