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
export {
  deriveCalibration,
  CALIBRATION_ROM_AGREEMENT_DEG,
  type CalibrationDerivation,
  type TransitSample,
} from './calibration';
export { armAngleFromGravity, isQuasiStatic } from './gravity';
export { segmentPhases, type MovementPhase, type SegmentationOptions } from './segmentation';
export {
  processMotionSamples,
  type MotionPipelineInput,
  type MotionPipelineOptions,
  type MotionPipelineResult,
} from './pipeline';
export { LiveCaptureGate, type LiveGateState, type LiveGateOptions } from './liveGate';
