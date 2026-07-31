-- Motion capture: replace the two-static-hold calibration with the
-- sweep-based method (schema_version 2).
--
-- Why: deriving a pivot axis from two static gravity vectors is ill-posed —
-- the set of rotations mapping g_start to g_end is a one-parameter family,
-- so the axis component parallel to gravity is unrecoverable. Field test:
-- 72.0° of real rotation integrated to 47.4° along the mis-derived axis.
-- The axis now comes from the principal eigenvector of the sweep's gyro
-- scatter matrix; gravity serves as a per-stroke integrity CHECK only.

-- Planarity metric of the calibration sweep: λ1/(λ2+λ3) of the gyro
-- scatter eigenvalues. Sweeps below the client-side quality gate are
-- rejected before insert, so stored rows always carry a meaningful value.
ALTER TABLE machine_calibrations
  ADD COLUMN IF NOT EXISTS axis_quality NUMERIC(8,1);

COMMENT ON COLUMN machine_calibrations.axis_quality IS
  'Sweep planarity: λ1/(λ2+λ3) of the calibration gyro scatter matrix. Higher = more single-axis. v2 (sweep) calibrations only.';

COMMENT ON COLUMN machine_calibrations.gravity_ref_start IS
  'v2: mean gravity UNIT vector at the BOTTOM ROM endpoint, from sweep rest windows.';
COMMENT ON COLUMN machine_calibrations.gravity_ref_end IS
  'v2: mean gravity UNIT vector at the TOP ROM endpoint, from sweep rest windows.';

-- Discard ALL existing motion data: every v1 calibration was produced by
-- the ill-posed derivation, so its axis — and every capture measured along
-- it — is invalid. The feature is experimental and flagged off by default;
-- there is nothing worth migrating. Order matters (raw buffers → captures
-- → calibrations) because motion_captures.calibration_id is ON DELETE
-- RESTRICT.
DELETE FROM motion_capture_raw_buffers;
DELETE FROM motion_captures;
DELETE FROM machine_calibrations;

-- New rows are sweep-derived.
ALTER TABLE machine_calibrations
  ALTER COLUMN schema_version SET DEFAULT 2;

COMMENT ON TABLE machine_calibrations IS
  'Sweep-based machine calibrations (schema_version 2): pivot axis from the gyro scatter matrix of a 3-rep unloaded sweep; gravity endpoint refs used as integrity checks only. v1 (two-static-hold) rows were deleted — the derivation was mathematically ill-posed.';
