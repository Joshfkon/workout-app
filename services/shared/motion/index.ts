/**
 * services/shared/motion — pure signal processing for the experimental
 * motion-capture feature (single-DOF rotating-arm machines).
 *
 * HARD BOUNDARY: nothing in this directory may import the e1RM module, the
 * prescription engine, or the volume model, and nothing here touches the
 * DOM or sensors. Enforced by __tests__/importGuard.test.ts.
 */

export * from './constants';
export * from './vec3';
export { deriveCalibrationFromAnalysis, type CalibrationEligibility } from './calibration';
export { eigenSymmetric3, type Eigen3Result, type Sym3 } from './eigen3';
export { designButterworthLP4, filtfilt, lowpassZeroPhase, type Biquad } from './butterworth';
export {
  classifyStillness,
  HANDHELD_CONE_MAX_DEG,
  HANDHELD_GYRO_MAX_RADPS,
  HANDHELD_MIN_MS,
  MOUNTED_GYRO_MAX_RADPS,
  MOUNTED_MIN_MS,
  type StillnessResult,
  type StillnessTier,
} from './stillness';
export {
  analyzeCapture,
  CAPTURE_ENTER_OMEGA_RADPS,
  CAPTURE_EXIT_OMEGA_RADPS,
  CAPTURE_FILTER_CUTOFF_HZ,
  CAPTURE_MASK_OMEGA_RADPS,
  LOW_CONFIDENCE_PC1_SHARE,
  type CaptureAnalysis,
  type CaptureAnalysisOptions,
  type CaptureRep,
  type HalfRep,
} from './captureAnalysis';
export { armAngleFromGravity, isQuasiStatic } from './gravity';
export {
  findGravityRef,
  isGravityRefSample,
  GRAVITY_REF_FAIL_HINT,
  type GravityRef,
} from './gravityRef';
export { segmentPhases, type MovementPhase, type SegmentationOptions } from './segmentation';
export {
  processMotionSamples,
  type MotionPipelineInput,
  type MotionPipelineOptions,
  type MotionPipelineResult,
} from './pipeline';
export { LiveCaptureGate, type LiveGateState, type LiveGateOptions } from './liveGate';
