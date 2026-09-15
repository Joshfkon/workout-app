-- Motion capture (experimental): parallel telemetry stream for single-DOF
-- rotating-arm machines. Display-only in v1 — no read/write path touches
-- e1RM, prescription, or volume surfaces.
--
-- Entity direction is deliberate: motion_captures references set_logs;
-- set_logs knows nothing about motion capture. Every capture MUST reference
-- a machine_calibrations row (NOT NULL + ON DELETE RESTRICT) — the angle
-- math is meaningless without the pivot axis and mount radius, so captures
-- without a calibration are invalid and are never persisted.

-- Feature flags: per-user profile facts, following the
-- users.enhanced_athlete_mode precedent. Both default OFF.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS motion_capture_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS motion_capture_raw_retention BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.motion_capture_enabled IS
  'Experimental motion-capture feature flag. Off by default; gates all motion UI. Motion data is display-only and never feeds e1RM/prescription/volume.';

COMMENT ON COLUMN users.motion_capture_raw_retention IS
  'Opt-in retention of raw IMU sample buffers (motion_capture_raw_buffers). Off by default — only derived per-rep metrics are stored. Capped per workout session, counted against the server (motion_capture_raw_buffers.workout_session_id).';

-- One physical machine + seat + phone-mount position. Changing seat height
-- or mount position invalidates the calibration (new row required).
CREATE TABLE machine_calibrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,

  label TEXT NOT NULL,
  seat_setting TEXT NOT NULL DEFAULT '',
  -- Pivot axis to phone IMU, user-measured. Sanity-bounded: no rotating-arm
  -- machine mounts a phone 2 m from the pivot.
  mount_radius_mm NUMERIC(6,1) NOT NULL CHECK (mount_radius_mm > 0 AND mount_radius_mm < 2000),
  mount_orientation TEXT NOT NULL
    CHECK (mount_orientation IN ('top-edge', 'bottom-edge', 'left-edge', 'right-edge')),

  -- Gravity vectors ({x,y,z} m/s²) captured while holding the arm at the
  -- bottom / top of the ROM.
  gravity_ref_start JSONB NOT NULL,
  gravity_ref_end JSONB NOT NULL,

  -- Unit pivot axis ({x,y,z}, phone frame) derived at calibration time from
  -- the transit-gyro integral (services/shared/motion/calibration.ts) —
  -- determined during calibration, never assumed. Stored because the two
  -- static gravity refs alone cannot reconstruct it (axis-tilt ambiguity).
  derived_pivot_axis JSONB NOT NULL,
  -- ROM derived at save time (gravity refs about the axis), for display.
  derived_rom_degrees NUMERIC(5,1),

  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_machine_calibrations_user ON machine_calibrations(user_id, exercise_id);

-- Derived per-rep metrics for one recorded set. Raw sample buffers live in
-- motion_capture_raw_buffers (opt-in), NOT here.
CREATE TABLE motion_captures (
  -- Client-generated (crypto.randomUUID) so the row can be queued in the
  -- offline outbox before it lands.
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id UUID NOT NULL REFERENCES set_logs(id) ON DELETE CASCADE,
  -- RESTRICT: a calibration that captures were recorded against cannot be
  -- deleted out from under them — invariant "every capture references a
  -- calibration" holds forever, not just at insert time.
  calibration_id UUID NOT NULL REFERENCES machine_calibrations(id) ON DELETE RESTRICT,

  side TEXT NOT NULL CHECK (side IN ('left', 'right')),
  started_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),

  sample_rate_hz_mean NUMERIC(7,2) NOT NULL,
  sample_rate_hz_stddev NUMERIC(7,2) NOT NULL,
  dropped_sample_count INTEGER NOT NULL DEFAULT 0,
  clip_detected BOOLEAN NOT NULL DEFAULT false,

  -- RepMetric[] (types/motion.ts). JSONB: per-rep metrics are read/written
  -- as a unit and never queried relationally.
  reps JSONB NOT NULL,
  quality_flags TEXT[] NOT NULL DEFAULT '{}',

  provenance TEXT NOT NULL DEFAULT 'phone-imu-v1',
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_motion_captures_set ON motion_captures(set_id);
CREATE INDEX idx_motion_captures_user ON motion_captures(user_id, created_at DESC);

-- Raw IMU sample buffer, one per capture, opt-in only
-- (users.motion_capture_raw_retention). Carries the workout session id so
-- the per-session cap is counted against the SERVER (shared across tabs and
-- devices), not a per-tab counter.
CREATE TABLE motion_capture_raw_buffers (
  capture_id UUID PRIMARY KEY REFERENCES motion_captures(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
  -- ImuSample[] (types/motion.ts), values rounded client-side to keep rows small.
  samples JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_motion_raw_buffers_session ON motion_capture_raw_buffers(workout_session_id);

-- RLS: all three tables carry user_id directly, so policies are plain
-- auth.uid() checks (no join through blocks/sessions needed).
ALTER TABLE machine_calibrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE motion_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE motion_capture_raw_buffers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own calibrations" ON machine_calibrations
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own calibrations" ON machine_calibrations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own calibrations" ON machine_calibrations
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own calibrations" ON machine_calibrations
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own motion captures" ON motion_captures
  FOR SELECT USING (auth.uid() = user_id);
-- INSERT also verifies ownership of BOTH referenced rows: FK checks bypass
-- the parent tables' RLS, so user_id alone would let a caller holding a
-- foreign set/calibration UUID attach telemetry to another user's set (and,
-- via ON DELETE RESTRICT, pin that user's calibration forever).
CREATE POLICY "Users can insert own motion captures" ON motion_captures
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM machine_calibrations mc
      WHERE mc.id = motion_captures.calibration_id
      AND mc.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM set_logs sl
      JOIN exercise_blocks eb ON eb.id = sl.exercise_block_id
      JOIN workout_sessions ws ON ws.id = eb.workout_session_id
      WHERE sl.id = motion_captures.set_id
      AND ws.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can update own motion captures" ON motion_captures
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own motion captures" ON motion_captures
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own raw buffers" ON motion_capture_raw_buffers
  FOR SELECT USING (auth.uid() = user_id);
-- Same referenced-row ownership rule as motion_captures.
CREATE POLICY "Users can insert own raw buffers" ON motion_capture_raw_buffers
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM motion_captures c
      WHERE c.id = motion_capture_raw_buffers.capture_id
      AND c.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM workout_sessions ws
      WHERE ws.id = motion_capture_raw_buffers.workout_session_id
      AND ws.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can delete own raw buffers" ON motion_capture_raw_buffers
  FOR DELETE USING (auth.uid() = user_id);
