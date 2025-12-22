/**
 * Wearable Integration Services
 *
 * Unified exports for all wearable integration functionality.
 */

// HealthKit (iOS)
export {
  healthKitService,
  isHealthKitAvailable,
  requestHealthKitPermissions,
  fetchHealthKitSteps,
  fetchHealthKitHourlySteps,
  fetchHealthKitActiveEnergy,
  fetchHealthKitWorkouts,
  subscribeToHealthKitUpdates,
} from './healthkit';

// Google Fit (Android)
export {
  googleFitService,
  isGoogleFitAvailable,
  requestGoogleFitPermissions,
  fetchGoogleFitSteps,
  fetchGoogleFitHourlySteps,
  fetchGoogleFitCalories,
  fetchGoogleFitWorkouts,
  subscribeToGoogleFitUpdates,
} from './google-fit';

// Fitbit (OAuth)
export {
  fitbitService,
  initiateFitbitOAuth,
  handleFitbitCallback,
  setFitbitTokens,
  revokeFitbitAccess,
  fetchFitbitSteps,
  fetchFitbitHourlySteps,
  fetchFitbitCalories,
  fetchFitbitWorkouts,
  getFitbitPermissions,
  isFitbitConnected,
} from './fitbit';

// Unified Activity Sync
export {
  activitySyncService,
  syncDailyActivity,
  syncActivityDateRange,
  getActiveWearableConnections,
  calculateNetExpenditure,
  mergeActivityData,
} from './activity-sync';

// Step Normalization
export {
  BASELINE_MULTIPLIERS,
  normalizeSteps,
  denormalizeSteps,
  calculateStepCalibration,
  createCalibrationHistoryEntry,
  getDeviceAccuracyNotes,
  formatCalibrationFactor,
  isCalibrationReasonable,
  getDefaultCalibration,
} from './step-normalization';

// Workout Calorie Estimation
export {
  estimateWorkoutExpenditure,
  estimateWorkoutIntensity,
  estimateByMET,
  estimateByHeartRate,
  createWorkoutActivity,
  compareEstimates,
  formatIntensity,
  getIntensityDescription,
  getConfidenceExplanation,
} from './workout-calories';
