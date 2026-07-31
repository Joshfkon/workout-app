// ============================================================
// MOTION CAPTURE (experimental) — domain types
//
// A PARALLEL TELEMETRY STREAM for single-DOF rotating-arm machines
// (v1 target: iso-lateral incline press). Motion data is display-only:
// nothing here may feed the e1RM module, the prescription engine, or the
// volume model (enforced by services/shared/motion/__tests__/importGuard).
//
// Entity relationships (deliberate direction):
//   MotionCapture --(setId)--> SetLog          a set knows NOTHING about motion
//   MotionCapture --(calibrationId, required)--> MachineCalibration
//
// A capture without a calibration is invalid and must never be persisted —
// the angle math is meaningless without the pivot axis and mount radius.
// ============================================================

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Which phone edge points along the machine arm (toward the pivot). */
export type MountOrientation = 'top-edge' | 'bottom-edge' | 'left-edge' | 'right-edge';

export const MOUNT_ORIENTATIONS: MountOrientation[] = [
  'top-edge',
  'bottom-edge',
  'left-edge',
  'right-edge',
];

/**
 * A user-performed calibration of one physical machine + seat + mount
 * position, produced by the SWEEP flow (START in hand → mount → ~3 slow
 * full-ROM reps → retrieve → STOP). Changing seat height or where the phone
 * is mounted invalidates the calibration — the UI warns about this on save.
 *
 * schemaVersion history:
 *  1 — two-static-hold derivation. Mathematically ill-posed (the axis
 *      component parallel to gravity is unrecoverable from two gravity
 *      vectors); all v1 rows were wiped by migration.
 *  2 — sweep derivation: axis from the gyro scatter matrix, gravity used
 *      only as a check. Adds axisQuality; gravity refs become endpoint
 *      UNIT vectors.
 */
export interface MachineCalibration {
  id: string;
  exerciseId: string;
  /** User-entered, e.g. "Home gym HS incline". */
  label: string;
  /** Free text — the user records their seat pin position. */
  seatSetting: string;
  /** Pivot axis to phone IMU, user-measured, millimetres. */
  mountRadius_mm: number;
  mountOrientation: MountOrientation;
  /** Mean gravity UNIT vector at the BOTTOM ROM endpoint (sweep rests). */
  gravityRefStart: Vec3;
  /** Mean gravity UNIT vector at the TOP ROM endpoint (sweep rests). */
  gravityRefEnd: Vec3;
  /**
   * Unit pivot axis in the phone frame — the principal eigenvector of the
   * sweep's gyro scatter matrix (services/shared/motion/calibration.ts),
   * sign-resolved so the concentric direction is positive.
   */
  derivedPivotAxis: Vec3;
  /**
   * Axis-quality metric λ1/(λ2+λ3) from the sweep's scatter eigenvalues —
   * how single-axis the recorded motion actually was. Sweeps below
   * AXIS_QUALITY_MIN are rejected before a calibration is ever created.
   */
  axisQuality: number;
  /** Median endpoint-to-endpoint stroke ROM from the sweep, degrees. */
  derivedRomDegrees: number | null;
  createdAt: string;
  schemaVersion: number;
}

/** Current MachineCalibration schema version (see history above). */
export const CALIBRATION_SCHEMA_VERSION = 2;

export type CaptureSide = 'left' | 'right';

/** Derived per-rep metrics — the only motion data persisted by default. */
export interface RepMetric {
  /** 0-based rep index within the capture. */
  index: number;
  concentricMs: number;
  eccentricMs: number;
  /** Pause between concentric end and eccentric start (top of the stroke). */
  pauseMs: number;
  romDegrees: number;
  peakAngularVelocity_radps: number;
  meanAngularVelocity_radps: number;
  /** mountRadius (m) × mean ω — linear speed at the phone mount. */
  meanHandleVelocity_mps: number;
  /**
   * Integrity check: |integrated-gyro angle − gravity-derived angle| at the
   * rep endpoint, degrees. The feature's main defense against silently wrong
   * data. null when no quasi-static endpoint window existed to verify
   * against (which itself rejects the rep).
   */
  gyroAngle_vs_gravityAngle_errorDeg: number | null;
  rejected: boolean;
  rejectReason: string | null;
}

export const MOTION_PROVENANCE = 'phone-imu-v1' as const;
export type MotionProvenance = typeof MOTION_PROVENANCE;

/**
 * One recorded set's motion telemetry. References the set by id; the set
 * schema is untouched. Raw sample buffers are NOT part of this record —
 * raw retention is a separate opt-in with a per-session cap.
 */
export interface MotionCapture {
  id: string;
  setId: string;
  calibrationId: string;
  side: CaptureSide;
  startedAt: string;
  durationMs: number;
  sampleRateHz_mean: number;
  sampleRateHz_stddev: number;
  droppedSampleCount: number;
  clipDetected: boolean;
  reps: RepMetric[];
  qualityFlags: string[];
  /** Literal source tag so future pipelines can migrate old records. */
  provenance: MotionProvenance;
  schemaVersion: number;
}

export const MOTION_SCHEMA_VERSION = 1;

/**
 * One normalized IMU sample as consumed by the pure signal-processing layer
 * (services/shared/motion). The browser layer (lib/motion) converts
 * DeviceMotionEvent units into this shape: gyro in rad/s (DeviceMotion
 * reports deg/s), accel is accelerationIncludingGravity in m/s².
 * Timestamps come from performance.now() — integration always uses the
 * measured dt between samples, never a nominal interval.
 */
export interface ImuSample {
  /** performance.now() timestamp, ms (monotonic). */
  tMs: number;
  /** Angular rate, rad/s, phone frame (x=beta, y=gamma, z=alpha axes). */
  gyro: Vec3;
  /** accelerationIncludingGravity, m/s², phone frame. */
  accel: Vec3;
}
