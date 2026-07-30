/**
 * Tunable thresholds for the motion pipeline, with rationale. Single-DOF
 * rotating-arm machines only (v1: iso-lateral incline press) — these are NOT
 * calibrated for free weights.
 */

/** Standard gravity, m/s². */
export const G_MPS2 = 9.80665;

/**
 * |ω| below this (rad/s, ≈3.4°/s) counts toward a rest interval. Machine
 * arms at rest read near-zero after bias removal; real reps on a press run
 * an order of magnitude above this.
 */
export const REST_OMEGA_RADPS = 0.06;

/** A rest interval must persist this long before ZUPT fires (spec: >250 ms). */
export const REST_MIN_MS = 250;

/**
 * Segmentation hysteresis: a phase opens only above OMEGA_HIGH and closes
 * only below OMEGA_LOW — a bare zero crossing can chatter on sensor noise,
 * a 2.5× band cannot.
 */
export const OMEGA_HIGH_RADPS = 0.25;
export const OMEGA_LOW_RADPS = 0.1;

/** Phases shorter than this or moving less than this are jitter, not reps. */
export const MIN_PHASE_MS = 150;
export const MIN_PHASE_DEG = 3;

/**
 * Reject any rep containing an accelerometer sample above this on any axis:
 * phone IMUs clip around ±16 g ≈ 157 m/s², so 155 means the true peak is
 * unknown and the gravity direction near it is untrustworthy.
 */
export const CLIP_ACCEL_MPS2 = 155;

/**
 * Rep endpoint integrity: integrated-gyro angle vs gravity-derived angle
 * may disagree by at most this many degrees, else the rep is rejected.
 */
export const INTEGRITY_MAX_ERROR_DEG = 3;

/**
 * A sample window is quasi-static (accel ≈ pure gravity, so its direction
 * is usable as an absolute angle reference) when | |a| − g | stays within
 * this. 1.2 m/s² tolerates turnaround jerk averaging while excluding
 * mid-stroke dynamics.
 */
export const QUASI_STATIC_TOL_MPS2 = 1.2;

/** Window after a rep's eccentric end searched for a quasi-static reference. */
export const INTEGRITY_SEARCH_MS = 600;

/** Leading quiet period needed for a trustworthy gyro-bias estimate. */
export const MIN_BIAS_WINDOW_MS = 300;

/** Motion onset (arming trigger + end of the bias window). */
export const ONSET_OMEGA_RADPS = 0.25;

/** Auto-terminate a recording after this long below the rest threshold. */
export const AUTO_STOP_QUIET_MS = 5000;

/** Calibration sanity: bottom/top gravity refs must differ by at least this. */
export const MIN_CALIBRATION_ROM_DEG = 10;

/** And a gravity reference must have a plausible magnitude to be quasi-static. */
export const CALIBRATION_GRAVITY_TOL_MPS2 = 1.5;

/** Below this mean sample rate the pipeline flags the capture as degraded. */
export const LOW_SAMPLE_RATE_HZ = 40;

/** A dt gap larger than this multiple of the median dt counts as dropped samples. */
export const DROPPED_DT_FACTOR = 2.5;

/** Capture-level quality flags (stable strings — they are persisted). */
export const QUALITY_FLAGS = {
  clipping: 'clipping-detected',
  lowSampleRate: 'low-sample-rate',
  highDropRate: 'high-sample-drop-rate',
  shortBiasWindow: 'short-bias-window',
  noReps: 'no-reps-detected',
  unpairedPhases: 'unpaired-movement-phases',
  firstPhaseNotConcentric: 'first-phase-not-concentric',
} as const;

export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
