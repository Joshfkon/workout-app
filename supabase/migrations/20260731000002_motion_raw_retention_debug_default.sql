-- Motion capture: raw sample retention ON by default while the feature is
-- experimental. Derived-metrics-only is the right posture for a shipped
-- feature and the wrong one for a feature under active debugging — a bad
-- calibration cannot be diagnosed from a rejection message alone. The
-- per-workout-session cap and the explicit settings toggle both remain;
-- this only flips the default.

ALTER TABLE users
  ALTER COLUMN motion_capture_raw_retention SET DEFAULT true;

-- Users already in the experiment keep debugging power without having to
-- find the sub-toggle. Users who haven't enabled the feature are untouched
-- (retention is meaningless without the feature flag; their column flips
-- to the new default only if/when a fresh row is created).
UPDATE users
SET motion_capture_raw_retention = true
WHERE motion_capture_enabled = true;

COMMENT ON COLUMN users.motion_capture_raw_retention IS
  'Retention of raw IMU sample buffers (motion_capture_raw_buffers). Default ON while motion capture is experimental (debug telemetry); user-toggleable. Capped per workout session, counted against the server.';
